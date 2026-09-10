'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sanitizeTerminalText } = require('./sanitize');
const { getTranscriptUsageStatePath } = require('./paths');

const DEFAULT_TAIL_BYTES = 16384;
const MAX_TOTAL_BYTES = 262144;
const MAX_SCAN_LINES = 40;
const MIN_TAIL_BYTES = 64;

// A fractional tail window either dead-locks the backward scan
// (Math.floor(x) === 0 makes every read zero bytes long, so the loop never
// advances) or degrades into one readSync per byte (a 256KB budget becomes
// ~260k syscalls). Normalize at every entry point instead of trusting the
// caller/config value.
function normalizeTailBytes(value) {
  if (!Number.isFinite(value)) return DEFAULT_TAIL_BYTES;
  const n = Math.floor(value);
  return n >= MIN_TAIL_BYTES ? n : DEFAULT_TAIL_BYTES;
}

function parseArguments(argValue) {
  if (argValue && typeof argValue === 'object') return argValue;
  if (typeof argValue === 'string') {
    try {
      const parsed = JSON.parse(argValue);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // malformed arguments — no detail available
    }
  }
  return null;
}

function pushCall(calls, item) {
  if (!item || typeof item !== 'object') return;
  const id = item.callId || item.id || null;
  if (id === null || calls.some(c => c.id === id)) return;
  calls.push({ id, name: item.name, arguments: item.arguments !== undefined ? item.arguments : item.input });
}

function pushResultId(resultIds, item) {
  if (!item || typeof item !== 'object') return;
  const id = item.tool_use_id || item.callId;
  if (typeof id === 'string' && id) resultIds.add(id);
}

// Extract tool calls / result ids from one transcript entry.
// Supports CodeBuddy (function_call / function_call_result entries) and
// Claude-style (message.content blocks with tool_use / tool_result).
function scanEntry(entry, calls, resultIds) {
  if (!entry || typeof entry !== 'object') return;

  if (entry.type === 'function_call') {
    pushCall(calls, entry);
    return;
  }
  if (entry.type === 'function_call_result') {
    pushResultId(resultIds, entry);
    return;
  }

  const containers = [];
  if (entry.message && Array.isArray(entry.message.content)) containers.push(entry.message.content);
  if (Array.isArray(entry.content)) containers.push(entry.content);
  for (const blocks of containers) {
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'tool_use') pushCall(calls, block);
      else if (block.type === 'tool_result') pushResultId(resultIds, block);
    }
  }
}

// Collect complete lines from newest to oldest within the supplied line
// budget. The text must contain only complete lines (window-partials are
// spliced via carry before this call). Returns how many lines were examined
// so the caller can keep one global budget across window boundaries.
function collectCompleteLines(text, budget) {
  const calls = [];
  const resultIds = new Set();
  const lines = text.split('\n');
  let scanned = 0;
  for (let i = lines.length - 1; i >= 0 && scanned < budget; i--) {
    scanned++;
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // corrupt line — skip
    }
    scanEntry(entry, calls, resultIds);
  }
  return { calls, resultIds, scanned };
}

// Slide a window backwards from EOF until the newest tool call is found.
// Entries can be several KB (providerData carries full usage stats), so a
// fixed 16KB tail may contain only results without their calls. A line that
// straddles a window boundary is reconstructed via carry. The line budget is
// global (MAX_SCAN_LINES across all windows): a per-window cap would skip
// lines inside a window while still scanning older windows, surfacing a call
// older than one that was never examined.
function scanBackwards(fd, size, tailBytes) {
  const resultIds = new Set();
  let end = size;
  let totalRead = 0;
  let carryBuffer = Buffer.alloc(0);
  let scannedTotal = 0;

  while (end > 0 && totalRead < MAX_TOTAL_BYTES && scannedTotal < MAX_SCAN_LINES) {
    const len = Math.min(tailBytes, end);
    const start = end - len;
    const buf = Buffer.alloc(len);
    const bytesRead = fs.readSync(fd, buf, 0, len, start);
    totalRead += bytesRead;

    const chunk = bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
    const combinedBuf = Buffer.concat([chunk, carryBuffer]);
    carryBuffer = Buffer.alloc(0);

    let text;
    if (start > 0) {
      const nl = combinedBuf.indexOf(0x0a);
      if (nl === -1) {
        // the whole window belongs to one line that started earlier
        carryBuffer = combinedBuf;
        end = start;
        continue;
      }
      carryBuffer = combinedBuf.subarray(0, nl);
      text = combinedBuf.subarray(nl + 1).toString('utf8');
    } else {
      text = combinedBuf.toString('utf8');
    }

    const { calls, resultIds: ids, scanned } = collectCompleteLines(text, MAX_SCAN_LINES - scannedTotal);
    scannedTotal += scanned;
    for (const id of ids) resultIds.add(id);
    if (calls.length > 0) return { newest: calls[0], resultIds };
    end = start;
  }

  return { newest: null, resultIds };
}

