'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getCodeBuddyHome, getSettingsPath, getErrorLogPath, getTranscriptUsageStateDir, normalizePlatformPath, getUserConfigPath } = require('./paths');
const { supportsUnicode } = require('./encoding');
const { detectThemeMode, loadConfig, isPresetName } = require('./config');
const { getGitStatus } = require('./git');
const { getI18n } = require('./lang');
const { sanitizeTerminalText } = require('./sanitize');
const { parseSettingsJson } = require('./settings-file');

function getConsoleCodePage() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync('chcp.com', {
      encoding: 'utf8',
      timeout: 2000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = out.match(/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function checkNodeEnvironment(i18n) {
  const version = process.version;
  const major = parseInt(version.replace(/^v/, '').split('.')[0], 10);
  const isOk = major >= 18;
  return {
    category: 'node',
    name: i18n.t('nodeVersion'),
    status: isOk ? 'ok' : 'fail',
    detail: `${version} (${process.platform} ${process.arch})`,
    path: process.execPath,
    message: isOk ? null : i18n.t('doctorNodeOld'),
  };
}

// The statusLine command has two known install shapes: POSIX `"<node>" "<hud.js>"`
// and win32 a .cmd shim that forwards to a sibling `codebuddy-hud.js`
// (see statusline-installer). Checking only the first token let a missing HUD
// entrypoint (or a shim whose forwarded script is gone) pass as healthy.
// POSIX installs are written through escapeShellArg (\ " ` $ escaped), so a
// quoted token must be tokenized with escape awareness and checked in both its
// literal and unescaped form. Win32 commands are checked only literally: \\
// and \$ are path characters (UNC paths, $-prefixed directories), not escapes.
function shellTokenCandidates(token) {
  if (process.platform === 'win32') return [token];
  const unescaped = token.replace(/\\(["\\`$])/g, '$1');
  return unescaped === token ? [token] : [token, unescaped];
}

function tokenizeStatusLineCommand(command, escapeAware) {
  const tokens = [];
  const tokenRe = escapeAware
    ? /"((?:\\.|[^"\\])*)"|(\S+)/g
    : /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = tokenRe.exec(command)) !== null) {
    tokens.push(match[1] !== undefined ? match[1] : match[2]);
  }
  return tokens;
}

function isRegularFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// Resolve a bare command through PATH. Windows installs may use
// `codebuddy-hud` (npm link) or `codebuddy-hud.cmd` (generated shim).
function findCommandInPath(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter);
  const exts = process.platform === 'win32' ? ['', '.cmd', '.bat', '.exe'] : [''];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (isRegularFile(candidate)) return candidate;
    }
  }
  return null;
}

// A token is only a real target when it can actually be executed:
// - path-like tokens must be regular files (a directory passed doctor before);
// - a bare first token is resolved through PATH (it used to be checked
//   relative to the cwd and reported missing);
// - other bare tokens are arguments/flags and cannot be validated.
function findMissingTokens(tokens) {
  const missing = [];
  tokens.forEach((token, index) => {
    let target = null;
    let isArgument = false;
    for (const candidate of shellTokenCandidates(token)) {
      if (/[\\/]/.test(candidate)) {
        if (isRegularFile(candidate)) { target = candidate; break; }
      } else if (index === 0) {
        target = findCommandInPath(candidate);
        if (target) break;
      } else {
        isArgument = true;
        break;
      }
    }
    if (isArgument) return;
    if (!target) {
      missing.push(token);
      return;
    }
    if (/\.cmd$/i.test(target)) {
      const forwarded = path.join(path.dirname(target), 'codebuddy-hud.js');
      if (!isRegularFile(forwarded)) missing.push(forwarded);
    }
  });
  return missing;
}

function findMissingStatusLineTargets(command) {
  const missing = findMissingTokens(tokenizeStatusLineCommand(command, true));
  if (missing.length === 0) return missing;

  // A Windows path ending in a backslash ("C:\dir\") is ambiguous with an
  // escaped closing quote to the escape-aware tokenizer. Re-tokenize without
  // escape awareness and accept it only when every path-like target exists.
  const legacyMissing = findMissingTokens(tokenizeStatusLineCommand(command, false));
  return legacyMissing.length === 0 ? [] : missing;
}

