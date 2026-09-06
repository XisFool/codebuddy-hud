'use strict';

const fs = require('fs');
const path = require('path');
const { getSettingsPath } = require('./paths');
const { sanitizeTerminalText } = require('./sanitize');

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
    // The host runs this through cmd; the generated .cmd shim handles quoting.
    return `"${String(hudBin).replace(/\.js$/, '.cmd')}"`;
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

function buildCmdShimContent(nodeExe) {
  const shortNode = resolveShortPath(String(nodeExe));
  const prefix = (process.platform === 'win32' && /[^\x00-\x7F]/.test(shortNode)) ? '@chcp 65001 >nul\r\n' : '';
  return prefix + '@echo off\r\n"' + shortNode.replace(/%/g, '%%') + '" "%~dp0codebuddy-hud.js" %*\r\n';
}

function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let inSingleComment = false;
  let inMultiComment = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inSingleComment) {
      if (ch === '\n' || ch === '\r') {
        inSingleComment = false;
        out += ch;
      }
      continue;
    }

    if (inMultiComment) {
      if (ch === '*' && next === '/') {
        inMultiComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      inSingleComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inMultiComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    out += ch;
  }

  return out.replace(/,\s*([}\]])/g, '$1');
}

function parseSettingsJson(raw) {
  let cleaned = raw;
  if (cleaned.charCodeAt(0) === 0xFEFF) {
    cleaned = cleaned.slice(1);
  }
  cleaned = stripJsonComments(cleaned).trim();
  if (!cleaned) return {};
  return JSON.parse(cleaned);
}

function atomicWriteFile(targetPath, content) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

function isSettingsObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

    // Unconditional backup of existing configuration before any modification
    const backupPath = settingsPath + '.bak.codebuddy-hud';
    if (!fs.existsSync(backupPath)) {
      try {
        fs.writeFileSync(backupPath, rawSettings);
        console.log(`Backed up existing settings to: ${sanitizeTerminalText(backupPath, 512)}`);
      } catch (err) {
        console.error(`Warning: could not create backup: ${sanitizeTerminalText(err && err.message, 160)}`);
      }
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
    const shimContent = buildCmdShimContent(nodeExe);
    try {
      fs.writeFileSync(cmdShim, shimContent);
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

  atomicWriteFile(settingsPath, JSON.stringify(settings, null, 2));
  console.log(`\nStatusLine configured in: ${sanitizeTerminalText(settingsPath, 512)}`);
  console.log(`Command: ${sanitizeTerminalText(command, 1024)}`);
  console.log('\ncodebuddy-cli-hud setup complete.');
}

module.exports = { setup, buildStatusLineCommand, buildCmdShimContent };
