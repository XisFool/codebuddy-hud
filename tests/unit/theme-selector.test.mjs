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
});
