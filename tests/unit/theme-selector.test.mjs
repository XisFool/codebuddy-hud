import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { THEMES, saveUserTheme, getActiveThemeName, renderThemePreview, printThemesList } = require('../../runtime/theme-selector.js');

let tmpDir;
let originalCodeBuddyHome;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-theme-test-'));
  originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  process.env.CODEBUDDY_HOME = path.join(tmpDir, 'codebuddy-home');
});

after(() => {
  if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const { loadConfig } = require('../../runtime/config.js');

describe('theme-selector', () => {
  it('defines 5 standard themes', () => {
    assert.equal(THEMES.length, 5);
    const names = THEMES.map(t => t.name);
    assert.deepEqual(names, ['ocean', 'emerald', 'cyberpunk', 'amber', 'monochrome']);
  });

  it('renders a 3-line ANSI preview for each theme', () => {
    for (const t of THEMES) {
      const preview = renderThemePreview(t.name);
      assert.equal(preview.length, 3);
      assert.ok(preview[0].includes('Deepseek-V4.1-Flash'));
      assert.ok(preview[1].includes('Context Token'));
      assert.ok(preview[2].includes('credits'));
      assert.ok(preview[2].includes('Edit'));
    }
  });

  it('renders cyberpunk identity and token fields in one theme color in both modes', () => {
    for (const [mode, sgr] of [['dark', '\x1b[38;5;183m'], ['light', '\x1b[35m']]) {
      const [line1, line2] = renderThemePreview('cyberpunk', mode);
      for (const text of ['Deepseek-V4.1-Flash', 'main', 'codebuddy-hud']) {
        assert.ok(line1.includes(`${sgr}${text}\x1b[0m`), `${mode}: ${text} must use the theme color`);
      }
      for (const text of ['249k', '1M', '1.1k']) {
        assert.ok(line2.includes(`${sgr}${text}\x1b[0m`), `${mode}: ${text} must use the theme color`);
      }
    }
  });

  it('renders monochrome dark preview with brightWhite model and white tokens', () => {
    const preview = renderThemePreview('monochrome');
    const [line1, line2] = preview;
    // In monochrome dark mode, model is brightWhite (\x1b[97m), gitBranch is white (\x1b[37m)
    // primary is white (\x1b[37m), accent is gray (\x1b[90m)
    assert.ok(line1.includes('\x1b[97mDeepseek-V4.1-Flash\x1b[0m'), 'model must use brightWhite');
    assert.ok(line1.includes('\x1b[37mmain\x1b[0m'), 'branch must use white');
    assert.ok(line1.includes('\x1b[90mcodebuddy-hud\x1b[0m'), 'project name must use gray accent');
    assert.ok(line2.includes('\x1b[37m249k\x1b[0m'), '249k must use white');
    assert.ok(line2.includes('\x1b[37m1M\x1b[0m'), '1M must use white');
  });

  it('saves user theme to config and reads it back in getActiveThemeName and loadConfig', () => {
    const configPath = saveUserTheme('cyberpunk');
    assert.ok(fs.existsSync(configPath));
    assert.equal(getActiveThemeName(), 'cyberpunk');
    const loadedCyber = loadConfig();
    assert.equal(loadedCyber.theme.name, 'cyberpunk');
    assert.equal(loadedCyber.theme.primary, 'brightMagenta');

    saveUserTheme('emerald');
    assert.equal(getActiveThemeName(), 'emerald');
    const loadedEmerald = loadConfig();
    assert.equal(loadedEmerald.theme.name, 'emerald');
    assert.equal(loadedEmerald.theme.primary, 'brightGreen');
  });

  it('throws on invalid theme name', () => {
    assert.throws(() => {
      saveUserTheme('invalid-theme-xyz');
    }, /Invalid theme name/);
  });

  it('leaves invalid or unreadable user config byte-for-byte unchanged', () => {
    const configPath = path.join(process.env.CODEBUDDY_HOME, 'codebuddy-hud.config.json');
    const readFile = fs.readFileSync;
    try {
      for (const raw of ['{"display":{"showCost":false},}', '// comment\n{}', '[]', 'null', '1', '"theme"', '']) {
        fs.writeFileSync(configPath, raw);
        assert.throws(() => saveUserTheme('amber'));
        assert.equal(fs.readFileSync(configPath, 'utf8'), raw);
      }
      fs.writeFileSync(configPath, '{"display":{"showCost":false}}');
      fs.readFileSync = function (file, ...args) {
        if (file === configPath) throw Object.assign(new Error('unreadable config'), { code: 'EACCES' });
        return readFile.call(this, file, ...args);
      };
      assert.throws(() => saveUserTheme('amber'), /unreadable config/);
      assert.equal(readFile(configPath, 'utf8'), '{"display":{"showCost":false}}');
    } finally {
      fs.readFileSync = readFile;
      fs.rmSync(configPath, { force: true });
    }
  });

  it('reports invalid user config with the file path and strict-JSON hint', () => {
    const configPath = path.join(process.env.CODEBUDDY_HOME, 'codebuddy-hud.config.json');
    try {
      for (const raw of ['{"display":{"showCost":false},}', '']) {
        fs.writeFileSync(configPath, raw);
        assert.throws(() => saveUserTheme('amber'), err => {
          assert.ok(err.message.includes(configPath), 'error must name the config file');
          assert.ok(err.message.includes('strict JSON'), 'error must explain the strict-JSON rule');
          assert.ok(err.message.includes('left unchanged'), 'error must confirm the file was preserved');
          return true;
        });
        assert.equal(fs.readFileSync(configPath, 'utf8'), raw);
      }
      fs.writeFileSync(configPath, '[]');
      assert.throws(() => saveUserTheme('amber'), err => {
        assert.ok(err.message.includes('must be a JSON object'));
        assert.ok(err.message.includes(configPath));
        return true;
      });
    } finally {
      fs.rmSync(configPath, { force: true });
    }
  });

  it('preserves other options and refuses writes through multiple hard links', () => {
    const configPath = path.join(process.env.CODEBUDDY_HOME, 'codebuddy-hud.config.json');
    const linkedPath = path.join(tmpDir, 'theme-hardlink.json');
    try {
      fs.writeFileSync(configPath, '{"display":{"showCost":false},"thresholds":{"warning":0}}');
      saveUserTheme('amber');
      const raw = fs.readFileSync(configPath, 'utf8');
      assert.deepEqual(JSON.parse(raw), { display: { showCost: false }, thresholds: { warning: 0 }, theme: 'amber' });
      fs.linkSync(configPath, linkedPath);
      assert.throws(() => saveUserTheme('ocean'), /multiple hard links/);
      assert.equal(fs.readFileSync(configPath, 'utf8'), raw);
      assert.equal(fs.readFileSync(linkedPath, 'utf8'), raw);
    } finally {
      fs.rmSync(linkedPath, { force: true });
      fs.rmSync(configPath, { force: true });
    }
  });

  it('preserves theme config symlinks and POSIX permissions', { skip: process.platform === 'win32' }, () => {
    const configPath = path.join(process.env.CODEBUDDY_HOME, 'codebuddy-hud.config.json');
    const targetPath = path.join(tmpDir, 'theme-target.json');
    try {
      fs.writeFileSync(targetPath, '{"display":{"showCost":false}}', { mode: 0o640 });
      fs.chmodSync(targetPath, 0o640);
      fs.symlinkSync(targetPath, configPath);
      saveUserTheme('emerald');
      assert.equal(fs.lstatSync(configPath).isSymbolicLink(), true);
      assert.equal(fs.statSync(targetPath).mode & 0o777, 0o640);
      assert.equal(JSON.parse(fs.readFileSync(targetPath, 'utf8')).theme, 'emerald');
    } finally {
      fs.rmSync(configPath, { force: true });
    }
  });

  it('prints theme list without throwing', () => {
    assert.doesNotThrow(() => {
      printThemesList();
    });
  });

  it('localizes the theme list headings via lang.js', () => {
    const lines = [];
    const originalLog = console.log;
    console.log = (line) => lines.push(String(line));
    try {
      printThemesList({ language: 'zh' });
      printThemesList({ language: 'en' });
    } finally {
      console.log = originalLog;
    }
    assert.ok(lines.some(l => l.includes('可用主题')), 'zh header must be localized');
    assert.ok(lines.some(l => l.includes('Available themes')), 'en header must be localized');
    assert.ok(lines.some(l => l.includes('用法: codebuddy-hud --theme')), 'zh usage hint must be localized');
    assert.ok(!lines.some(l => l.includes('Available HUD Themes')), 'hardcoded header must be gone');
  });
});