function extractDetail(input) {
  if (!input) return '';
  const pathValue = input.file_path || input.path || input.notebook_path;
  if (typeof pathValue === 'string' && pathValue.trim()) {
    return path.basename(pathValue.replace(/[\\/]+$/, '')) || '';
  }
  const command = input.command || input.pattern || input.query || input.url;
  if (typeof command === 'string') {
    return command.trim().split(/\s+/).slice(0, 4).join(' ');
  }
  return '';
}

// Extract cache/token counts and actual credit spend from one transcript
// entry's providerData.
//
// Real CodeBuddy payloads carry cache telemetry ONLY here — never in the
// statusLine payload's `context_window.current_usage`. Two shapes exist:
//
//   rawUsage (authoritative; hit + miss === prompt_tokens, fully self-consistent):
//     { "prompt_tokens": 133461, "prompt_cache_hit_tokens": 133120,
//       "prompt_cache_miss_tokens": 341,
//       "cache_read_input_tokens": 0,        <-- TRAP: always 0 on this provider
//       "cache_creation_input_tokens": 0 }
//
//   usage (OpenAI-style fallback):
//     { "inputTokens": 133461, "inputTokensDetails": [{ "cached_tokens": 133120 }] }
//
// We match on the presence of the denominator, not on the hit being > 0, so a
// genuine cold turn (hit === 0) is still reported as 0% rather than skipped.
function extractUsageMetrics(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const pd = entry.providerData;
  if (!pd || typeof pd !== 'object') return null;

  const raw = pd.rawUsage;
  const credit = raw && typeof raw === 'object'
    && Number.isFinite(raw.credit) && raw.credit >= 0 ? raw.credit : null;
  if (raw && typeof raw === 'object'
      && Number.isFinite(raw.prompt_tokens) && raw.prompt_tokens > 0) {
    let hit = Number.isFinite(raw.prompt_cache_hit_tokens) ? raw.prompt_cache_hit_tokens : null;
    if (hit === null && raw.prompt_tokens_details && Number.isFinite(raw.prompt_tokens_details.cached_tokens)) {
      hit = raw.prompt_tokens_details.cached_tokens;
    }
    if (hit === null && Number.isFinite(raw.cached_tokens)) {
      hit = raw.cached_tokens;
    }
    if (hit === null) hit = 0;
    return { hitTokens: hit, promptTokens: raw.prompt_tokens, credit, source: 'rawUsage' };
  }

  const u = pd.usage;
  if (u && typeof u === 'object'
      && Number.isFinite(u.inputTokens) && u.inputTokens > 0) {
    let cached = 0;
    if (Array.isArray(u.inputTokensDetails)) {
      for (const d of u.inputTokensDetails) {
        if (d && Number.isFinite(d.cached_tokens)) cached += d.cached_tokens;
      }
    }
    return { hitTokens: cached, promptTokens: u.inputTokens, credit, source: 'usage' };
  }

  // Credit is independently useful even when a provider omits token cache
  // telemetry. Keep it so Line 3 can show actual spend without inventing a
  // model-rate fallback.
  return credit === null ? null : {
    hitTokens: null,
    promptTokens: null,
    credit,
    source: 'rawUsage',
  };
}

