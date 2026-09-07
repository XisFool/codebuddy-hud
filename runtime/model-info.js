'use strict';

const fs = require('fs');
const path = require('path');
const { getSettingsPath } = require('./paths');

let _cachedSettingsEffort = null;
let _cachedSettingsEffortLoaded = false;
let _cachedSettingsEffortTime = 0;
let _cachedSettingsPath = null;

function getSettingsReasoningEffort() {
  let settingsPath;
  try {
    settingsPath = path.resolve(getSettingsPath());
  } catch {
    return null;
  }

  const now = Date.now();
  if (
    _cachedSettingsEffortLoaded
    && _cachedSettingsPath === settingsPath
    && now - _cachedSettingsEffortTime < 5000
  ) {
    return _cachedSettingsEffort;
  }

  let effort = null;
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      effort = (data && typeof data === 'object' && data.reasoningEffort) ? data.reasoningEffort : null;
    }
  } catch {
    effort = null;
  }

  _cachedSettingsEffort = effort;
  _cachedSettingsEffortLoaded = true;
  _cachedSettingsEffortTime = now;
  _cachedSettingsPath = settingsPath;
  return effort;
}

const MODEL_EFFORT_MAP = [
  { pattern: /\bo[13]\b/i, effort: 'max' },
  { pattern: /\bo4-mini\b/i, effort: 'high' },
  { pattern: /\bgpt-?5/i, effort: 'high' },
  { pattern: /\bgpt-?4o?\b/i, effort: 'medium' },
  { pattern: /\bclaude.*sonnet/i, effort: 'high' },
  { pattern: /\bclaude.*opus/i, effort: 'max' },
  { pattern: /\bclaude.*haiku/i, effort: 'medium' },
  { pattern: /\bgemini.*pro/i, effort: 'high' },
  { pattern: /\bgemini.*flash/i, effort: 'medium' },
  { pattern: /\bdeepseek.*r1/i, effort: 'max' },
  { pattern: /\bdeepseek/i, effort: 'medium' },
];

function inferEffortFromModel(cbData) {
  const modelId = (cbData && cbData.model && (cbData.model.id || cbData.model.display_name)) || '';
  if (!modelId) return null;
  for (const entry of MODEL_EFFORT_MAP) {
    if (entry.pattern.test(modelId)) return entry.effort;
  }
  return null;
}

/**
 * Resolve model thinking/effort level (low, medium, high, xhigh, max, ultracode).
 * @param {object} cbData
 * @param {object} [config]
 * @returns {string|null}
 */
const VALID_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'];

const EFFORT_ALIASES = {
  med: 'medium',
  'extra-high': 'xhigh',
  extra_high: 'xhigh',
  'x-high': 'xhigh',
  maximum: 'max',
  ultra: 'ultracode',
  'ultra-code': 'ultracode',
  ultra_code: 'ultracode',
};

// Whitelist exit. The effort label reaches stdout essentially verbatim, and
// one of its sources — config.defaultEffortLevel — comes from a
// codebuddy-hud.config.json in the conversation cwd, i.e. from whatever repo
// the user happens to be in. A value outside the whitelist is treated as
// untrusted and the resolution chain falls through to the next source.
function normalizeEffort(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (VALID_EFFORT_LEVELS.includes(v)) return v;
  if (EFFORT_ALIASES[v]) return EFFORT_ALIASES[v];
  return null;
}

// --- Session effort signal from the conversation transcript -----------------
//
// `/effort ultracode` is stored ONLY in the host's in-memory session meta
// (workflowEffortLevel is not part of the persisted meta subset), while
// non-ultracode levels are also persisted to settings.json's reasoningEffort.
// The statusLine payload itself carries no effort field, so with ultracode
// active the stale settings value would win. The durable per-session source
// is the transcript, where the host persists two entry shapes, both as
// `type:'message'` / `role:'user'` records flagged `providerData.skipRun`:
//   1. the command record whose whole text is `<command-name>/effort
//      </command-name><command-args>LEVEL</command-args>`,
//   2. its stdout record carrying a `data-role="ultra_effort_enter"` /
//      `"ultra_effort_exit"` system reminder.
// Entries are parsed structurally and scanned newest-first. Raw text matching
// is NOT viable: reasoning / tool-call / assistant entries routinely echo
// these marker strings in agent sessions (measured on a real session: every
// tail marker was an echo, and the newest echo won with an arbitrary value).
// The active-mode reminder (`ultra_effort_active`) is never persisted and is
// therefore not a signal at all.

const EFFORT_SIGNAL_TAIL_BYTES = 256 * 1024;
const EFFORT_SIGNAL_MAX_LINES = 400;