function checkCodeBuddyConfig(i18n) {
  const home = getCodeBuddyHome();
  const settingsPath = getSettingsPath();
  const homeExists = fs.existsSync(home);
  const settingsExists = fs.existsSync(settingsPath);

  let statusLineOk = false;
  let statusLineCmd = null;
  let statusLineMsg = null;
  let parsedSettings = null;

  if (settingsExists) {
    try {
      parsedSettings = parseSettingsJson(fs.readFileSync(settingsPath, 'utf8'));
      if (parsedSettings && parsedSettings.statusLine) {
        statusLineCmd = parsedSettings.statusLine.command;
        if (typeof statusLineCmd === 'string' && statusLineCmd.trim()) {
          const missing = findMissingStatusLineTargets(statusLineCmd);
          if (missing.length === 0) {
            statusLineOk = true;
          } else {
            statusLineOk = false;
            statusLineMsg = i18n.t('doctorStatusLineInvalid', 'Target executable in statusLine command does not exist');
          }
        } else {
          statusLineMsg = i18n.t('doctorStatusLineMissing');
        }
      } else {
        statusLineMsg = i18n.t('doctorStatusLineMissing');
      }
    } catch {
      statusLineMsg = 'Invalid settings.json (JSON parse error)';
    }
  } else {
    statusLineMsg = i18n.t('doctorSettingsMissing');
  }

  return [
    {
      category: 'codebuddy',
      name: i18n.t('codeBuddyHome'),
      status: homeExists ? 'ok' : 'warn',
      detail: home,
      message: homeExists ? null : 'Directory does not exist yet',
    },
    {
      category: 'codebuddy',
      name: i18n.t('settingsConfig'),
      status: settingsExists ? 'ok' : 'warn',
      detail: settingsPath,
      message: settingsExists ? null : i18n.t('doctorSettingsMissing'),
    },
    {
      category: 'codebuddy',
      name: i18n.t('statusLineCommand'),
      // settings.json exists but the HUD cannot run (missing/invalid command
      // or a target that does not exist) is critical, not a warning: the old
      // warn only let `ok: true` claim the HUD was fine while nothing rendered.
      status: statusLineOk ? 'ok' : (settingsExists ? 'fail' : 'warn'),
      detail: statusLineCmd || '(not configured)',
      message: statusLineMsg,
    },
  ];
}

// The renderer silently ignores a broken or oversized HUD config and falls
// back to defaults, so doctor must surface it instead of reporting all-green.
function checkHudConfig(i18n, cwd) {
  const files = [getUserConfigPath()];
  if (typeof cwd === 'string' && cwd) {
    files.push(path.join(cwd, 'codebuddy-hud.config.json'));
  }
  const problems = [];
  const seen = new Set();
  let checkedAny = false;

  for (const file of files) {
    let key;
    try { key = path.resolve(file); } catch { key = file; }
    if (seen.has(key)) continue;
    seen.add(key);

    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // missing config is fine (defaults apply)
    }
    checkedAny = true;
    if (Buffer.byteLength(raw, 'utf8') > 256 * 1024) {
      problems.push(`${file}: exceeds 256KB, ignored`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      problems.push(`${file}: invalid JSON (${err && err.message ? err.message : err})`);
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push(`${file}: root must be a JSON object`);
      continue;
    }
    const theme = parsed.theme;
    const themeValid = theme === undefined || isPresetName(theme)
      || (theme && typeof theme === 'object' && !Array.isArray(theme)
          && (theme.name === undefined || isPresetName(theme.name)));
    if (!themeValid) {
      problems.push(`${file}: unknown theme name`);
    }
    const maxLines = parsed.display && parsed.display.maxLines;
    if (maxLines !== undefined
        && !(typeof maxLines === 'number' && Number.isFinite(maxLines) && maxLines >= 1)) {
      problems.push(`${file}: display.maxLines must be a positive number`);
    }
  }

  return [{
    category: 'codebuddy',
    name: i18n.t('hudConfigFile'),
    status: problems.length > 0 ? 'warn' : 'ok',
    detail: problems.length > 0
      ? problems.join('; ')
      : (checkedAny ? 'User/project config is valid' : 'No HUD config file (defaults apply)'),
    message: problems.length > 0 ? i18n.t('doctorHudConfigInvalid') : null,
  }];
}