// One conversation turn spans MULTIPLE API calls (measured on a real session:
// avg 19.3 calls/turn, max 38). Every call carries its own prompt_tokens and
// prompt_cache_hit_tokens. Sampling only the newest call makes the badge swing
// wildly — the first call after a cache miss is ~0% while later calls hit
// 96-99% — so a "per-turn" figure must aggregate every call in the turn.
// 200 lines covers a long turn; parsing 200 lines costs ~1.9ms, which is ~0.5%
// of a single HUD run, so this is deliberately generous.
const MAX_TURN_SCAN_LINES = 200;

// Slide a window backwards from EOF collecting usage blocks, newest first.
// limit          — stop once this many blocks have been collected
// stopOnUserTurn — stop at the newest `role:'user'` message, which marks the
//                  start of the current turn (per-turn aggregation)
// Returns the blocks collected so far even on error, so callers degrade to
// partial data rather than to "no data".
function collectUsageBackwards(transcriptPath, opts, limit, stopOnUserTurn) {
  const options = opts || {};
  if (!transcriptPath || typeof transcriptPath !== 'string') return [];
  if (transcriptPath.includes('\0')) return [];

  let resolved = transcriptPath;
  if (!path.isAbsolute(resolved) && typeof options.cwd === 'string' && options.cwd) {
    resolved = path.resolve(options.cwd, resolved);
  }

  const tailBytes = normalizeTailBytes(options.tailBytes);
  const maxLines = stopOnUserTurn ? MAX_TURN_SCAN_LINES : MAX_SCAN_LINES;

  const collected = [];
  let fd = null;
  try {
    fd = fs.openSync(resolved, 'r');
    const size = fs.fstatSync(fd).size;
    if (size <= 0) return collected;

    let end = size;
    let totalRead = 0;
    let carryBuffer = Buffer.alloc(0);
    let scanned = 0;

    while (end > 0 && totalRead < MAX_TOTAL_BYTES && scanned < maxLines) {
      const len = Math.min(tailBytes, end);
      const start = end - len;
      const buf = Buffer.alloc(len);
      const bytesRead = fs.readSync(fd, buf, 0, len, start);
      totalRead += bytesRead;

      const chunk = bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
      const combinedBuf = Buffer.concat([chunk, carryBuffer]);
      carryBuffer = Buffer.alloc(0);

      let text;
      if (start > 0) {
        const nl = combinedBuf.indexOf(0x0a);
        if (nl === -1) {
          carryBuffer = combinedBuf;
          end = start;
          continue;
        }
        carryBuffer = combinedBuf.subarray(0, nl);
        text = combinedBuf.subarray(nl + 1).toString('utf8');
      } else {
        text = combinedBuf.toString('utf8');
      }

      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0 && scanned < maxLines; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        scanned++;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue; // corrupt line — skip
        }

        // Turn boundary: once we have collected calls in the active/recent turn,
        // a user message marks the beginning of that turn.
        if (stopOnUserTurn && collected.length > 0 && entry.type === 'message' && entry.role === 'user') {
          return collected;
        }

        const metrics = extractUsageMetrics(entry);
        if (metrics) {
          collected.push(metrics);
          if (collected.length >= limit) return collected;
        }
      }
      end = start;
    }

    return collected;
  } catch {
    return collected;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

// Most recent single API call's usage — the instantaneous figure. Kept for
// callers/fixtures that have no real turn structure, but it swings between ~0%
// and ~99% across a turn, so it is NOT what the HUD badge displays.
function getRecentUsageMetrics(transcriptPath, opts) {
  const collected = collectUsageBackwards(transcriptPath, opts, 1, false);
  return collected.length > 0 ? collected[0] : null;
}

// Aggregate every API call in the current conversation turn:
// sum(hit) / sum(prompt) and credits across the turn's calls.
function getTurnUsageMetrics(transcriptPath, opts) {
  return getTurnMetricsAndActivity(transcriptPath, opts).turnUsage;
}

const SESSION_STATE_VERSION = 5;
const SESSION_HEAD_BYTES = 4096;
const SESSION_READ_CHUNK_BYTES = 64 * 1024;
const SMALL_SESSION_VERIFY_BYTES = 256 * 1024;

function statIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeMs: Number.isFinite(stat.birthtimeMs) ? stat.birthtimeMs : 0,
  };
}

