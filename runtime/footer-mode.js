'use strict';

const fs = require('fs');
const readline = require('readline');
const { getSettingsPath } = require('./paths');
const { getI18n } = require('./lang');
const {
  atomicWriteSettingsFile,
  isSettingsObject,
  parseSettingsJson,
  getSettingsProperty,
  editSettingsProperty,
} = require('./settings-file');
const { resolveTheme, isPresetName } = require('./config');
const { renderThemePreview } = require('./theme-selector');
const { color, bold, dim, RESET, BOLD, DIM } = require('./renderer/format');

const ANSI_CYAN = '\x1b[36m';

const CLEAN_FOOTER_SEGMENTS = Object.freeze([
  'agents',
  'shortcuts',
  'permission',
  'thinking',
  'shells',
  'context-remaining',
  'tokens',
]);

const FOOTER_MODES = {
  full: {
    name: 'full',
    segments: null,
  },
  clean: {
    name: 'clean',
    segments: CLEAN_FOOTER_SEGMENTS,
  },
  off: {
    name: 'off',
    segments: Object.freeze([]),
  },
};

const MODE_ORDER = ['full', 'clean', 'off'];

function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) {
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  }
  return width;
}

function isFooterModeName(name) {
  return typeof name === 'string' && Object.hasOwn(FOOTER_MODES, name);
}

function detectFooterMode(settings) {
  if (!isSettingsObject(settings) || !Object.hasOwn(settings, 'tui') || settings.tui === undefined) {
    return 'full';
  }
  if (!isSettingsObject(settings.tui)) {
    return 'custom';
  }
  if (!Object.hasOwn(settings.tui, 'statusLine') || settings.tui.statusLine === undefined) {
    return 'full';
  }
  const value = settings.tui.statusLine;
  if (!Array.isArray(value)) {
    return 'custom';
  }
  if (value.length === 0) {
    return 'off';
  }
  if (
    value.length === CLEAN_FOOTER_SEGMENTS.length
    && value.every((item, idx) => item === CLEAN_FOOTER_SEGMENTS[idx])
  ) {
    return 'clean';
  }
  return 'custom';
}

// Probe where editSettingsProperty places a new top-level `tui` property so
// the inserted object mirrors the file's existing EOL and indentation style.
function buildInsertedTuiObject(rawSettings, segments) {
  const eol = rawSettings.includes('\r\n') ? '\r\n' : '\n';
  const segmentsJson = JSON.stringify(segments);
  const probe = editSettingsProperty(rawSettings, 'tui', '{}');
  const insertedIdx = probe.lastIndexOf('"tui": {}');
  if (insertedIdx !== -1) {
    const lineStart = probe.lastIndexOf('\n', insertedIdx - 1) + 1;
    const prefix = probe.slice(lineStart, insertedIdx);
    if (/^[\t ]*$/.test(prefix)) {
      const outerIndent = prefix;
      let indentUnit = outerIndent.includes('\t')
        ? '\t'
        : (outerIndent.length > 0 ? outerIndent : '  ');
      const afterLine = probe.indexOf('\n', insertedIdx);
      if (afterLine !== -1) {
        const nextLineStart = afterLine + 1;
        const closeMatch = probe.slice(nextLineStart).match(/^([\t ]*)\}/);
        if (closeMatch) {
          const closingIndent = closeMatch[1];
          if (outerIndent.startsWith(closingIndent) && outerIndent.length > closingIndent.length) {
            indentUnit = outerIndent.slice(closingIndent.length);
          }
        }
      }
      return `{${eol}${outerIndent}${indentUnit}"statusLine": ${segmentsJson}${eol}${outerIndent}}`;
    }
  }
  return `{"statusLine": ${segmentsJson}}`;
}

