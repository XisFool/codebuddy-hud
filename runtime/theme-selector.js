'use strict';

const fs = require('fs');
const readline = require('readline');
const { THEME_PRESETS, resolveTheme, isPresetName } = require('./config');
const { getUserConfigPath, getSettingsPath } = require('./paths');
const { sanitizeTerminalText } = require('./sanitize');
const { getI18n } = require('./lang');
const { atomicWriteSettingsFile, isSettingsObject } = require('./settings-file');
const { color, bold, dim, RESET, BOLD, DIM } = require('./renderer/format');

const ANSI_CYAN = '\x1b[36m';

const THEMES = [
  { name: 'ocean', label: '深海青蓝 (Ocean · 默认科技风)' },
  { name: 'emerald', label: '翡翠绿 (Emerald · 清新护眼)' },
  { name: 'cyberpunk', label: '赛博朋克 (Cyberpunk · 炫酷粉紫)' },
  { name: 'amber', label: '琥珀金 (Amber · 沉稳金黄)' },
  { name: 'monochrome', label: '黑白极简 (Monochrome · 经典终端灰白)' },
];

// CJK/fullwidth characters occupy two terminal columns. The preview box must
// measure the display width of the localized title, not its code-point count,
// or the English title overflows the right border by its extra columns.
function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) {
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  }
  return width;
}