function getStatTimestampNs(stat, name) {
  const nanoseconds = stat && stat[`${name}Ns`];
  if (typeof nanoseconds === 'bigint') return nanoseconds.toString();
  const milliseconds = stat && stat[`${name}Ms`];
  return Number.isFinite(milliseconds) ? String(Math.round(milliseconds * 1000000)) : '0';
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readHeadHash(fd, size) {
  const length = Math.min(size, SESSION_HEAD_BYTES);
  if (length <= 0) return hashBuffer(Buffer.alloc(0));
  const buffer = Buffer.alloc(length);
  const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
  return hashBuffer(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
}

// Some network and mounted filesystems expose coarse or delayed mtime/ctime
// updates. For small transcripts, an inexpensive whole-file hash closes that
// gap and reliably catches a same-size in-place rewrite. Large transcripts
// retain the metadata/checkpoint incremental path so each HUD refresh never
// turns into a full multi-megabyte read.
function readSmallFileHash(fd, size) {
  if (size > SMALL_SESSION_VERIFY_BYTES) return null;
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(Math.min(SESSION_READ_CHUNK_BYTES, Math.max(1, size)));
  let position = 0;
  while (position < size) {
    const length = Math.min(buffer.length, size - position);
    const bytesRead = fs.readSync(fd, buffer, 0, length, position);
    if (!bytesRead) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return position === size ? hash.digest('hex') : null;
}

function readSessionState(statePath, resolved, identity, size, headHash, fd) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!state || state.version !== SESSION_STATE_VERSION || state.path !== resolved) return null;
    if (!state.identity || state.identity.dev !== identity.dev
        || state.identity.ino !== identity.ino
        || state.identity.birthtimeMs !== identity.birthtimeMs) return null;
    if (state.headHash !== headHash) return null;
    if (!Number.isSafeInteger(state.sourceSize) || state.sourceSize < 0) return null;
    if (typeof state.sourceMtimeNs !== 'string' || typeof state.sourceCtimeNs !== 'string') return null;
    if (state.sourceContentHash !== null && typeof state.sourceContentHash !== 'string') return null;
    if (!Number.isSafeInteger(state.offset) || state.offset < 0 || state.offset > size) return null;
    if (!Number.isFinite(state.credits) || state.credits < 0) return null;
    if (!Number.isSafeInteger(state.creditCallCount) || state.creditCallCount < 0) return null;

    // A checkpoint hash catches in-place rewrites that preserve path, inode and
    // size. It covers the bytes immediately before the saved offset.
    const checkpointStart = Math.max(0, state.offset - SESSION_HEAD_BYTES);
    const checkpointLength = state.offset - checkpointStart;
    const checkpoint = Buffer.alloc(checkpointLength);
    const cpBytesRead = checkpointLength > 0 ? fs.readSync(fd, checkpoint, 0, checkpointLength, checkpointStart) : 0;
    const actualCheckpoint = cpBytesRead === checkpoint.length ? checkpoint : checkpoint.subarray(0, cpBytesRead);
    if (state.checkpointHash !== hashBuffer(actualCheckpoint)) return null;
    return state;
  } catch {
    return null;
  }
}

function writeSessionState(statePath, state) {
  let tmpPath = null;
  try {
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Unique temp files prevent concurrent HUD processes from overwriting one
    // another's temporary contents before the final rename.
    tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(state));
    fs.renameSync(tmpPath, statePath);
  } catch {
    if (tmpPath) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
    // Persistence is best effort; this invocation still returns its total.
  }
}

