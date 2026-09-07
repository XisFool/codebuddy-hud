'use strict';

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseCodeBuddyInput(jsonStr) {
  if (!jsonStr || typeof jsonStr !== 'string') return null;
  const trimmed = jsonStr.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

function extractTokenData(cbData) {
  if (!cbData) return null;
  const cw = cbData.context_window;
  if (!cw || typeof cw !== 'object') return null;

  const usage = cw.current_usage || {};
  return {
    inTokens: num(usage.input_tokens),
    outTokens: num(usage.output_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
    cacheWrite: num(usage.cache_creation_input_tokens),
    totalInput: num(cw.total_input_tokens),
    totalOutput: num(cw.total_output_tokens),
    ctxSize: num(cw.context_window_size),
    ctxPercent: num(cw.used_percentage),
  };
}

function extractDiffStats(cbData) {
  if (!cbData) return { linesAdded: 0, linesRemoved: 0 };
  const cost = cbData.cost;
  if (!cost || typeof cost !== 'object') return { linesAdded: 0, linesRemoved: 0 };
  return {
    linesAdded: num(cost.total_lines_added),
    linesRemoved: num(cost.total_lines_removed),
  };
}

function extractCostData(cbData) {
  if (!cbData) return null;
  const cost = cbData.cost;
  if (!cost || typeof cost !== 'object') return null;
  return {
    totalCostUsd: num(cost.total_cost_usd),
    totalDurationMs: num(cost.total_duration_ms),
    apiDurationMs: num(cost.total_api_duration_ms),
  };
}

module.exports = {
  parseCodeBuddyInput,
  extractTokenData,
  extractDiffStats,
  extractCostData,
  num,
};
