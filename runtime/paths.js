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

// Keep usage checkpoints independent for each transcript. The HUD is spawned
// by the host for every refresh and multiple workspaces may refresh at once;
// a single shared checkpoint would allow one transcript to overwrite another.
function getTranscriptUsageStatePath(transcriptPath) {
  const normalized = typeof transcriptPath === 'string' ? path.resolve(transcriptPath) : '';
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
  const digest = crypto.createHash('sha256').update(String(cwd || ''), 'utf8').digest('hex');
  return path.join(getSessionStatsStateDir(), `handoff-${digest}.json`);
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
  getUpdateStatusPath,
};