// Keep a session-wide credit total without rescanning the entire transcript on
// every ~300ms statusLine refresh. The state records a byte offset at the end
// of the last complete JSONL line, so the next process only parses appended
// data. A truncated/corrupt state or a transcript reset causes a full rebuild.
function getSessionUsageMetrics(transcriptPath, opts) {
  const options = opts || {};
  if (!transcriptPath || typeof transcriptPath !== 'string' || transcriptPath.includes('\0')) return null;

  let resolved = transcriptPath;
  try {
    if (!path.isAbsolute(resolved) && typeof options.cwd === 'string' && options.cwd) {
      resolved = path.resolve(options.cwd, resolved);
    } else {
      resolved = path.resolve(resolved);
    }
  } catch {
    return null;
  }

  const statePath = typeof options.statePath === 'string' && options.statePath
    ? options.statePath
    : getTranscriptUsageStatePath(resolved);
  let fd = null;
  try {
    fd = fs.openSync(resolved, 'r');
    const stat = fs.fstatSync(fd);
    const highResolutionStat = fs.fstatSync(fd, { bigint: true });
    const size = stat.size;
    const identity = statIdentity(stat);
    const headHash = readHeadHash(fd, size);
    let smallFileHash = null;
    let cached = readSessionState(statePath, resolved, identity, size, headHash, fd);

    // A normal append changes mtime/ctime, so timestamps cannot be part of
    // the immutable file identity. They are instead used when the byte length
    // is unchanged: that combination is an in-place rewrite and must rebuild
    // the total even if the changed bytes are outside our head/checkpoint
    // hashes. A shorter file likewise indicates truncation/rotation.
    if (cached && (size < cached.sourceSize || (size === cached.sourceSize
        && (getStatTimestampNs(highResolutionStat, 'mtime') !== cached.sourceMtimeNs
          || getStatTimestampNs(highResolutionStat, 'ctime') !== cached.sourceCtimeNs)))) {
      cached = null;
    }
    if (cached && size === cached.sourceSize && cached.sourceContentHash !== null) {
      smallFileHash = readSmallFileHash(fd, size);
      if (smallFileHash !== null && smallFileHash !== cached.sourceContentHash) {
        cached = null;
      }
    }

    const offset = cached ? cached.offset : 0;
    let total = cached ? cached.credits : 0;
    let calls = cached ? cached.creditCallCount : 0;
    let processedOffset = offset;
    let complete = true;
    if (size > offset) {
      // Read appended data in bounded chunks. A transcript can be tens or
      // hundreds of megabytes; allocating size-offset here would turn every
      // cache miss/rotation into an avoidable memory spike.
      let cursor = offset;
      let pendingChunks = [];
      let pendingLength = 0;
      let pendingStart = offset;

      const countCreditLine = (buffer) => {
        const line = buffer.toString('utf8').trim();
        if (!line) return true;
        try {
          const metrics = extractUsageMetrics(JSON.parse(line));
          if (metrics && Number.isFinite(metrics.credit)) {
            total += metrics.credit;
            calls++;
          }
          return true;
        } catch {
          // Ignore malformed transcript lines; later valid lines still count.
          return false;
        }
      };

      const scanStartTime = Date.now();
      let hitDeadline = false;
      let hitShortRead = false;

      while (cursor < size) {
        if (Date.now() - scanStartTime > 100) {
          hitDeadline = true;
          break;
        }
        const chunkStart = cursor;
        const length = Math.min(SESSION_READ_CHUNK_BYTES, size - cursor);
        const chunk = Buffer.alloc(length);
        const bytesRead = fs.readSync(fd, chunk, 0, length, cursor);
        if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > length) {
          hitShortRead = true;
          break;
        }
        cursor += bytesRead;
        const shortRead = bytesRead !== length;

        const current = bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead);
        let lineStart = 0;
        let newline = current.indexOf(0x0a, lineStart);
        while (newline !== -1) {
          const part = current.subarray(lineStart, newline);
          if (pendingLength > 0) {
            pendingChunks.push(part);
            pendingLength += part.length;
            countCreditLine(Buffer.concat(pendingChunks, pendingLength));
            pendingChunks = [];
            pendingLength = 0;
          } else {
            countCreditLine(part);
          }
          lineStart = newline + 1;
          processedOffset = chunkStart + lineStart;
          newline = current.indexOf(0x0a, lineStart);
        }

        const tail = current.subarray(lineStart);
        if (tail.length > 0) {
          if (pendingLength === 0) pendingStart = chunkStart + lineStart;
          pendingChunks.push(tail);
          pendingLength += tail.length;
        }
        if (shortRead) {
          hitShortRead = true;
          break;
        }
      }

      // Accept a complete final JSON object without a newline. An incomplete
      // tail stays uncommitted and will be retried when the writer completes it.
      if (!hitDeadline && !hitShortRead && cursor === size) {
        if (pendingLength > 0) {
          const tail = Buffer.concat(pendingChunks, pendingLength);
          if (countCreditLine(tail)) {
            processedOffset = size;
          } else {
            processedOffset = pendingStart;
            complete = false;
          }
        } else {
          processedOffset = size;
        }
      } else {
        complete = false;
      }
    } else if (size < offset) {
      // Defensive reset; readSessionState normally rejects this state already.
      processedOffset = 0;
      total = 0;
      calls = 0;
      complete = false;
    }

    const checkpointStart = Math.max(0, processedOffset - SESSION_HEAD_BYTES);
    const checkpointLength = processedOffset - checkpointStart;
    const checkpoint = Buffer.alloc(checkpointLength);
    const cpBytesRead = checkpointLength > 0 ? fs.readSync(fd, checkpoint, 0, checkpointLength, checkpointStart) : 0;
    const actualCheckpoint = cpBytesRead === checkpoint.length ? checkpoint : checkpoint.subarray(0, cpBytesRead);

    const willWrite = !cached || processedOffset !== offset || size === 0;
    if (willWrite && smallFileHash === null && size <= SMALL_SESSION_VERIFY_BYTES) {
      smallFileHash = readSmallFileHash(fd, size);
    }

    const state = {
      version: SESSION_STATE_VERSION,
      path: resolved,
      identity,
      headHash,
      offset: processedOffset,
      credits: total,
      creditCallCount: calls,
      checkpointHash: hashBuffer(actualCheckpoint),
      sourceSize: size,
      sourceMtimeNs: getStatTimestampNs(highResolutionStat, 'mtime'),
      sourceCtimeNs: getStatTimestampNs(highResolutionStat, 'ctime'),
      sourceContentHash: smallFileHash,
      updatedAt: Date.now(),
    };
    if (willWrite) writeSessionState(statePath, state);

    return {
      // A deadline, short read, or incomplete JSONL tail leaves a resumable
      // checkpoint but not a complete session total. Do not expose a prefix as
      // a session-wide value to callers.
      complete,
      credits: complete && calls > 0 ? total : null,
      creditCallCount: complete ? calls : null,
      offset: processedOffset,
      source: 'session',
    };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

