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

function resolveEffortLevel(cbData, config) {
  if (!cbData) return null;

  let effort = normalizeEffort(cbData.reasoning_effort);
  if (effort) return effort;

  if (cbData.model) {
    effort = normalizeEffort(cbData.model.effort) || normalizeEffort(cbData.model.reasoning_effort);
    if (effort) return effort;
  }

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
