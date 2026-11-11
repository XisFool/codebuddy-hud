'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  getSettingsPath,
  getCacheStatePath,
  getGitCachePath,
  getCreditStatePath,
  getTranscriptUsageStateDir,
  getSessionStatsStateDir,
  getUpdateStatusPath,
  getHudSkillTargetDir,
} = require('./paths');
const { sanitizeTerminalText } = require('./sanitize');
const {
  atomicWriteSettingsFile, parseSettingsJson, isSettingsObject,
  getSettingsProperty, editSettingsProperty, writePrivateFileIfAbsent,
} = require('./settings-file');
const { removeManagedSkill } = require('./statusline-installer');

// A statusLine belongs to this HUD when its command mentions `codebuddy-hud`.
// The literal name covers every install shape: an absolute or relative
// checkout path, the generated `.cmd` shim, and a bare `codebuddy-hud`
// resolved through PATH (the npm global shim created by `npm link`), where no
// directory ever appears in the string.
// Used only to vet a backup's statusLine: a snapshot that already contains
// any HUD command must never be restored, or uninstalling one checkout would
// leave another checkout's HUD configured.
function isHudStatusLine(statusLine) {
  return !!(statusLine && typeof statusLine === 'object'
    && typeof statusLine.command === 'string'
    && statusLine.command.includes('codebuddy-hud'));
}

// Strict check for the *current* statusLine: does the command actually invoke
// this checkout's entrypoint (or its `.cmd` shim, or a bare `codebuddy-hud`
// that PATH resolves to this checkout)? The substring test above let
// `--uninstall` from a second checkout restore the first one's backup and
// delete the live install.
function shellTokenCandidates(token) {
  if (process.platform === 'win32') return [token];
  const unescaped = token.replace(/\\(["\\`$])/g, '$1');
  return unescaped === token ? [token] : [token, unescaped];
}

function tokenizeStatusLineCommand(command) {
  const tokens = [];
  const tokenRe = /"((?:\\.|[^"\\])*)"|(\S+)/g;
  let match;
  while ((match = tokenRe.exec(command)) !== null) {
    tokens.push(match[1] !== undefined ? match[1] : match[2]);
  }
  return tokens;
}

function findCommandInPath(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter);
  const exts = process.platform === 'win32' ? ['', '.cmd', '.bat', '.exe'] : [''];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // keep scanning
      }
    }
  }
  return null;
}

function statusLineTargetsThisHud(statusLine, hudBin) {
  if (!statusLine || typeof statusLine !== 'object' || typeof statusLine.command !== 'string') {
    return false;
  }
  const resolved = new Set();
  for (const target of [hudBin, hudBin.replace(/\.js$/, '.cmd')]) {
    try { resolved.add(path.resolve(target)); } catch { /* ignore */ }
  }
  for (const token of tokenizeStatusLineCommand(statusLine.command)) {
    for (const candidate of shellTokenCandidates(token)) {
      if (/[\\/]/.test(candidate)) {
        try {
          if (resolved.has(path.resolve(candidate))) return true;
        } catch { /* ignore */ }
      } else if (candidate === 'codebuddy-hud' || candidate === 'codebuddy-hud.js'
          || candidate === 'codebuddy-hud.cmd') {
        const found = findCommandInPath(candidate);
        if (found) {
          try {
            if (resolved.has(path.resolve(found))) return true;
          } catch { /* ignore */ }
        }
      }
    }
  }
  return false;
}

function pathEntryKey(entry) {
  let value = String(entry).trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  try {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  } catch {
    return value;
  }
}

