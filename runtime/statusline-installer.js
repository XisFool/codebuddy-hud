'use strict';

const fs = require('fs');
const path = require('path');
const { getSettingsPath, getHudSkillTargetDir, normalizePlatformPath } = require('./paths');
const { sanitizeTerminalText } = require('./sanitize');
const {
  atomicWriteSettingsFile,
  isSettingsObject,
  parseSettingsJson,
  writePrivateFileIfAbsent,
  getSettingsProperty,
  editSettingsProperty,
} = require('./settings-file');

const SKILL_MARKER = '.codebuddy-hud-managed';

function removeManagedSkill(targetDir, sourceDir) {
  let stat;
  try {
    stat = fs.lstatSync(targetDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  if (normalizePlatformPath(targetDir) === normalizePlatformPath(sourceDir)) {
    throw new Error('Refusing to remove the source skill directory');
  }
  if (stat.isSymbolicLink()) {
    const destination = path.resolve(path.dirname(targetDir), fs.readlinkSync(targetDir));
    if (normalizePlatformPath(destination) !== normalizePlatformPath(sourceDir)) {
      throw new Error('Existing skill link is not managed by this HUD; leaving it untouched');
    }
    fs.unlinkSync(targetDir);
  } else {
    const marker = path.join(targetDir, SKILL_MARKER);
    if (!stat.isDirectory() || !fs.existsSync(marker) || !fs.lstatSync(marker).isFile()
        || fs.readFileSync(marker, 'utf8') !== 'codebuddy-hud\n') {
      throw new Error('Existing skill directory is not managed by this HUD; leaving it untouched');
    }
    if (fs.existsSync(sourceDir)
        && normalizePlatformPath(fs.realpathSync(targetDir)) === normalizePlatformPath(fs.realpathSync(sourceDir))) {
      throw new Error('Refusing to remove the source skill directory');
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

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

function deploySkill(options, hudBin, platform) {
  const opts = options || {};
  // Prefer explicit parameters, otherwise infer project root from hudBin
  const rootDir = opts.rootDir || path.resolve(path.dirname(hudBin), '..', '..');
  const sourceDir = opts.sourceSkillDir || path.join(rootDir, 'skills', 'hud-config');
  const targetDir = opts.targetSkillDir || getHudSkillTargetDir();

  // 1. Safety check: source directory must exist and contain SKILL.md, otherwise safe-skip
  if (!fs.existsSync(path.join(sourceDir, 'SKILL.md'))) {
    return;
  }

  // 2. Self-loop guard: do not touch if source and target resolve to the same path
  try {
    if (path.resolve(sourceDir) === path.resolve(targetDir)) {
      return;
    }
  } catch {}

  try {
    // 3. Ensure target parent directory (~/.codebuddy/skills) exists
    const parentDir = path.dirname(targetDir);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // 4. Only replace a link to this source or a marked copy.
    removeManagedSkill(targetDir, sourceDir);

    // 5. Deploy skill: Windows prefers junction, POSIX prefers dir symlink
    const linkType = platform === 'win32' ? 'junction' : 'dir';
    try {
      fs.symlinkSync(sourceDir, targetDir, linkType);
      console.log(`Registered CodeBuddy skill: ${sanitizeTerminalText(targetDir, 512)}`);
    } catch {
      // Fall back to recursive directory copy
      fs.cpSync(sourceDir, targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, SKILL_MARKER), 'codebuddy-hud\n', { flag: 'wx', mode: 0o600 });
      console.log(`Registered CodeBuddy skill (copied): ${sanitizeTerminalText(targetDir, 512)}`);
    }
  } catch (err) {
    // Never fail statusLine configuration if skill registration encounters an error
    console.warn(`Warning: failed to register skill: ${sanitizeTerminalText(err && err.message, 160)}`);
  }
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
  let rawSettings = '';
  const fileExists = fs.existsSync(settingsPath);
  if (fileExists) {
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
    const { saveUserTheme } = require('./theme-selector');
    saveUserTheme(opts.theme);
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

  let statusLine = isSettingsObject(settings.statusLine)
    ? getSettingsProperty(rawSettings, 'statusLine') : '{}';
  statusLine = editSettingsProperty(statusLine, 'type', JSON.stringify('command'));
  statusLine = editSettingsProperty(statusLine, 'command', JSON.stringify(command));
  if (!isSettingsObject(settings.statusLine) || !Object.hasOwn(settings.statusLine, 'padding')) {
    statusLine = editSettingsProperty(statusLine, 'padding', '0');
  }
  atomicWriteSettingsFile(settingsPath, editSettingsProperty(rawSettings, 'statusLine', statusLine));
  console.log(`\nStatusLine configured in: ${sanitizeTerminalText(settingsPath, 512)}`);
  console.log(`Command: ${sanitizeTerminalText(command, 1024)}`);
  deploySkill(opts, hudBin, platform);
  console.log('\ncodebuddy-hud setup complete.');
}

module.exports = { setup, deploySkill, removeManagedSkill, buildStatusLineCommand, buildCmdShimContent, parseSettingsJson, isSettingsObject };