function editTuiStatusLineProperty(rawSettings, segments) {
  if (segments !== null && (!Array.isArray(segments) || !segments.every(s => typeof s === 'string'))) {
    throw new TypeError('Footer segments must be null or an array of strings');
  }
  if (typeof rawSettings !== 'string') {
    throw new TypeError('Settings content must be a string');
  }

  const parsed = parseSettingsJson(rawSettings);
  if (!isSettingsObject(parsed)) {
    throw new Error('settings.json root must be a JSON object');
  }

  const hasTui = Object.hasOwn(parsed, 'tui');
  if (hasTui && !isSettingsObject(parsed.tui)) {
    throw new Error('settings.json "tui" property must be a JSON object');
  }

  if (segments === null) {
    if (!hasTui) {
      return rawSettings;
    }
    const tuiRaw = getSettingsProperty(rawSettings, 'tui');
    const updatedTuiRaw = editSettingsProperty(tuiRaw, 'statusLine', undefined);
    if (updatedTuiRaw === tuiRaw) {
      return rawSettings;
    }
    const updatedTuiObj = parseSettingsJson(updatedTuiRaw);
    if (Object.keys(updatedTuiObj).length === 0) {
      return editSettingsProperty(rawSettings, 'tui', undefined);
    }
    return editSettingsProperty(rawSettings, 'tui', updatedTuiRaw);
  }

  const segmentsJson = JSON.stringify(segments);
  if (hasTui) {
    const tuiRaw = getSettingsProperty(rawSettings, 'tui');
    const updatedTuiRaw = editSettingsProperty(tuiRaw, 'statusLine', segmentsJson);
    if (updatedTuiRaw === tuiRaw) {
      return rawSettings;
    }
    return editSettingsProperty(rawSettings, 'tui', updatedTuiRaw);
  }

  const tuiRaw = buildInsertedTuiObject(rawSettings, segments);
  return editSettingsProperty(rawSettings, 'tui', tuiRaw);
}

function saveFooterMode(mode, options) {
  if (!isFooterModeName(mode)) {
    throw new Error(`Invalid footer mode: "${mode}"`);
  }
  const opts = options || {};
  const settingsPath = opts.settingsPath || getSettingsPath();
  const segments = FOOTER_MODES[mode].segments;

  let rawSettings = null;
  let exists = true;
  try {
    rawSettings = fs.readFileSync(settingsPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      exists = false;
    } else {
      throw err;
    }
  }

  if (!exists) {
    if (segments === null) {
      return settingsPath;
    }
    const created = editTuiStatusLineProperty('', segments);
    atomicWriteSettingsFile(settingsPath, created);
    return settingsPath;
  }

  const updated = editTuiStatusLineProperty(rawSettings, segments);
  if (updated !== rawSettings) {
    atomicWriteSettingsFile(settingsPath, updated);
  }
  return settingsPath;
}

function getActiveFooterMode(options) {
  const opts = options || {};
  const settingsPath = opts.settingsPath || getSettingsPath();
  try {
    if (fs.existsSync(settingsPath)) {
      const parsed = parseSettingsJson(fs.readFileSync(settingsPath, 'utf8'));
      return detectFooterMode(parsed);
    }
  } catch {
    // ignore
  }
  return 'full';
}

function restoreTuiStatusLineOnUninstall(rawSettings, settings, backupRaw, backup) {
  const currentMode = detectFooterMode(settings);
  if (currentMode !== 'clean' && currentMode !== 'off') {
    return rawSettings;
  }

  if (isSettingsObject(backup)) {
    const backupMode = detectFooterMode(backup);
    if (currentMode === backupMode) {
      return rawSettings;
    }

    const currentTuiRaw = getSettingsProperty(rawSettings, 'tui');
    if (currentTuiRaw === undefined) {
      return rawSettings;
    }

    if (isSettingsObject(backup.tui) && Object.hasOwn(backup.tui, 'statusLine')) {
      let backupStatusLineRaw;
      if (typeof backupRaw === 'string') {
        const backupTuiRaw = getSettingsProperty(backupRaw, 'tui');
        if (backupTuiRaw !== undefined) {
          backupStatusLineRaw = getSettingsProperty(backupTuiRaw, 'statusLine');
        }
      }
      if (backupStatusLineRaw === undefined) {
        backupStatusLineRaw = JSON.stringify(backup.tui.statusLine);
      }
      const updatedTuiRaw = editSettingsProperty(currentTuiRaw, 'statusLine', backupStatusLineRaw);
      if (updatedTuiRaw === currentTuiRaw) {
        return rawSettings;
      }
      return editSettingsProperty(rawSettings, 'tui', updatedTuiRaw);
    }

    const updatedTuiRaw = editSettingsProperty(currentTuiRaw, 'statusLine', undefined);
    const updatedTuiObj = parseSettingsJson(updatedTuiRaw);
    if (Object.keys(updatedTuiObj).length === 0 && !Object.hasOwn(backup, 'tui')) {
      return editSettingsProperty(rawSettings, 'tui', undefined);
    }
    return editSettingsProperty(rawSettings, 'tui', updatedTuiRaw);
  }

  return editTuiStatusLineProperty(rawSettings, null);
}

