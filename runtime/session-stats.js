'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getSessionStatsStatePath, getSessionStatsHandoffPath, normalizePlatformPath } = require('./paths');

const SESSION_STATS_VERSION = 1;
// Adaptive /clear detection thresholds: balance long initial prompts (3-4k tokens
// with Rules/Skills) against normal conversation fluctuations to prevent false
// positives while catching genuine session resets across all conversation sizes.
const CLEAR_INITIAL_MAX_TOKENS = 4096;  // Tolerate long system prompts
const CLIFF_DROP_MIN_TOKENS = 3000;     // Absolute drop floor (prevent trim misdetection)
const CLIFF_DROP_RATIO = 0.5;           // Cliff threshold: 50% relative drop
const MID_SESSION_MIN_TOKENS = 6000;    // Mid-size session accumulation floor
const MID_SESSION_RATIO = 0.65;         // Mid-size session relative drop threshold

function finiteNonNegative(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function hashValue(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function resolveTranscriptPath(transcriptPath, cwd) {
  if (typeof transcriptPath !== 'string' || !transcriptPath || transcriptPath.includes('\0')) return null;
  try {
    return path.isAbsolute(transcriptPath)
      ? path.resolve(transcriptPath)
      : path.resolve(typeof cwd === 'string' && cwd ? cwd : process.cwd(), transcriptPath);
  } catch {
    return null;
  }
}

// `session_id` is deliberately not used as the primary file name. Some hosts
// retain a transcript while changing its session id after a clear; retaining
// one checkpoint lets us spot that transition and reset the visible counters.
function getSessionIdentity(cbData, cwd) {
  const transcriptPath = resolveTranscriptPath(cbData && cbData.transcript_path, cwd);
  if (transcriptPath) return `transcript:${normalizePlatformPath(transcriptPath)}`;
  if (cbData && typeof cbData.session_id === 'string' && cbData.session_id && !cbData.session_id.includes('\0')) {
    return `session:${cbData.session_id}`;
  }
  return null;
}

function getResetSignal(cbData) {
  const context = cbData && cbData.context_window;
  const usage = context && typeof context === 'object' && context.current_usage;
  return {
    totalInputTokens: finiteNonNegative(context && typeof context === 'object' ? context.total_input_tokens : null),
    currentInputTokens: finiteNonNegative(usage && typeof usage === 'object' ? usage.input_tokens : null),
  };
}

function normalizeCost(costData) {
  const cost = costData || {};
  return {
    linesAdded: finiteNonNegative(cost.linesAdded) || 0,
    linesRemoved: finiteNonNegative(cost.linesRemoved) || 0,
    totalDurationMs: finiteNonNegative(cost.totalDurationMs) || 0,
    apiDurationMs: finiteNonNegative(cost.apiDurationMs) || 0,
  };
}

function createBaseline(cost) {
  return {
    linesAdded: cost.linesAdded,
    linesRemoved: cost.linesRemoved,
    totalDurationMs: cost.totalDurationMs,
    apiDurationMs: cost.apiDurationMs,
  };
}

function normalizeBaseline(value) {
  if (!value || typeof value !== 'object') return null;
  const values = ['linesAdded', 'linesRemoved', 'totalDurationMs', 'apiDurationMs'];
  if (values.some(key => finiteNonNegative(value[key]) === null)) return null;
  return createBaseline(value);
}

function readState(statePath, identityHash, transcriptSize) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!state || state.version !== SESSION_STATS_VERSION || state.identityHash !== identityHash) return null;
    const baseline = normalizeBaseline(state.baseline);
    if (!baseline || !state.signal || typeof state.signal !== 'object') return null;

    // Transcript physical truncation detection: if the current transcript file is
    // smaller than the last recorded size, the host truncated or rewrote it during
    // /clear. This is an OS-level hard signal with zero false-positive risk.
    let truncated = false;
    if (Number.isSafeInteger(state.transcriptSize) && state.transcriptSize > 0
        && Number.isSafeInteger(transcriptSize) && transcriptSize > 0
        && transcriptSize < state.transcriptSize) {
      truncated = true;
    }

    return {
      baseline,
      sessionIdHash: typeof state.sessionIdHash === 'string' ? state.sessionIdHash : null,
      signal: {
        totalInputTokens: finiteNonNegative(state.signal.totalInputTokens),
        currentInputTokens: finiteNonNegative(state.signal.currentInputTokens),
      },
      updatedAt: finiteNonNegative(state.updatedAt) || 0,
      transcriptSize: Number.isSafeInteger(state.transcriptSize) ? state.transcriptSize : 0,
      truncated,
    };
  } catch {
    return null;
  }
}