function checkEncodingEnvironment(i18n, config) {
  const isWin = process.platform === 'win32';
  const codepage = isWin ? getConsoleCodePage() : null;
  const unicode = supportsUnicode();
  const themeMode = detectThemeMode(config);

  const checks = [];
  if (isWin) {
    const isUtf8 = codepage === '65001';
    checks.push({
      category: 'terminal',
      name: i18n.t('windowsCodePage'),
      status: isUtf8 ? 'ok' : 'warn',
      detail: codepage ? `chcp ${codepage}` : 'unknown',
      message: isUtf8 ? null : i18n.t('doctorCodepageWarn'),
    });
  }

  checks.push({
    category: 'terminal',
    name: i18n.t('unicodeSupport'),
    status: 'ok',
    detail: `Unicode: ${unicode ? 'supported' : 'fallback (ASCII)'} | ThemeMode: ${themeMode}`,
    message: null,
  });

  return checks;
}

function checkGitEnvironment(i18n, cwd) {
  let gitVersion = null;
  try {
    const out = execSync('git --version', {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    gitVersion = out.trim();
  } catch {
    gitVersion = null;
  }

  if (!gitVersion) {
    return [{
      category: 'git',
      name: i18n.t('gitEnvironment'),
      status: 'warn',
      detail: 'git command not found in PATH',
      message: 'Git integration disabled',
    }];
  }

  const start = Date.now();
  const gitStatus = getGitStatus(cwd || process.cwd(), 300);
  const latency = Date.now() - start;

  return [{
    category: 'git',
    name: i18n.t('gitEnvironment'),
    status: latency > 200 ? 'warn' : 'ok',
    detail: `${gitVersion} | ${gitStatus ? `Branch: ${gitStatus.branch}${gitStatus.dirty ? '*' : ''}` : 'Not a git repo'} (${latency}ms)`,
    message: latency > 200 ? i18n.t('doctorGitBranchSlow') : null,
  }];
}

function checkTranscriptAccess(i18n) {
  const usageDir = getTranscriptUsageStateDir();
  const errLog = getErrorLogPath();
  let usageOk = true;
  try {
    if (!fs.existsSync(usageDir)) {
      fs.mkdirSync(usageDir, { recursive: true });
    }
    // An existing but read-only directory must not pass: the renderer needs
    // to write checkpoints here, and mkdir-on-exists proves nothing.
    fs.accessSync(usageDir, fs.constants.W_OK);
  } catch {
    usageOk = false;
  }

  return [{
    category: 'transcript',
    name: i18n.t('transcriptAccess'),
    status: usageOk ? 'ok' : 'warn',
    detail: `Telemetry Dir: ${usageDir} | Error Log: ${errLog}`,
    message: usageOk ? null : 'Cannot write to state directory',
  }];
}

function checkPathNormalization(i18n, cwd) {
  if (process.platform !== 'win32') return [];
  const rawCwd = cwd || process.cwd();
  const normalized = normalizePlatformPath(rawCwd);
  return [{
    category: 'terminal',
    name: i18n.t('windowsPathNormalization'),
    status: 'ok',
    detail: `Raw: ${rawCwd} | Normalized: ${normalized}`,
    message: null,
  }];
}

// Uninstall retires the active `.bak.codebuddy-hud` snapshot but keeps a
// `.retained-<time>-<pid>` copy of the original text when it differs from the
// restored settings. Those copies accumulate by design (never auto-deleted),
// so doctor surfaces them for a manual review-and-delete decision.
function checkRetainedBackups(i18n) {
  const settingsPath = getSettingsPath();
  const dir = path.dirname(settingsPath);
  const prefix = `${path.basename(settingsPath)}.bak.codebuddy-hud.retained-`;
  let retained = [];
  try {
    retained = fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.startsWith(prefix))
      .map(entry => entry.name);
  } catch {
    retained = [];
  }
  retained.sort();
  if (retained.length === 0) {
    return [{
      category: 'codebuddy',
      name: i18n.t('retainedBackups'),
      status: 'ok',
      detail: `No retained copies in ${dir}`,
      message: null,
    }];
  }
  const shown = retained.slice(0, 5).map(name => sanitizeTerminalText(name, 120));
  const extra = retained.length - shown.length;
  return [{
    category: 'codebuddy',
    name: i18n.t('retainedBackups'),
    status: 'warn',
    detail: extra > 0 ? `${shown.join(', ')} (and ${extra} more in ${dir})` : `${shown.join(', ')} (in ${dir})`,
    message: i18n.t('doctorRetainedBackups'),
  }];
}

function checkHostRefreshProtocol(i18n) {
  return [{
    category: 'codebuddy',
    name: i18n.t('hostRefreshProtocol'),
    status: 'ok',
    detail: 'Event-driven One-shot CLI (~300ms post-turn debounced; idle during long workflow, no daemon)',
    message: null,
  }];
}

function runDoctor(options) {
  const opts = options || {};
  const cwd = opts.cwd || process.cwd();
  const config = loadConfig(cwd);
  const i18n = getI18n(config);

  const checks = [
    checkNodeEnvironment(i18n),
    ...checkCodeBuddyConfig(i18n),
    ...checkHudConfig(i18n, cwd),
    ...checkRetainedBackups(i18n),
    ...checkHostRefreshProtocol(i18n),
    ...checkEncodingEnvironment(i18n, config),
    ...checkPathNormalization(i18n, cwd),
    ...checkGitEnvironment(i18n, cwd),
    ...checkTranscriptAccess(i18n),
  ];

  const hasFail = checks.some(c => c.status === 'fail');
  const hasWarn = checks.some(c => c.status === 'warn');
  const summaryStatus = hasFail ? 'fail' : (hasWarn ? 'warn' : 'ok');

  return {
    timestamp: new Date().toISOString(),
    status: summaryStatus,
    ok: !hasFail,
    checks,
  };
}

function printDoctorReport(report, isJson, options) {
  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const opts = options || {};
  const config = loadConfig(opts.cwd || process.cwd());
  const i18n = getI18n(config);

  const unicode = supportsUnicode();
  const checkMark = unicode ? '\x1b[32m✔\x1b[0m' : '\x1b[32m[✓]\x1b[0m';
  const warnMark = unicode ? '\x1b[33m!\x1b[0m' : '\x1b[33m[!]\x1b[0m';
  const failMark = unicode ? '\x1b[31m✖\x1b[0m' : '\x1b[31m[✗]\x1b[0m';

  console.log(`\n\x1b[1m\x1b[36m=== ${i18n.t('doctorTitle', 'CodeBuddy HUD Doctor')} ===\x1b[0m\n`);

  for (const item of report.checks) {
    let mark = checkMark;
    if (item.status === 'warn') mark = warnMark;
    if (item.status === 'fail') mark = failMark;

    // detail may embed external strings (e.g. a git branch read from
    // .git/HEAD); strip control sequences before printing to the terminal.
    console.log(`  ${mark} \x1b[1m${item.name}\x1b[0m: ${sanitizeTerminalText(item.detail, 512)}`);
    if (item.path) {
      console.log(`     \x1b[90mPath: ${sanitizeTerminalText(item.path, 120)}\x1b[0m`);
    }
    if (item.message) {
      const color = item.status === 'fail' ? '\x1b[31m' : '\x1b[33m';
      console.log(`     ${color}→ ${item.message}\x1b[0m`);
    }
  }

  console.log('');
  if (report.status === 'ok') {
    console.log(`\x1b[32m✔ ${i18n.t('doctorSummaryPass', 'All environment checks passed! HUD is ready.')}\x1b[0m\n`);
  } else if (report.status === 'warn') {
    console.log(`\x1b[33m! ${i18n.t('doctorSummaryWarn', 'Some warnings detected. HUD should still work, but check recommendations above.')}\x1b[0m\n`);
  } else {
    console.log(`\x1b[31m✖ ${i18n.t('doctorSummaryFail', 'Critical issues detected. Please fix the items marked above.')}\x1b[0m\n`);
  }
}

module.exports = { runDoctor, printDoctorReport };
