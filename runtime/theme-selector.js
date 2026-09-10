'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { THEME_PRESETS, resolveTheme, isPresetName } = require('./config');
const { getUserConfigPath, getSettingsPath } = require('./paths');
const { sanitizeTerminalText } = require('./sanitize');
const { color, bold, dim, RESET, BOLD, DIM } = require('./renderer/format');

const ANSI_CYAN = '\x1b[36m';

const THEMES = [
  { name: 'ocean', label: '深海青蓝 (Ocean · 默认科技风)' },
  { name: 'emerald', label: '翡翠绿 (Emerald · 清新护眼)' },
  { name: 'cyberpunk', label: '赛博朋克 (Cyberpunk · 炫酷粉紫+荧光青)' },
  { name: 'amber', label: '琥珀金 (Amber · 沉稳金黄)' },
  { name: 'monochrome', label: '黑白极简 (Monochrome · 经典终端灰白)' },
];

function saveUserTheme(themeName) {
  if (!isPresetName(themeName)) {
    throw new Error(`Invalid theme name: "${themeName}"`);
  }
  const configPath = getUserConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let userConfig = {};
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        userConfig = parsed;
      }
    }
  } catch {
    userConfig = {};
  }

  userConfig.theme = themeName;
  const tmpPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(userConfig, null, 2));
    fs.renameSync(tmpPath, configPath);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
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

  const sep = `  ${dim('|')}  `;

  // Line 1: Identity
  const line1 = `${bold(color('DeepSeek V4 Flash', m))} ${color('● max', 'red')}${sep}${color('main*', b)}${sep}${color('codebuddy-cli-hud', a)}${sep}${dim(color('default', 'magenta'))}`;

  // Line 2: Tokens & Context
  const inTokens = color('249k', a);
  const outTokens = color('1.1k', a);
  const tokenBreakdown = `${color('(', 'gray')}${color('in: ', 'gray')}${inTokens}${color(' · ', 'gray')}${color('out: ', 'gray')}${outTokens}${color(')', 'gray')}`;
  const tokenPart = `${bold(color('Token ', p))}${bold(color('250.1k', p))} ${tokenBreakdown}`;
  const ctxLabel = `${inTokens}${color('/', 'gray')}${color('1M', p)}`;
  const bar = `${color('███', 'green')}${dim('░░░░░░░')}`;
  const cachePart = `${color('cache', 'green')} ${bold(color('96.8%', 'green'))}`;
  const line2 = `${tokenPart}${sep}${ctxLabel} ${color('[', 'gray')}${bar}${color(']', 'gray')} ${color('25%', 'green')}${sep}${cachePart}`;

  // Line 3: Diff Stats, Credits & Duration
  const diffPart = `${dim('Δ ')}${color('+1.7k', add)} ${color('-161', rem)}`;
  const creditPart = color('82.04 credits', 'yellow');
  const durationPart = `${dim('⏱ ')}${dim('2h47m')} ${dim('(API: 1h23m)')}`;
  const line3 = `${diffPart}${sep}${creditPart}${sep}${durationPart}`;

  // Line 4: Tools & Agents
  const activeTool = `${color('◐ ', 'cyan')}${color('Edit', p)}${dim(': parser.js')}`;
  const doneRead = `${color('✓', 'green')} ${dim('Read')}${dim(' ×3')}`;
  const doneGrep = `${color('✓', 'green')} ${dim('Grep')}${dim(' ×2')}`;
  const line4 = `${activeTool}${sep}${doneRead}  ${doneGrep}`;

  return [line1, line2, line3, line4];
}

function selectThemeInteractive(opts) {
  const options = opts || {};
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

      outputLines.push(`${BOLD}${ANSI_CYAN}? ${RESET}${BOLD}请选择 HUD 主题 (Select HUD Theme):${RESET} ${DIM}[↑/↓ 移动 | 1-5 选择 | Enter 确认 | Esc 取消]${RESET}`);
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
      outputLines.push(`${DIM}┌─ 实时效果预览 (${currentTheme}) ${'─'.repeat(48)}┐${RESET}`);

      const previewLines = renderThemePreview(currentTheme);
      for (const pl of previewLines) {
        outputLines.push(`  ${pl}`);
      }
      outputLines.push(`${DIM}└${'─'.repeat(74)}┘${RESET}`);

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

function printThemesList() {
  const current = getActiveThemeName();
  console.log(`\n${BOLD}Available HUD Themes:${RESET}\n`);
  for (let i = 0; i < THEMES.length; i++) {
    const item = THEMES[i];
    const isCurrent = item.name === current;
    const marker = isCurrent ? `${color('● [active]', 'green')}` : `${dim('○')}`;
    console.log(`  ${marker} ${bold(item.name.padEnd(12))} - ${item.label}`);
  }
  console.log(`\nUsage: codebuddy-hud --theme <name> (e.g. codebuddy-hud --theme cyberpunk)\n`);
}

module.exports = {
  THEMES,
  saveUserTheme,
  getActiveThemeName,
  renderThemePreview,
  selectThemeInteractive,
  printThemesList,
};