function getRecentToolActivity(transcriptPath, opts) {
  const options = opts || {};
  if (!transcriptPath || typeof transcriptPath !== 'string') return null;
  if (transcriptPath.includes('\0')) return null;

  let resolved = transcriptPath;
  if (!path.isAbsolute(resolved) && typeof options.cwd === 'string' && options.cwd) {
    resolved = path.resolve(options.cwd, resolved);
  }

  const tailBytes = normalizeTailBytes(options.tailBytes);

  let fd = null;
  try {
    fd = fs.openSync(resolved, 'r');
    const size = fs.fstatSync(fd).size;
    if (size <= 0) return null;
    const { newest, resultIds } = scanBackwards(fd, size, tailBytes);
    if (!newest) return null;

    const args = parseArguments(newest.arguments);
    return {
      status: resultIds.has(newest.id) ? 'done' : 'active',
      tool: sanitizeTerminalText(String(newest.name || 'tool'), 16),
      detail: sanitizeTerminalText(extractDetail(args), 24),
    };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

function getTurnMetricsAndActivity(transcriptPath, opts) {
  const emptyResult = { turnUsage: null, toolActivity: null };
  const options = opts || {};
  if (!transcriptPath || typeof transcriptPath !== 'string' || transcriptPath.includes('\0')) return emptyResult;

  let resolved = transcriptPath;
  if (!path.isAbsolute(resolved) && typeof options.cwd === 'string' && options.cwd) {
    resolved = path.resolve(options.cwd, resolved);
  }

  const tailBytes = normalizeTailBytes(options.tailBytes);

  let fd = null;
  try {
    fd = fs.openSync(resolved, 'r');
    const size = fs.fstatSync(fd).size;
    if (size <= 0) return emptyResult;

    const usageCollected = [];
    const calls = [];
    const resultIds = new Set();
    let end = size;
    let totalRead = 0;
    let carryBuffer = Buffer.alloc(0);
    let scanned = 0;
    let hitUserBoundary = false;

    while (end > 0 && totalRead < MAX_TOTAL_BYTES && scanned < MAX_TURN_SCAN_LINES && !hitUserBoundary) {
      const len = Math.min(tailBytes, end);
      const start = end - len;
      const buf = Buffer.alloc(len);
      const bytesRead = fs.readSync(fd, buf, 0, len, start);
      totalRead += bytesRead;

      const chunk = bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
      const combinedBuf = Buffer.concat([chunk, carryBuffer]);
      carryBuffer = Buffer.alloc(0);

      let text;
      if (start > 0) {
        const nl = combinedBuf.indexOf(0x0a);
        if (nl === -1) {
          carryBuffer = combinedBuf;
          end = start;
          continue;
        }
        carryBuffer = combinedBuf.subarray(0, nl);
        text = combinedBuf.subarray(nl + 1).toString('utf8');
      } else {
        text = combinedBuf.toString('utf8');
      }

      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0 && scanned < MAX_TURN_SCAN_LINES; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        scanned++;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }

        const isUserBoundary = (entry.type === 'message' && entry.role === 'user') || (entry.type === 'user');
        if (isUserBoundary && (usageCollected.length > 0 || calls.length > 0 || resultIds.size > 0)) {
          hitUserBoundary = true;
          break;
        }

        const metrics = extractUsageMetrics(entry);
        if (metrics) {
          usageCollected.push(metrics);
        }
        scanEntry(entry, calls, resultIds);
      }
      end = start;
    }

    let turnUsage = null;
    if (usageCollected.length > 0) {
      let hitTokens = 0;
      let promptTokens = 0;
      let callCount = 0;
      let credits = 0;
      let creditCallCount = 0;
      for (const m of usageCollected) {
        if (Number.isFinite(m.hitTokens) && Number.isFinite(m.promptTokens)) {
          hitTokens += m.hitTokens;
          promptTokens += m.promptTokens;
          callCount++;
        }
        if (Number.isFinite(m.credit)) {
          credits += m.credit;
          creditCallCount++;
        }
      }
      turnUsage = {
        hitTokens,
        promptTokens,
        callCount,
        credits: creditCallCount > 0 ? credits : null,
        creditCallCount,
        source: 'turn',
      };
    }

    let toolActivity = null;
    if (calls.length > 0) {
      let active = null;
      const completedMap = new Map();
      let totalCompleted = 0;

      for (const call of calls) {
        const isCompleted = resultIds.has(call.id);
        const toolName = sanitizeTerminalText(String(call.name || 'tool'), 16);
        if (!isCompleted) {
          if (!active) {
            const args = parseArguments(call.arguments);
            active = {
              tool: toolName,
              detail: sanitizeTerminalText(extractDetail(args), 24),
            };
          }
        } else {
          completedMap.set(toolName, (completedMap.get(toolName) || 0) + 1);
          totalCompleted++;
        }
      }

      const completed = Array.from(completedMap.entries())
        .map(([tool, count]) => ({ tool, count }))
        .sort((a, b) => b.count - a.count);

      if (active || completed.length > 0) {
        toolActivity = {
          active,
          completed,
          totalCompleted,
        };
      }
    }

    return { turnUsage, toolActivity };
  } catch {
    return emptyResult;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

function getTurnToolActivity(transcriptPath, opts) {
  return getTurnMetricsAndActivity(transcriptPath, opts).toolActivity;
}

module.exports = {
  getRecentToolActivity,
  getTurnToolActivity,
  getTurnMetricsAndActivity,
  getRecentUsageMetrics,
  getTurnUsageMetrics,
  getSessionUsageMetrics,
  extractUsageMetrics,
  DEFAULT_TAIL_BYTES,
  MAX_TOTAL_BYTES,
  MAX_SCAN_LINES,
  MAX_TURN_SCAN_LINES,
};