function writeState(statePath, state) {
  let tmpPath = null;
  try {
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(state));
    fs.renameSync(tmpPath, statePath);
  } catch {
    if (tmpPath) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
    // State persistence is optional. Rendering must never fail because a home
    // directory is read-only or another HUD process is replacing this file.
  }
}

function counterDropped(current, previous) {
  return current !== null && previous !== null && current < previous;
}

// Cliff drop: detects dramatic conversation resets where context plummets by both
// a large relative percentage (50%+) AND an absolute floor (3000+ tokens). This
// catches long sessions (e.g. 25k -> 3.5k) while ignoring normal context window
// trimming or small fluctuations that would otherwise false-positive.
function isCliffDrop(current, previous) {
  if (current === null || previous === null || current >= previous) return false;
  const relativeDrop = current <= previous * CLIFF_DROP_RATIO;
  const absoluteDrop = (previous - current) >= CLIFF_DROP_MIN_TOKENS;
  return relativeDrop && absoluteDrop;
}

// Return to initial: detects mid-size session clears where context returns to the
// initial prompt region (<= 4096) from an accumulated conversation (>= 6000),
// with a significant relative drop (35%+). This avoids false positives on:
//   - Normal 5200 -> 4800 fluctuations (neither crosses the initial threshold)
//   - Long initial prompts at 3800 tokens (no previous accumulation to compare)
function isReturnedToInitial(current, previous) {
  if (current === null || previous === null || current >= previous) return false;
  return (current <= CLEAR_INITIAL_MAX_TOKENS)
    && (previous >= MID_SESSION_MIN_TOKENS)
    && (current <= previous * MID_SESSION_RATIO);
}

// Integrated context reset detector: combines cliff-drop and return-to-initial
// strategies to reliably identify /clear across all conversation sizes without
// false positives on normal context window management.
function isContextReset(current, previous) {
  return isCliffDrop(current, previous) || isReturnedToInitial(current, previous);
}

function costCounterDropped(cost, baseline) {
  return cost.linesAdded < baseline.linesAdded
    || cost.linesRemoved < baseline.linesRemoved
    || cost.totalDurationMs < baseline.totalDurationMs
    || cost.apiDurationMs < baseline.apiDurationMs;
}

function subtractBaseline(cost, baseline) {
  return {
    linesAdded: Math.max(0, cost.linesAdded - baseline.linesAdded),
    linesRemoved: Math.max(0, cost.linesRemoved - baseline.linesRemoved),
    totalDurationMs: Math.max(0, cost.totalDurationMs - baseline.totalDurationMs),
    apiDurationMs: Math.max(0, cost.apiDurationMs - baseline.apiDurationMs),
  };
}

const HANDOFF_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes TTL

// /clear may swap the transcript file entirely, which orphans the per-identity
// state (a brand-new identity hash finds no checkpoint and the process-cumulative
// cost leaks through as if it belonged to the new session). The handoff record is
// keyed by cwd — which /clear does not change — and carries the last seen raw
// cumulative cost. On an identity miss we inherit that cost as the new baseline
// so the displayed Δ/⏱ restart at zero. A falling cost series means a genuinely
// new host process and must not inherit.
function readHandoffBaseline(handoffPath, cost, cwd) {
  if (!handoffPath || typeof cwd !== 'string' || !cwd) return null;
  try {
    const raw = fs.readFileSync(handoffPath, 'utf8');
    const handoff = JSON.parse(raw);
    if (!handoff || handoff.version !== SESSION_STATS_VERSION) return null;

    // 防线 1: TTL 检查，防止昨天或很久以前的残存 handoff 劫持冷启动新进程
    if (typeof handoff.updatedAt === 'number') {
      if (Date.now() - handoff.updatedAt > HANDOFF_MAX_AGE_MS) {
        return null;
      }
    }

    // 防线 2: 平台感知路径比对（消除 Windows 下 d:\ 与 D:\ 死锁）
    if (normalizePlatformPath(handoff.cwd) !== normalizePlatformPath(cwd)) {
      return null;
    }

    // 防线 3: 单调性掉落检查
    const lastCost = normalizeBaseline(handoff.cost);
    if (!lastCost || costCounterDropped(cost, lastCost)) return null;

    return createBaseline(lastCost);
  } catch {
    return null;
  }
}

