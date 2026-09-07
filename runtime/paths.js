'use strict';

const path = require('path');
const os = require('os');
const crypto = require('crypto');

function getCodeBuddyHome() {
  const home = os.homedir();
  const base = (home && typeof home === 'string' && home.trim()) ? home : os.tmpdir();
  return process.env.CODEBUDDY_HOME || path.join(base, '.codebuddy');
}

function resolveCodeBuddyPath(...segments) {
  return path.join(getCodeBuddyHome(), ...segments);
}

function getSettingsPath() {
  return process.env.CODEBUDDY_SETTINGS_PATH || resolveCodeBuddyPath('settings.json');
}

function getErrorLogPath() {
  return resolveCodeBuddyPath('codebuddy-hud-error.log');
}

function getCacheStatePath() {
  return resolveCodeBuddyPath('codebuddy-hud-cache-state.json');
}

function getCreditStatePath() {
  return resolveCodeBuddyPath('codebuddy-hud-credit-state.json');
}

function getTranscriptUsageStateDir() {
  return resolveCodeBuddyPath('codebuddy-hud-usage-state');
}

function getSessionStatsStateDir() {
  return resolveCodeBuddyPath('codebuddy-hud-session-state');
}

/**
 * Normalize path for platform-specific comparisons and hashing.
 * On Windows, paths are case-insensitive, so drive letters and paths are
 * lowercased to prevent hash fragmentation (e.g. d:\ vs D:\).
 * On POSIX platforms, case sensitivity is preserved.
 * @param {string} p
 * @returns {string}
 */
function normalizePlatformPath(p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) return '';
  try {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  } catch {
    return String(p);
  }
}

// Keep usage checkpoints independent for each transcript. The HUD is spawned
// by the host for every refresh and multiple workspaces may refresh at once;
// a single shared checkpoint would allow one transcript to overwrite another.
function getTranscriptUsageStatePath(transcriptPath) {
  const normalized = normalizePlatformPath(transcriptPath);
  const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  return path.join(getTranscriptUsageStateDir(), `${digest}.json`);
}

function getSessionStatsStatePath(identity) {
  const digest = crypto.createHash('sha256').update(String(identity || ''), 'utf8').digest('hex');
  return path.join(getSessionStatsStateDir(), `${digest}.json`);
}

// /clear may swap the transcript file entirely, orphaning the per-identity
// state. This cwd-scoped handoff record survives the swap and lets the next
// identity inherit the process-cumulative cost baseline.
function getSessionStatsHandoffPath(cwd) {
  const normalized = normalizePlatformPath(cwd);
  const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  return path.join(getSessionStatsStateDir(), `handoff-${digest}.json`);
}

function getSessionEffortStatePath(transcriptPath) {
  const normalized = normalizePlatformPath(transcriptPath);
  const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  return path.join(getSessionStatsStateDir(), `effort-${digest}.json`);
}

function getUserConfigPath() {
  return resolveCodeBuddyPath('codebuddy-hud.config.json');
}

function getUpdateStatusPath() {
  return resolveCodeBuddyPath('codebuddy-hud-update-status.json');
}

function getGitCachePath() {
  return resolveCodeBuddyPath('codebuddy-hud-git-cache.json');
}

module.exports = {
  getCodeBuddyHome,
  resolveCodeBuddyPath,
  getSettingsPath,
  getUserConfigPath,
  getErrorLogPath,
  getCacheStatePath,
  getGitCachePath,
  getCreditStatePath,
  getTranscriptUsageStateDir,
  getTranscriptUsageStatePath,
  getSessionStatsStateDir,
  getSessionStatsStatePath,
  getSessionStatsHandoffPath,
  getSessionEffortStatePath,
  getUpdateStatusPath,
  normalizePlatformPath,
};

