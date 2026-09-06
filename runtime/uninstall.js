'use strict';

const fs = require('fs');
const path = require('path');
const {
  getSettingsPath,
  getCacheStatePath,
  getGitCachePath,
  getCreditStatePath,
  getTranscriptUsageStateDir,
  getSessionStatsStateDir,
  getUpdateStatusPath,
} = require('./paths');
const { sanitizeTerminalText } = require('./sanitize');
const { atomicWriteSettingsFile, parseSettingsJson, isSettingsObject } = require('./settings-file');

function uninstall(options) {
  const opts = options || {};
  const settingsPath = opts.settingsPath || getSettingsPath();
  const backupPath = settingsPath + '.bak.codebuddy-hud';
  const cachePath = getCacheStatePath();
  const gitCachePath = getGitCachePath();
  const updateStatusPath = getUpdateStatusPath();

  const creditPath = getCreditStatePath();
  const usageStateDir = getTranscriptUsageStateDir();
  const sessionStatsStateDir = getSessionStatsStateDir();
  const hudBin = opts.hudBin || path.join(opts.runtimeDir || __dirname, 'bin', 'codebuddy-hud.js');
  const cmdShim = hudBin.replace(/\.js$/, '.cmd');
  const platform = opts.platform || process.platform;

  let cleaned = [];

  // Restore backup or remove statusLine precisely
  try {
    if (fs.existsSync(settingsPath)) {
      let rawSettings = '';
      try {
        rawSettings = fs.readFileSync(settingsPath, 'utf8');
      } catch (err) {
        cleaned.push(`Warning: could not read settings.json: ${sanitizeTerminalText(err && err.message, 160)}`);
        throw err;
      }

      let settings = null;
      if (rawSettings && rawSettings.trim().length > 0) {
        try {
          const parsed = parseSettingsJson(rawSettings);
          if (isSettingsObject(parsed)) {
            settings = parsed;
          } else {
            cleaned.push('Warning: settings.json root is not an object, aborting modification');
          }
        } catch (err) {
          cleaned.push(`Warning: could not parse settings.json, aborting modification: ${sanitizeTerminalText(err && err.message, 160)}`);
        }
      } else if (rawSettings.trim().length === 0) {
        settings = {};
      }

      if (settings !== null) {
        let modified = false;
        let restoredBackup = false;
        if (fs.existsSync(backupPath)) {
          try {
            const backupRaw = fs.readFileSync(backupPath, 'utf8');
            const backup = parseSettingsJson(backupRaw);
            if (!isSettingsObject(backup)) {
              throw new Error('backup root is not a JSON object');
            }
            if (isSettingsObject(backup) && backup.statusLine) {
              settings.statusLine = backup.statusLine;
            } else {
              delete settings.statusLine;
            }
            modified = true;
            restoredBackup = true;
          } catch (err) {
            cleaned.push(`Warning: could not parse backup, retaining it: ${sanitizeTerminalText(err && err.message, 160)}`);
            if (settings.statusLine && typeof settings.statusLine.command === 'string' && settings.statusLine.command.includes('codebuddy-hud')) {
              delete settings.statusLine;
              modified = true;
            }
          }
        } else {
          if (settings.statusLine && typeof settings.statusLine.command === 'string' && settings.statusLine.command.includes('codebuddy-hud')) {
            delete settings.statusLine;
            cleaned.push('Removed statusLine from settings.json');
            modified = true;
          }
        }

        if (modified) {
          atomicWriteSettingsFile(settingsPath, JSON.stringify(settings, null, 2));
          if (restoredBackup) {
            try {
              fs.unlinkSync(backupPath);
              cleaned.push(`Restored settings from backup: ${sanitizeTerminalText(backupPath, 512)}`);
            } catch (err) {
              cleaned.push(`Warning: restored settings but retained backup: ${sanitizeTerminalText(err && err.message, 160)}`);
            }
          }
        }
      }
    }
  } catch {
    cleaned.push('Warning: could not modify settings.json');
  }

  // A POSIX install never creates a .cmd shim. Avoid deleting an unrelated
  // Windows artifact merely because a checkout is shared through WSL.
  if (platform === 'win32') {
    try {
      if (fs.existsSync(cmdShim)) {
        fs.unlinkSync(cmdShim);
        cleaned.push(`Removed Windows shim: ${sanitizeTerminalText(cmdShim, 512)}`);
      }
    } catch {
      cleaned.push('Warning: could not remove .cmd shim');
    }
  }

  // Remove cache state
  try {
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      cleaned.push(`Removed cache state: ${sanitizeTerminalText(cachePath, 512)}`);
    }
  } catch {
    // ignore
  }

  try {
    if (fs.existsSync(gitCachePath)) {
      fs.unlinkSync(gitCachePath);
      cleaned.push(`Removed git cache: ${sanitizeTerminalText(gitCachePath, 512)}`);
    }
  } catch {
    // ignore
  }

  try {
    if (fs.existsSync(usageStateDir)) {
      fs.rmSync(usageStateDir, { recursive: true, force: true });
      cleaned.push(`Removed transcript usage state: ${sanitizeTerminalText(usageStateDir, 512)}`);
    }
  } catch {
    // ignore
  }

  try {
    if (fs.existsSync(sessionStatsStateDir)) {
      fs.rmSync(sessionStatsStateDir, { recursive: true, force: true });
      cleaned.push(`Removed session statistics state: ${sanitizeTerminalText(sessionStatsStateDir, 512)}`);
    }
  } catch {
    // ignore
  }

  try {
    if (fs.existsSync(creditPath)) {
      fs.unlinkSync(creditPath);
      cleaned.push(`Removed credit state: ${sanitizeTerminalText(creditPath, 512)}`);
    }
  } catch {
    // ignore
  }

  // Note: userConfigPath (codebuddy-hud.config.json) is intentionally preserved to keep user customizations

  try {
    if (fs.existsSync(updateStatusPath)) {
      fs.unlinkSync(updateStatusPath);
      cleaned.push(`Removed update status: ${sanitizeTerminalText(updateStatusPath, 512)}`);
    }
  } catch {
    // ignore
  }


  if (cleaned.length === 0) {
    console.log('Nothing to uninstall.');
  } else {
    console.log('codebuddy-cli-hud uninstalled:');
    for (const msg of cleaned) {
      console.log(`  - ${msg}`);
    }
  }
}

module.exports = { uninstall };
