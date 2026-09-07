'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getCodeBuddyHome, getSettingsPath, getErrorLogPath, getTranscriptUsageStateDir, normalizePlatformPath } = require('./paths');
const { supportsUnicode } = require('./encoding');
const { detectThemeMode, loadConfig } = require('./config');
const { getGitStatus } = require('./git');
const { getI18n } = require('./renderer/lang');
const { sanitizeTerminalText } = require('./sanitize');

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
      parsedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (parsedSettings && parsedSettings.statusLine) {
        statusLineCmd = parsedSettings.statusLine.command;
        if (typeof statusLineCmd === 'string' && statusLineCmd.trim()) {
          const match = statusLineCmd.match(/^\s*"([^"]+)"/) || statusLineCmd.match(/^\s*(\S+)/);
          const exePath = match ? match[1] : null;
          if (exePath && fs.existsSync(exePath)) {
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
      status: statusLineOk ? 'ok' : 'warn',
      detail: statusLineCmd || '(not configured)',
      message: statusLineMsg,
    },
  ];
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

    console.log(`  ${mark} \x1b[1m${item.name}\x1b[0m: ${item.detail}`);
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
