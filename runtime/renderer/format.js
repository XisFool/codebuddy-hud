'use strict';

const ANSI_COLORS = {
  gray: '\x1b[90m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  brightMagenta: '\x1b[95m',
  yellow: '\x1b[33m',
  gold: '\x1b[93m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  white: '\x1b[37m',
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function color(text, colorName) {
  const code = ANSI_COLORS[colorName] || '';
  if (!code) return text;
  return code + text + RESET;
}

function bold(text) {
  return BOLD + text + RESET;
}

function dim(text) {
  return DIM + text + RESET;
}

function formatTokens(n) {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 999950) {
    const val = n / 1000000;
    let str = val.toFixed(1);
    if (str.endsWith('.0')) str = str.slice(0, -2);
    return str + 'M';
  }
  if (n >= 999.5) {
    const val = n / 1000;
    let str = val.toFixed(1);
    if (str.endsWith('.0')) str = str.slice(0, -2);
    return str + 'k';
  }
  return Math.round(n).toString();
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const secs = Math.floor(ms / 1000);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d >= 10) return `${d}d`;
  if (d > 0) return `${d}d${h}h`;
  if (h >= 10) return `${h}h`;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function createProgressBar(percent, width, thresholds, glyphs) {
  const safeWidth = Number.isFinite(width) ? Math.max(4, Math.min(40, Math.floor(width))) : 12;
  const filledChar = glyphs.bar;
  const emptyChar = glyphs.empty;
  const pct = Math.max(0, Math.min(100, percent));
  const filled = Math.round((pct / 100) * safeWidth);
  const empty = safeWidth - filled;

  let colorName = 'green';
  const warnPct = ((thresholds && thresholds.warning) || 0.7) * 100;
  const critPct = ((thresholds && thresholds.critical) || 0.9) * 100;
  if (pct >= critPct) colorName = 'red';
  else if (pct >= warnPct) colorName = 'yellow';

  const filledPart = filled > 0 ? color(filledChar.repeat(filled), colorName) : '';
  const emptyPart = empty > 0 ? `${DIM}${ANSI_COLORS.gray}${emptyChar.repeat(empty)}${RESET}` : '';
  return filledPart + emptyPart;
}

function getThemeColor(config, key, fallback) {
  const name = (config && config.theme && config.theme[key]) || fallback;
  return ANSI_COLORS[name] || ANSI_COLORS[fallback] || '';
}

function themeColor(config, key, text, fallback) {
  const name = (config && config.theme && config.theme[key]) || fallback;
  return color(text, name);
}

// Distinguish "field missing" from "field is 0". Returns null for missing,
// non-numeric, or NaN values; the number (including 0) otherwise. Lets the
// cache pipeline render `cache --` when the payload lacks cache telemetry
// rather than silently displaying 0% for a provider that didn't report.
function normalizeTokenCount(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    // Number('') === 0 would smuggle an empty payload field through as a
    // genuine zero; missing stays missing.
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Sum `cached_tokens` across inputTokensDetails entries (OpenAI-style array).
function sumCachedTokens(details) {
  if (!Array.isArray(details)) return null;
  let total = 0;
  let sawNumber = false;
  for (const d of details) {
    if (d && Number.isFinite(d.cached_tokens)) {
      total += d.cached_tokens;
      sawNumber = true;
    }
  }
  return sawNumber ? total : null;
}

// Three-state contract:
//   null              — usage object missing entirely; renderer drops the badge
//   {available:false} — usage present but required fields missing; renderer
//                       shows `cache --` so the user can see "no telemetry"
//                       instead of a misleading 0.0%
//   {available:true,…} — computable; renderer shows the value (even 0.0%)
//
// Field priority — this ordering matters, see the TRAP note below:
//   1. prompt_cache_hit_tokens / prompt_tokens   (rawUsage; self-consistent)
//   2. inputTokensDetails[].cached_tokens / inputTokens  (OpenAI `usage`)
//   3. cache_read_input_tokens / input_tokens    (Anthropic-style; legacy)
//
// TRAP: on this provider, `cache_read_input_tokens` is present but hard-zero,
// while the real hit count lives in `prompt_cache_hit_tokens`. Reading only the
// Anthropic-style name (priority 3) reported ~0% for sessions actually hitting
// 96-99%. Priorities 1 and 2 exist so a present-but-zero legacy field never
// masks the real telemetry.
//
// Denominator semantics: for priorities 1 and 2 the provider counts cache hits
// INSIDE the prompt total (hit + miss === prompt_tokens), so the denominator is
// the prompt total as-is. Only the Anthropic shape (priority 3) may exclude
// cache from input_tokens, so it keeps the self-adaptive denominator.
function calculateTurnCacheMetrics(usage) {
  if (!usage || typeof usage !== 'object') return null;

  // Priority 1 — rawUsage (authoritative)
  let hit = normalizeTokenCount(usage.prompt_cache_hit_tokens);
  if (hit === null && usage.prompt_tokens_details) {
    hit = normalizeTokenCount(usage.prompt_tokens_details.cached_tokens);
  }
  if (hit === null) {
    hit = normalizeTokenCount(usage.cached_tokens);
  }
  const prompt = normalizeTokenCount(usage.prompt_tokens);
  if (prompt !== null && prompt > 0 && hit !== null) {
    return {
      available: true,
      hitRate: Math.min(100, Math.max(0, (hit / prompt) * 100)),
      cacheRead: hit,
      totalPrompt: prompt,
      source: 'prompt_cache_hit',
    };
  }

  // Priority 2 — OpenAI `usage` shape
  const oaiInput = normalizeTokenCount(usage.inputTokens);
  if (oaiInput !== null && oaiInput > 0) {
    const cached = sumCachedTokens(usage.inputTokensDetails);
    if (cached !== null) {
      return {
        available: true,
        hitRate: Math.min(100, Math.max(0, (cached / oaiInput) * 100)),
        cacheRead: cached,
        totalPrompt: oaiInput,
        source: 'inputTokensDetails',
      };
    }
  }

  // Priority 3 — Anthropic-style legacy fields
  const cacheRead = normalizeTokenCount(usage.cache_read_input_tokens);
  const cacheWrite = normalizeTokenCount(usage.cache_creation_input_tokens);
  const inTokens = normalizeTokenCount(usage.input_tokens);

  if (cacheRead === null || inTokens === null) return { available: false };

  const cacheWriteSafe = cacheWrite === null ? 0 : cacheWrite;
  const cacheTotal = cacheRead + cacheWriteSafe;
  const totalPrompt = inTokens >= cacheTotal ? inTokens : inTokens + cacheTotal;

  if (totalPrompt === 0) return { available: false };

  const hitRate = Math.min(100, Math.max(0, (cacheRead / totalPrompt) * 100));
  return { available: true, hitRate, cacheRead, totalPrompt, source: 'cache_read_input_tokens' };
}

// Build metrics from a transcript-sourced {hitTokens, promptTokens} pair.
// These come from providerData, where hits are counted inside the prompt total
// (hit + miss === promptTokens), so the denominator needs no adjustment.
function metricsFromPromptCache(hitTokens, promptTokens) {
  const hit = normalizeTokenCount(hitTokens);
  const prompt = normalizeTokenCount(promptTokens);
  if (hit === null || prompt === null || prompt <= 0) return null;
  return {
    available: true,
    hitRate: Math.min(100, Math.max(0, (hit / prompt) * 100)),
    cacheRead: hit,
    totalPrompt: prompt,
    source: 'transcript',
  };
}

function formatTurnCacheBadge(metrics, label, isCompact, thresholds) {
  label = label || 'cache';
  thresholds = thresholds || {};
  const excellentThresh = thresholds.excellent || 80;
  const partialThresh = thresholds.partial || 50;

  if (!metrics || !metrics.available) {
    return `${DIM}${ANSI_COLORS.gray}${label} --${RESET}`;
  }

  const rate = metrics.hitRate;
  const rateStr = rate.toFixed(1) + '%';
  const text = `${label} ${rateStr}`;

  if (rate >= excellentThresh) {
    return `${ANSI_COLORS.green}${BOLD}${text}${RESET}`;
  }
  if (rate >= partialThresh) {
    return `${ANSI_COLORS.yellow}${text}${RESET}`;
  }
  if (rate > 0) {
    return `${ANSI_COLORS.yellow}${DIM}${text}${RESET}`;
  }
  return `${ANSI_COLORS.gray}${DIM}${text}${RESET}`;
}

module.exports = {
  ANSI_COLORS, RESET, BOLD, DIM,
  color, bold, dim, themeColor,
  formatTokens, formatDurationMs, createProgressBar, getThemeColor,
  calculateTurnCacheMetrics, formatTurnCacheBadge, normalizeTokenCount,
  metricsFromPromptCache, sumCachedTokens,
};