function getModeLabel(mode, t) {
  if (mode === 'full') return t('footerModeFullLabel');
  if (mode === 'clean') return t('footerModeCleanLabel');
  return t('footerModeOffLabel');
}

function renderFooterPreview(mode, config) {
  const safeMode = isFooterModeName(mode) ? mode : 'full';
  const resolvedTheme = (config && config.theme && typeof config.theme === 'object' && config.theme.primary)
    ? config.theme
    : resolveTheme(config || {});
  const themeName = isPresetName(resolvedTheme.name) ? resolvedTheme.name : 'ocean';
  const themeMode = resolvedTheme.mode || 'dark';
  const hudLines = renderThemePreview(themeName, themeMode);
  const { t } = getI18n(config);

  let line4;
  if (safeMode === 'full') {
    line4 = dim('Deepseek-V4.1-Flash · reasoning · ← for agents · ? for shortcuts · (⇧tab to cycle)');
  } else if (safeMode === 'clean') {
    line4 = dim('← for agents · ? for shortcuts · (⇧tab to cycle)');
  } else {
    line4 = dim(`[${t('footerPreviewOffLine')}]`);
  }

  return [...hudLines, line4];
}

function printFooterModesList(config, options) {
  const { t } = getI18n(config);
  const current = getActiveFooterMode(options);
  console.log(`\n${BOLD}${t('availableFooterModes')}:${RESET}\n`);
  for (const mode of MODE_ORDER) {
    const isCurrent = mode === current;
    const marker = isCurrent ? `${color('● [active]', 'green')}` : `${dim('○')}`;
    const label = getModeLabel(mode, t);
    console.log(`  ${marker} ${bold(mode.padEnd(8))} - ${label}`);
  }
  if (current === 'custom') {
    console.log(`\n  ${color('!', 'yellow')} ${t('footerCustomNote')}`);
  }
  console.log(`\n${t('usageFooterMode')}\n`);
}

