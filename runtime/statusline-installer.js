'use strict';

const fs = require('fs');
const path = require('path');
const { getSettingsPath } = require('./paths');
const { sanitizeTerminalText } = require('./sanitize');
const {
  atomicWriteSettingsFile,
  isSettingsObject,
  parseSettingsJson,
  writePrivateFileIfAbsent,
} = require('./settings-file');

// Escape characters that stay special inside a double-quoted shell word.
// Backslash must be escaped first, otherwise the backslashes added by the
// later replacements would themselves be escaped again.
function escapeShellArg(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

function buildStatusLineCommand(platform, hudBin, nodeExe) {
  if (platform === 'win32') {
    const shim = String(hudBin).replace(/\.js$/, '.cmd');
    // The Windows containment launcher double-escapes literal quotes. Omit
    // unnecessary quotes, but keep protecting paths with spaces/metacharacters.
    return /^[A-Za-z0-9_:/\\.-]+$/.test(shim) ? shim : `"${shim}"`;
  }
  return `"${escapeShellArg(nodeExe)}" "${escapeShellArg(hudBin)}"`;
}

// The shim bakes the absolute node path captured at setup time instead of a
// bare `node`: the host may invoke the statusLine with a PATH that differs
// from the user's shell (nvm/fnm/volta installs, GUI-spawned processes), where
// `node` silently resolves to nothing and the HUD renders blank. `%` is
// batch-escaped to `%%` — cmd.exe collapses it back to a literal percent at
// parse time, so a node install under a %-containing directory still resolves.
function resolveShortPath(p) {
  if (process.platform === 'win32' && /[^\x00-\x7F]/.test(p)) {
    try {
      const { execSync } = require('child_process');
      const out = execSync(`for %I in ("${p}") do @echo %~sI`, {
        shell: process.env.ComSpec || 'cmd.exe',
        windowsHide: true,
      }).toString().trim();
      if (out && fs.existsSync(out)) return out;
    } catch {}
  }
  return p;
}

function buildCmdShimContent(nodeExe, hudBin) {
  const shortNode = resolveShortPath(String(nodeExe));
  const rawNode = String(nodeExe);
  const rawHud = hudBin ? String(hudBin) : '';
  const hasNonAscii = /[^\x00-\x7F]/.test(rawNode) || /[^\x00-\x7F]/.test(shortNode) || /[^\x00-\x7F]/.test(rawHud);
  const prefix = (process.platform === 'win32' && hasNonAscii) ? '@chcp 65001 >nul\r\n' : '';
  return prefix + '@echo off\r\n"' + shortNode.replace(/%/g, '%%') + '" "%~dp0codebuddy-hud.js" %*\r\n';
}


// Options are intentionally internal/test-oriented. The CLI uses the defaults,
// while an isolated runtime lets regression tests exercise installation without
// writing a generated shim beside the checked-out source.
function setup(options) {
  const opts = options || {};
  const settingsPath = opts.settingsPath || getSettingsPath();
  const hudBin = opts.hudBin || path.join(opts.runtimeDir || __dirname, 'bin', 'codebuddy-hud.js');
  const nodeExe = opts.nodeExe || process.execPath;
  const platform = opts.platform || process.platform;

  let settings = {};
  const fileExists = fs.existsSync(settingsPath);
  if (fileExists) {
    let rawSettings = '';
    try {
      rawSettings = fs.readFileSync(settingsPath, 'utf8');
    } catch (err) {
      console.error(`Error: Could not read settings file: ${sanitizeTerminalText(err && err.message, 160)}`);
      throw err;
    }

    if (rawSettings.trim().length > 0) {
      try {
        const parsed = parseSettingsJson(rawSettings);
        if (!isSettingsObject(parsed)) {
          throw new Error('settings.json root must be a JSON object');
        }
        settings = parsed;
      } catch (err) {
        console.error(`Error: Failed to parse ${sanitizeTerminalText(settingsPath, 512)}: ${sanitizeTerminalText(err && err.message, 160)}`);
        console.error('Setup aborted to prevent overwriting invalid configuration.');
        throw err;
      }
    }

    // Preserve the exact pre-install content only after it has been validated.
    // An unavailable backup makes uninstall unable to restore a prior command,
    // so fail before changing settings rather than continue without one.
    const backupPath = settingsPath + '.bak.codebuddy-hud';
    try {
      if (writePrivateFileIfAbsent(backupPath, rawSettings)) {
        console.log(`Backed up existing settings to: ${sanitizeTerminalText(backupPath, 512)}`);
      }
    } catch (err) {
      console.error(`Error: could not create private backup: ${sanitizeTerminalText(err && err.message, 160)}`);
      throw err;
    }
  }

  if (opts.theme) {
    try {
      const { saveUserTheme } = require('./theme-selector');
      saveUserTheme(opts.theme);
    } catch {
      // ignore
    }
  }

  // Build command string
  let command;
  if (platform === 'win32') {
    const cmdShim = hudBin.replace(/\.js$/, '.cmd');
    const shimContent = buildCmdShimContent(nodeExe, hudBin);
    try {
      fs.writeFileSync(cmdShim, shimContent, 'utf8');
      console.log(`Created Windows shim: ${sanitizeTerminalText(cmdShim, 512)}`);
    } catch (err) {
      console.error(`Error: could not create .cmd shim: ${sanitizeTerminalText(err && err.message, 160)}`);
      throw err;
    }
  } else {
    // The command runs `node <file>`, so the executable bit is not required;
    // chmod only makes the shebang'd script directly runnable by hand.
    try {
      fs.chmodSync(hudBin, 0o755);
    } catch {
      // read-only filesystem or missing file — setup must not fail on this
    }
  }
  command = buildStatusLineCommand(platform, hudBin, nodeExe);

  settings.statusLine = {
    type: 'command',
    command: command,
    padding: 0,
  };

  atomicWriteSettingsFile(settingsPath, JSON.stringify(settings, null, 2));
  console.log(`\nStatusLine configured in: ${sanitizeTerminalText(settingsPath, 512)}`);
  console.log(`Command: ${sanitizeTerminalText(command, 1024)}`);
  console.log('\ncodebuddy-cli-hud setup complete.');
}

module.exports = { setup, buildStatusLineCommand, buildCmdShimContent, parseSettingsJson, isSettingsObject };