function saveUserTheme(themeName) {
  if (!isPresetName(themeName)) {
    throw new Error(`Invalid theme name: "${themeName}"`);
  }
  const configPath = getUserConfigPath();
  let userConfig = {};
  try {
    userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
  if (!isSettingsObject(userConfig)) {
    throw new Error('HUD config root must be a JSON object');
  }
  userConfig.theme = themeName;
  atomicWriteSettingsFile(configPath, JSON.stringify(userConfig, null, 2));
  return configPath;
}

function getActiveThemeName() {
  try {
    const configPath = getUserConfigPath();
    if (fs.existsSync(configPath)) {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (userConfig && typeof userConfig === 'object' && !Array.isArray(userConfig)
          && isPresetName(userConfig.theme)) {
        return userConfig.theme;
      }
    }
  } catch {
    // ignore
  }
  return 'ocean';
}

function renderThemePreview(themeName, mode = 'dark') {
  const preset = THEME_PRESETS[themeName] || THEME_PRESETS.ocean;
  const palette = preset[mode] || preset.dark;

  const p = palette.primary;
  const a = palette.accent || p;
  const m = palette.model || p;
  const b = palette.gitBranch || p;
  const add = palette.diffAdd || 'green';
  const rem = palette.diffRemove || 'red';

  const sep = '  \x1b[90m│\x1b[0m  ';

  // Line 1: Identity & Environment
  const modelPart = `${bold(color('Deepseek-V4.1-Flash', m))} ${color('● max', 'red')}`;
  const branchPart = `${color('main', b)}${color('*', 'yellow')}`;
  const projectPart = color('codebuddy-hud', a);
  const permPart = color('default', 'brightPurple');
  const line1 = `${modelPart}${sep}${branchPart}${sep}${projectPart}${sep}${permPart}`;

  // Line 2: Context Window & Tokens
  const inTokens = color('249k', p);
  const sizeText = color('1M', p);
  const ctxLabel = `${bold(color('Context Token ', p))}${inTokens}${color('/', 'gray')}${sizeText}`;
  const bar = `${color('███', 'green')}${dim('░░░░░░░')}`;
  const ctxProgress = `${ctxLabel} ${color('[', 'gray')}${bar}${color(']', 'gray')} ${color('25%', 'green')}`;
  const outPart = `${color('out ', 'gray')}${color('1.1k', a)}`;
  const cachePart = `${color('cache', 'green')} ${color('96.8%', 'green')}`;
  const line2 = `${ctxProgress}${sep}${outPart}${sep}${cachePart}`;

  // Line 3: Diff Stats, Credits, Duration & Tool Activity
  const diffPart = `${dim('Δ ')}${color('+1.7k', add)} ${color('-161', rem)}`;
  const creditPart = color('82.04 credits', 'yellow');
  const durationPart = `${dim('⏱ ')}${color('2h47m', 'gray')}`;
  const activeTool = `${color('◐ ', 'cyan')}${color('Edit', 'cyan')}${dim(': parser.js')}`;
  const doneRead = `${color('✓', 'green')} ${dim('Read')}${dim(' ×3')}`;
  const doneGrep = `${color('✓', 'green')} ${dim('Grep')}${dim(' ×2')}`;
  const toolPart = `${activeTool}  ${doneRead}  ${doneGrep}`;
  const line3 = `${diffPart}${sep}${creditPart}${sep}${durationPart}${sep}${toolPart}`;

  return [line1, line2, line3];
}

function selectThemeInteractive(opts) {
  const options = opts || {};
  const { t } = getI18n(options.config);
  const isTTY = process.stdin.isTTY && process.stdout.isTTY;
  const initialTheme = options.initialTheme || getActiveThemeName();

  if (!isTTY) {
    return Promise.resolve(initialTheme);
  }

  let selectedIndex = THEMES.findIndex(t => t.name === initialTheme);
  if (selectedIndex === -1) selectedIndex = 0;

  return new Promise((resolve) => {
    let lastRenderedLines = 0;
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    readline.emitKeypressEvents(process.stdin, rl);

    function restoreCursor() {
      try { process.stdout.write('\x1b[?25h'); } catch {}
    }

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdout.write('\x1b[?25l'); // Hide cursor

    let cleanedUp = false;
    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      process.removeListener('exit', onExit);
      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.removeListener(sig, onSignal);
      }
      restoreCursor();
      if (process.stdin.isTTY) {
        try { process.stdin.setRawMode(false); } catch {}
      }
      process.stdin.removeListener('keypress', onKeypress);
      try { rl.close(); } catch {}
      try { process.stdin.pause(); } catch {}
    }

    function onSignal(sig) {
      cleanup();
      process.exit(sig === 'SIGINT' ? 130 : 143);
    }

    function onExit() {
      cleanup();
    }

    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.once(sig, onSignal);
    }
    process.once('exit', onExit);

    function render() {
      const outputLines = [];

      // Clear previous output
      if (lastRenderedLines > 0) {
        process.stdout.write(`\x1b[${lastRenderedLines}A\x1b[0J`);
      }

      outputLines.push(`${BOLD}${ANSI_CYAN}? ${RESET}${BOLD}${t('themeSelectTitle')}${RESET} ${DIM}${t('themeSelectHint')}${RESET}`);
      outputLines.push('');

      for (let i = 0; i < THEMES.length; i++) {
        const item = THEMES[i];
        const isHovered = i === selectedIndex;
        const pointer = isHovered ? `${ANSI_CYAN}>${RESET}` : ' ';
        const radio = isHovered ? `${ANSI_CYAN}●${RESET}` : `${DIM}○${RESET}`;
        const num = `${DIM}[${i + 1}]${RESET}`;
        const nameStr = isHovered ? `${BOLD}${ANSI_CYAN}${item.name.padEnd(12)}${RESET}` : `${item.name.padEnd(12)}`;
        const labelStr = isHovered ? `${item.label}` : `${DIM}${item.label}${RESET}`;
        outputLines.push(`  ${pointer} ${radio} ${num} ${nameStr}  ${labelStr}`);
      }

      outputLines.push('');
      const currentTheme = THEMES[selectedIndex].name;
      const previewTitle = t('themePreviewTitle');
      // Bottom border is 92 columns: └ + 90 dashes + ┘.
      const topDashes = Math.max(0, 84 - displayWidth(previewTitle) - currentTheme.length);
      outputLines.push(`${DIM}┌─ ${previewTitle} (${currentTheme}) ${'─'.repeat(topDashes)}┐${RESET}`);

      const previewLines = renderThemePreview(currentTheme);
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
          selectedIndex = (selectedIndex - 1 + THEMES.length) % THEMES.length;
          render();
          return;
        }

        if (key.name === 'down' || key.name === 'j') {
          selectedIndex = (selectedIndex + 1) % THEMES.length;
          render();
          return;
        }

        if (typeof str === 'string' && /^[1-9]\d*$/.test(str.trim())) {
          const num = parseInt(str.trim(), 10);
          if (num >= 1 && num <= THEMES.length) {
            selectedIndex = num - 1;
            render();
            return;
          }
        }

        if (key.name === 'return' || key.name === 'enter') {
          cleanup();
          process.stdout.write('\n');
          resolve(THEMES[selectedIndex].name);
        }
      } catch {
        cleanup();
        resolve(null);
      }
    }

    process.stdin.on('keypress', onKeypress);
    render();
  });
}

function printThemesList(config) {
  const { t } = getI18n(config);
  const current = getActiveThemeName();
  console.log(`\n${BOLD}${t('availableThemes')}:${RESET}\n`);
  for (let i = 0; i < THEMES.length; i++) {
    const item = THEMES[i];
    const isCurrent = item.name === current;
    const marker = isCurrent ? `${color('● [active]', 'green')}` : `${dim('○')}`;
    console.log(`  ${marker} ${bold(item.name.padEnd(12))} - ${item.label}`);
  }
  console.log(`\n${t('usageTheme')}\n`);
}

module.exports = {
  THEMES,
  saveUserTheme,
  getActiveThemeName,
  renderThemePreview,
  selectThemeInteractive,
  printThemesList,
};