function selectFooterInteractive(opts) {
  const options = opts || {};
  const { t } = getI18n(options.config);
  const isTTY = process.stdin.isTTY && process.stdout.isTTY;
  const activeMode = getActiveFooterMode(options);
  const initialMode = isFooterModeName(options.initialMode)
    ? options.initialMode
    : (isFooterModeName(activeMode) ? activeMode : 'full');

  if (!isTTY) {
    return Promise.resolve(initialMode);
  }

  let selectedIndex = MODE_ORDER.indexOf(initialMode);
  if (selectedIndex === -1) selectedIndex = 0;

  return new Promise((resolve) => {
    let lastRenderedLines = 0;
    let rl = null;

    function restoreCursor() {
      try { process.stdout.write('\x1b[?25h'); } catch {}
    }

    const signals = process.platform === 'win32'
      ? ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']
      : ['SIGINT', 'SIGTERM', 'SIGHUP'];

    let cleanedUp = false;
    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      process.removeListener('exit', onExit);
      for (const sig of signals) {
        process.removeListener(sig, onSignal);
      }
      restoreCursor();
      if (process.stdin.isTTY) {
        try { process.stdin.setRawMode(false); } catch {}
      }
      process.stdin.removeListener('keypress', onKeypress);
      if (rl) {
        try { rl.close(); } catch {}
      }
      try { process.stdin.pause(); } catch {}
    }

    function onSignal(sig) {
      cleanup();
      process.exit(sig === 'SIGINT' ? 130 : 143);
    }

    function onExit() {
      cleanup();
    }

    for (const sig of signals) {
      process.once(sig, onSignal);
    }
    process.once('exit', onExit);

    function render() {
      const outputLines = [];

      if (lastRenderedLines > 0) {
        process.stdout.write(`\x1b[${lastRenderedLines}A\x1b[0J`);
      }

      outputLines.push(`${BOLD}${ANSI_CYAN}? ${RESET}${BOLD}${t('footerSelectTitle')}${RESET} ${DIM}${t('footerSelectHint')}${RESET}`);
      outputLines.push('');

      for (let i = 0; i < MODE_ORDER.length; i++) {
        const mode = MODE_ORDER[i];
        const isHovered = i === selectedIndex;
        const pointer = isHovered ? `${ANSI_CYAN}>${RESET}` : ' ';
        const radio = isHovered ? `${ANSI_CYAN}●${RESET}` : `${DIM}○${RESET}`;
        const num = `${DIM}[${i + 1}]${RESET}`;
        const nameStr = isHovered ? `${BOLD}${ANSI_CYAN}${mode.padEnd(8)}${RESET}` : `${mode.padEnd(8)}`;
        const label = getModeLabel(mode, t);
        const labelStr = isHovered ? `${label}` : `${DIM}${label}${RESET}`;
        outputLines.push(`  ${pointer} ${radio} ${num} ${nameStr}  ${labelStr}`);
      }

      outputLines.push('');
      const currentMode = MODE_ORDER[selectedIndex];
      const previewTitle = t('footerPreviewTitle');
      // Bottom border is 92 columns: └ + 90 dashes + ┘.
      const topDashes = Math.max(0, 84 - displayWidth(previewTitle) - currentMode.length);
      outputLines.push(`${DIM}┌─ ${previewTitle} (${currentMode}) ${'─'.repeat(topDashes)}┐${RESET}`);

      const previewLines = renderFooterPreview(currentMode, options.config);
      for (const pl of previewLines) {
        outputLines.push(`  ${pl}`);
      }
      outputLines.push(`${DIM}└${'─'.repeat(90)}┘${RESET}`);

      lastRenderedLines = outputLines.length;
      process.stdout.write(outputLines.join('\n') + '\n');
    }

    function onKeypress(str, key) {
      try {
        if (!key) return;

        if (key.ctrl && key.name === 'c') {
          cleanup();
          process.stdout.write('\n');
          resolve(null);
          return;
        }

        if (key.name === 'escape' || key.name === 'q') {
          cleanup();
          process.stdout.write('\n');
          resolve(null);
          return;
        }

        if (key.name === 'up' || key.name === 'k') {
          selectedIndex = (selectedIndex - 1 + MODE_ORDER.length) % MODE_ORDER.length;
          render();
          return;
        }

        if (key.name === 'down' || key.name === 'j') {
          selectedIndex = (selectedIndex + 1) % MODE_ORDER.length;
          render();
          return;
        }

        if (typeof str === 'string' && /^[1-9]\d*$/.test(str.trim())) {
          const num = parseInt(str.trim(), 10);
          if (num >= 1 && num <= MODE_ORDER.length) {
            selectedIndex = num - 1;
            render();
            return;
          }
        }

        if (key.name === 'return' || key.name === 'enter') {
          cleanup();
          process.stdout.write('\n');
          resolve(MODE_ORDER[selectedIndex]);
        }
      } catch {
        cleanup();
        resolve(null);
      }
    }

    try {
      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      readline.emitKeypressEvents(process.stdin, rl);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdout.write('\x1b[?25l'); // Hide cursor
      process.stdin.on('keypress', onKeypress);
      render();
    } catch {
      cleanup();
      resolve(null);
    }
  });
}

module.exports = {
  FOOTER_MODES,
  CLEAN_FOOTER_SEGMENTS,
  isFooterModeName,
  detectFooterMode,
  editTuiStatusLineProperty,
  saveFooterMode,
  getActiveFooterMode,
  restoreTuiStatusLineOnUninstall,
  renderFooterPreview,
  printFooterModesList,
  selectFooterInteractive,
};