// The raw registry value must be compared without expanding %VAR% entries;
// otherwise uninstall would rewrite unrelated PATH entries.
function stripBinDirFromUserPath(rawPath, binDir) {
  const entries = String(rawPath || '').split(';').filter((entry) => entry.trim() !== '');
  const target = pathEntryKey(binDir);
  const filtered = entries.filter((entry) => pathEntryKey(entry) !== target);
  return { changed: filtered.length < entries.length, value: filtered.join(';') };
}

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
  // Settings existed but could not be processed (unreadable, invalid JSON or
  // non-object root). Nothing in settings.json was changed in that case, so
  // the run must not claim a successful uninstall.
  let settingsBroken = false;

  // Restore backup or remove statusLine precisely. `settingsCleaned` records
  // whether settings.json is confirmed free of a statusLine reference
  // afterwards; the Windows shim must only be deleted when it is, otherwise a
  // failed write leaves the host pointing at a command that no longer exists.
  let settingsCleaned = false;
  try {
    if (!fs.existsSync(settingsPath)) {
      settingsCleaned = true;
    } else {
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
            settingsBroken = true;
          }
        } catch (err) {
          cleaned.push(`Warning: could not parse settings.json, aborting modification: ${sanitizeTerminalText(err && err.message, 160)}`);
          settingsBroken = true;
        }
      } else if (rawSettings.trim().length === 0) {
        settings = {};
      }

      if (settings !== null) {
        let modified = false;
        // Reported only after a successful write, so a failed write cannot
        // claim the entry was removed.
        let removedStatusLine = false;
        // Describes how the on-disk backup was consumed; also drives its
        // deletion. Null means no backup was present.
        let backupAction = null;
        let backupContent = null;
        let restoredStatusLine;
        let restoredSettings;

        const ours = statusLineTargetsThisHud(settings.statusLine, hudBin);
        if (!ours) {
          // The entry belongs to another checkout (or a hand-written command):
          // leave settings.json and its install-time backup untouched.
          if (settings.statusLine) {
            cleaned.push('Warning: statusLine is not managed by this HUD; settings.json left unchanged');
          }
        } else if (fs.existsSync(backupPath)) {
          try {
            const backupRaw = fs.readFileSync(backupPath, 'utf8');
            const backup = parseSettingsJson(backupRaw);
            if (!isSettingsObject(backup)) {
              throw new Error('backup root is not a JSON object');
            }
            backupContent = backupRaw;
            // Restore exact whitespace too, but only when a text comparison
            // proves that nothing outside statusLine changed after setup.
            if (isHudStatusLine(settings.statusLine) && !isHudStatusLine(backup.statusLine)
                && editSettingsProperty(backupRaw, 'statusLine', getSettingsProperty(rawSettings, 'statusLine')) === rawSettings) {
              restoredSettings = backupRaw;
            }
            // Restore only a statusLine that is not this HUD. The backup may
            // itself have been taken over an earlier HUD install (another
            // checkout, or the `npm link` global shim); reinstating it would
            // report a successful uninstall while leaving the HUD configured.
            if (Object.hasOwn(backup, 'statusLine') && !isHudStatusLine(backup.statusLine)) {
              if (isHudStatusLine(settings.statusLine)) {
                settings.statusLine = backup.statusLine;
                restoredStatusLine = getSettingsProperty(backupRaw, 'statusLine');
                backupAction = 'Restored settings from backup';
                modified = true;
              } else {
                // The statusLine was replaced or removed after installation;
                // that later choice wins over the install-time snapshot.
                backupAction = 'Discarded backup (statusLine changed after install)';
              }
            } else {
              if (isHudStatusLine(settings.statusLine)) {
                delete settings.statusLine;
                modified = true;
              }
              backupAction = 'Consumed backup without restoring a statusLine';
            }
          } catch (err) {
            cleaned.push(`Warning: could not parse backup, retaining it: ${sanitizeTerminalText(err && err.message, 160)}`);
            if (isHudStatusLine(settings.statusLine)) {
              delete settings.statusLine;
              modified = true;
            }
          }
        } else {
          delete settings.statusLine;
          removedStatusLine = true;
          modified = true;
        }

        if (modified) {
          rawSettings = restoredSettings === undefined
            ? editSettingsProperty(rawSettings, 'statusLine', restoredStatusLine) : restoredSettings;
          atomicWriteSettingsFile(settingsPath, rawSettings);
        }

        if (removedStatusLine) {
          cleaned.push('Removed statusLine from settings.json');
        }

        if (backupAction) {
          try {
            // A legacy install may already have stripped comments. Keep its
            // original text when it differs from the restored settings, but
            // retire the active backup so a later install takes a fresh one.
            if (backupContent !== rawSettings) {
              const retainedPath = `${backupPath}.retained-${Date.now()}-${process.pid}`;
              if (!writePrivateFileIfAbsent(retainedPath, backupContent)) {
                throw new Error('Recovery copy already exists');
              }
              cleaned.push(`Retained original settings: ${sanitizeTerminalText(retainedPath, 512)}`);
            }
            fs.unlinkSync(backupPath);
            cleaned.push(`${backupAction}: ${sanitizeTerminalText(backupPath, 512)}`);
          } catch (err) {
            cleaned.push(`Warning: ${backupAction} but retained backup: ${sanitizeTerminalText(err && err.message, 160)}`);
          }
        }

        settingsCleaned = true;
      }
    }
  } catch {
    cleaned.push('Warning: could not modify settings.json');
    settingsBroken = true;
  }

  // A POSIX install never creates a .cmd shim. Avoid deleting an unrelated
  // Windows artifact merely because a checkout is shared through WSL.
  if (platform === 'win32') {
    if (!settingsCleaned) {
      cleaned.push('Warning: kept Windows shim because settings.json could not be cleaned');
    } else {
      try {
        if (fs.existsSync(cmdShim)) {
          fs.unlinkSync(cmdShim);
          cleaned.push(`Removed Windows shim: ${sanitizeTerminalText(cmdShim, 512)}`);
        }
      } catch {
        cleaned.push('Warning: could not remove .cmd shim');
      }
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

  // Remove deployed skill
  const skillDir = opts.targetSkillDir || getHudSkillTargetDir();
  let skillExists = false;
  try {
    fs.lstatSync(skillDir);
    skillExists = true;
  } catch {}

  if (skillExists) {
    try {
      const sourceDir = opts.sourceSkillDir
        || path.resolve(path.dirname(hudBin), '..', '..', 'skills', 'hud-config');
      removeManagedSkill(skillDir, sourceDir);
      cleaned.push(`Removed CodeBuddy skill: ${sanitizeTerminalText(skillDir, 512)}`);
    } catch (err) {
      cleaned.push(`Warning: could not remove skill: ${sanitizeTerminalText(err && err.message, 160)}`);
    }
  }

  // Clean up PATH / symlink — skip in sandbox/test mode (CODEBUDDY_HOME is set)
  const isSandbox = !!process.env.CODEBUDDY_HOME;
  if (!isSandbox) {
    const binDir = path.dirname(hudBin);
    if (platform === 'win32') {
      // Read the raw value and its registry kind, then write it back with the
      // same kind. [Environment]::SetEnvironmentVariable would store REG_SZ and
      // permanently flatten REG_EXPAND_SZ entries such as %JAVA_HOME%\bin.
      try {
        const rawRegistryPath = execFileSync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          "$ErrorActionPreference = 'Stop'; $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment'); if ($key) { $kind = $key.GetValueKind('Path'); $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $key.Close(); [pscustomobject]@{ kind = $kind.ToString(); value = $raw } | ConvertTo-Json -Compress }",
        ], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
        if (rawRegistryPath) {
          const userPath = JSON.parse(rawRegistryPath);
          const filtered = stripBinDirFromUserPath(userPath.value, binDir);
          if (filtered.changed) {
            execFileSync('powershell.exe', [
              '-NoProfile', '-NonInteractive', '-Command',
              "$ErrorActionPreference = 'Stop'; $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true); if ($key) { $key.SetValue('Path', $env:CODEBUDDY_HUD_USER_PATH, [Microsoft.Win32.RegistryValueKind]$env:CODEBUDDY_HUD_USER_PATH_KIND); $key.Close() }",
            ], {
              timeout: 5000,
              windowsHide: true,
              env: {
                ...process.env,
                CODEBUDDY_HUD_USER_PATH: filtered.value,
                CODEBUDDY_HUD_USER_PATH_KIND: userPath.kind,
              },
            });
            cleaned.push(`Removed from user PATH: ${sanitizeTerminalText(binDir, 512)}`);
          }
        }
      } catch {
        // non-fatal: PATH cleanup is best-effort
      }
    } else {
      // POSIX: remove ~/.local/bin/codebuddy-hud symlink if it points to this runtime
      try {
        const home = process.env.HOME || require('os').homedir();
        const symlink = path.join(home, '.local', 'bin', 'codebuddy-hud');
        if (fs.existsSync(symlink)) {
          const target = fs.readlinkSync(symlink);
          if (path.resolve(target) === path.resolve(hudBin)) {
            fs.unlinkSync(symlink);
            cleaned.push(`Removed symlink: ${sanitizeTerminalText(symlink, 512)}`);
          }
        }
      } catch {
        // non-fatal
      }
    }
  }

  // Separate what was actually done from warnings: a warning-only run must
  // not claim "codebuddy-hud uninstalled:" (the old header did exactly that
  // when settings.json failed to parse and nothing was changed).
  const actions = cleaned.filter(msg => !msg.startsWith('Warning: '));
  if (cleaned.length === 0) {
    console.log('Nothing to uninstall.');
    return true;
  }
  console.log(settingsBroken || actions.length === 0
    ? 'codebuddy-hud uninstall incomplete:'
    : 'codebuddy-hud uninstalled:');
  for (const msg of cleaned) {
    console.log(`  - ${msg}`);
  }
  return !settingsBroken && actions.length > 0;
}

module.exports = { uninstall, stripBinDirFromUserPath };