const EFFORT_COMMAND_RE = /^<command-name>\/effort<\/command-name><command-args>([^<]{0,40})<\/command-args>$/;

function entryText(entry) {
  if (typeof entry.content === 'string') return entry.content;
  if (!Array.isArray(entry.content)) return '';
  let text = '';
  for (const block of entry.content) {
    if (block && typeof block.text === 'string') text += block.text;
  }
  return text;
}

// Returns { decisive, value }: value is a whitelisted effort level, or null
// when the newest record proves no session override (e.g. ultracode exited).
// Non-decisive results keep the scan going at older records.
function decideEffortFromEntry(entry) {
  if (!entry || entry.type !== 'message' || entry.role !== 'user') return { decisive: false, value: null };
  if (!entry.providerData || entry.providerData.skipRun !== true) return { decisive: false, value: null };
  const text = entryText(entry);
  const command = EFFORT_COMMAND_RE.exec(text.trim());
  if (command) {
    // An empty or non-whitelisted argument (picker opened, a rejected level,
    // or the host's own unresolved `${level}` template) never changed the
    // session state, so older records still describe the current effort.
    const normalized = normalizeEffort(command[1]);
    return normalized ? { decisive: true, value: normalized } : { decisive: false, value: null };
  }
  if (text.includes('ultra_effort_exit')) return { decisive: true, value: null };
  if (text.includes('ultra_effort_enter')) return { decisive: true, value: 'ultracode' };
  return { decisive: false, value: null };
}

function scanTranscriptEffortSignal(resolved, size) {
  let fd = null;
  try {
    fd = fs.openSync(resolved, 'r');
    const len = Math.min(EFFORT_SIGNAL_TAIL_BYTES, size);
    const buf = Buffer.alloc(len);
    const bytesRead = fs.readSync(fd, buf, 0, len, size - len);
    if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0) return null;
    const lines = buf.toString('utf8', 0, bytesRead).split('\n');
    let scanned = 0;
    for (let i = lines.length - 1; i >= 0 && scanned < EFFORT_SIGNAL_MAX_LINES; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      scanned++;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // partial first line of the window or a corrupt line
      }
      const decision = decideEffortFromEntry(entry);
      if (decision.decisive) return decision.value;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

function getTranscriptEffortSignal(transcriptPath, cwd) {
  if (!transcriptPath || typeof transcriptPath !== 'string' || transcriptPath.includes('\0')) return null;
  let resolved;
  try {
    resolved = path.isAbsolute(transcriptPath)
      ? transcriptPath
      : path.resolve(cwd || process.cwd(), transcriptPath);
  } catch {
    return null;
  }

  let size = 0;
  try {
    size = fs.statSync(resolved).size;
  } catch {
    return null;
  }
  if (size <= 0) return null;
  return scanTranscriptEffortSignal(resolved, size);
}

function resolveEffortLevel(cbData, config) {
  if (!cbData) return null;

  let effort = normalizeEffort(cbData.reasoning_effort);
  if (effort) return effort;

  if (cbData.model) {
    effort = normalizeEffort(cbData.model.effort) || normalizeEffort(cbData.model.reasoning_effort);
    if (effort) return effort;
  }

  // Session-scoped override from the transcript. Mirrors the host's own
  // resolveEffectiveLevel order: the session selection wins over the
  // settings.json reasoningEffort fallback. This is what keeps `ultracode`
  // (which is never persisted to settings) visible on Line 1.
  effort = getTranscriptEffortSignal(
    cbData.transcript_path,
    cbData.cwd || (cbData.workspace && cbData.workspace.current_dir),
  );
  if (effort) return effort;

  effort = normalizeEffort(getSettingsReasoningEffort());
  if (effort) return effort;

  effort = inferEffortFromModel(cbData);
  if (effort) return effort;

  return normalizeEffort(config && config.defaultEffortLevel);
}

/**
 * Resolve an actual credit spend reported directly in the statusLine payload.
 * Model metadata contains a rate (for example, "x0.17 credits"), not what the
 * current conversation spent. Returning it here produced a misleading
 * "0.00x credits" fallback when the metadata was absent or encoded.
 * @param {object} cbData
 * @returns {number|null}
 */
function resolveCreditSpend(cbData) {
  const value = cbData && cbData.cost && cbData.cost.credits;
  if (value === undefined || value === null || value === '') return null;
  const credits = Number(value);
  return Number.isFinite(credits) && credits >= 0 ? credits : null;
}

function resetModelInfoCache() {
  _cachedSettingsEffort = null;
  _cachedSettingsEffortLoaded = false;
  _cachedSettingsEffortTime = 0;
  _cachedSettingsPath = null;
}

module.exports = {
  resolveEffortLevel,
  resolveCreditSpend,
  resetModelInfoCache,
};
