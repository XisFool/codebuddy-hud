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

  it('renders cyberpunk preview with 249k and 1M having matching primary colors', () => {
    const preview = renderThemePreview('cyberpunk');
    const line2 = preview[1];
    // In cyberpunk dark mode, primary is brightMagenta (\x1b[38;5;219m), accent is cyan (\x1b[36m).
    // Both 249k and 1M must use primary brightMagenta.
    assert.ok(line2.includes('\x1b[38;5;219m249k\x1b[0m'), 'cyberpunk preview 249k must be brightMagenta');
    assert.ok(line2.includes('\x1b[38;5;219m1M\x1b[0m'), 'cyberpunk preview 1M must be brightMagenta');
    assert.ok(!line2.includes('\x1b[36m249k\x1b[0m'), 'cyberpunk preview 249k must not be cyan');
  });

  it('renders monochrome dark preview with brightWhite model and white tokens', () => {
    const preview = renderThemePreview('monochrome');
    const [line1, line2] = preview;
    // In monochrome dark mode, model is brightWhite (\x1b[97m), gitBranch is white (\x1b[37m)
    // primary is white (\x1b[37m), accent is gray (\x1b[90m)
    assert.ok(line1.includes('\x1b[97mDeepseek-V4.1-Flash\x1b[0m'), 'model must use brightWhite');
    assert.ok(line1.includes('\x1b[37mmain\x1b[0m'), 'branch must use white');
    assert.ok(line1.includes('\x1b[90mcodebuddy-cli-hud\x1b[0m'), 'project name must use gray accent');
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