// The host's cost fields are process-cumulative. `/clear` may preserve those
// fields even though it starts a new conversation, so retain a per-transcript
// baseline and subtract it only after a reliable reset signal.
function getLogicalSessionCostData(cbData, costData, opts) {
  const options = opts || {};
  const cost = normalizeCost(costData);
  const identity = getSessionIdentity(cbData, options.cwd);
  if (!identity) return cost;

  const identityHash = hashValue(identity);
  let statePath;
  try {
    statePath = typeof options.statePath === 'string' && options.statePath
      ? options.statePath
      : getSessionStatsStatePath(identity);
  } catch {
    return cost;
  }

  let handoffPath = null;
  try {
    if (typeof options.handoffPath === 'string' && options.handoffPath) {
      handoffPath = options.handoffPath;
    } else if (typeof options.cwd === 'string' && options.cwd) {
      handoffPath = getSessionStatsHandoffPath(options.cwd);
    }
  } catch {
    handoffPath = null;
  }

  // Get transcript size for physical truncation detection (hard signal)
  let transcriptSize = 0;
  const transcriptPath = resolveTranscriptPath(cbData && cbData.transcript_path, options.cwd);
  if (transcriptPath) {
    try {
      transcriptSize = fs.statSync(transcriptPath).size;
    } catch { /* file missing or inaccessible */ }
  }

  const sessionIdHash = cbData && typeof cbData.session_id === 'string' && cbData.session_id
    ? hashValue(cbData.session_id)
    : null;
  const signal = getResetSignal(cbData);
  const previous = readState(statePath, identityHash, transcriptSize);
  let baseline = previous ? previous.baseline : createBaseline({
    linesAdded: 0,
    linesRemoved: 0,
    totalDurationMs: 0,
    apiDurationMs: 0,
  });

  // Identity miss: the transcript path (or session id) is new. If the same host
  // process kept accumulating cost across that swap (typical /clear with a fresh
  // transcript file), inherit the handoff cost as the baseline so the new
  // conversation starts from zero instead of leaking the old cumulative values.
  if (!previous) {
    const handoffBaseline = readHandoffBaseline(handoffPath, cost, options.cwd);
    if (handoffBaseline) baseline = handoffBaseline;
  }

  // Multi-layer /clear detection with forward compatibility for explicit signals
  const explicitClearSignal = Boolean(cbData && (cbData.clear_signal || cbData.is_clear));
  const transcriptTruncated = Boolean(previous && previous.truncated);
  const sessionIdChanged = Boolean(previous && sessionIdHash && previous.sessionIdHash
    && sessionIdHash !== previous.sessionIdHash);
  const contextReset = Boolean(previous && isContextReset(signal.currentInputTokens, previous.signal.currentInputTokens));
  const inputCountersReset = Boolean(previous && (
    counterDropped(signal.totalInputTokens, previous.signal.totalInputTokens)
    || contextReset
  ));
  const hostCostCountersReset = Boolean(previous && costCounterDropped(cost, baseline));
  const reset = explicitClearSignal || transcriptTruncated || sessionIdChanged
    || inputCountersReset || hostCostCountersReset;
  // If only host cost counters fell, they already describe a new session and
  // should remain visible. If the context/session reset while cumulative cost
  // remains high, use that high value as the new baseline instead.
  if (explicitClearSignal || transcriptTruncated || sessionIdChanged || inputCountersReset) {
    baseline = createBaseline(cost);
  } else if (hostCostCountersReset) {
    baseline = createBaseline({
      linesAdded: 0,
      linesRemoved: 0,
      totalDurationMs: 0,
      apiDurationMs: 0,
    });
  }

  const baselineChanged = Boolean(
    !previous ||
    baseline.linesAdded !== previous.baseline.linesAdded ||
    baseline.linesRemoved !== previous.baseline.linesRemoved ||
    baseline.totalDurationMs !== previous.baseline.totalDurationMs ||
    baseline.apiDurationMs !== previous.baseline.apiDurationMs
  );
  const signalChanged = Boolean(
    !previous ||
    signal.totalInputTokens !== previous.signal.totalInputTokens ||
    signal.currentInputTokens !== previous.signal.currentInputTokens
  );
  const isDirty = !previous || reset || sessionIdChanged || baselineChanged || signalChanged;

  if (isDirty) {
    writeState(statePath, {
      version: SESSION_STATS_VERSION,
      identityHash,
      sessionIdHash,
      baseline,
      signal,
      transcriptSize,
      updatedAt: Date.now(),
    });
  }

  // Refresh the cwd-scoped handoff record on every invocation so the inherited
  // baseline after an identity swap reflects the cost at the moment of the swap.
  if (handoffPath) {
    writeState(handoffPath, {
      version: SESSION_STATS_VERSION,
      cost,
      cwd: typeof options.cwd === 'string' ? options.cwd : null,
      updatedAt: Date.now(),
    });
  }

  return subtractBaseline(cost, baseline);
}

module.exports = {
  getLogicalSessionCostData,
  getSessionIdentity,
  getResetSignal,
  SESSION_STATS_VERSION,
};
