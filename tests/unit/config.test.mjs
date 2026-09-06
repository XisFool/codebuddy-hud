import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { loadConfig, deepMerge, THEME_PRESETS, resolveTheme, detectThemeMode } = require('../../runtime/config.js');

let tmpDir;
let originalCodeBuddyHome;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-config-test-'));
  originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  process.env.CODEBUDDY_HOME = path.join(tmpDir, 'codebuddy-home');
});

after(() => {
  if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('deepMerge', () => {
  it('merges nested objects', () => {
    const target = { a: { b: 1, c: 2 }, d: 3 };
    const source = { a: { b: 10 }, e: 5 };
    const result = deepMerge(target, source);
    assert.equal(result.a.b, 10);
    assert.equal(result.a.c, 2);
    assert.equal(result.d, 3);
    assert.equal(result.e, 5);
  });

  it('does not mutate target', () => {
    const target = { a: { b: 1 } };
    const source = { a: { b: 2 } };
    deepMerge(target, source);
    assert.equal(target.a.b, 1);
  });

  it('overwrites arrays instead of merging', () => {
    const target = { a: [1, 2] };
    const source = { a: [3] };
    const result = deepMerge(target, source);
    assert.deepEqual(result.a, [3]);
  });

  it('clones nested objects absent from the source instead of aliasing them', () => {
    const target = { a: { b: { c: 1 } }, keep: { n: 5 } };
    const merged = deepMerge(target, { x: 1 });
    assert.notEqual(merged.a, target.a);
    assert.notEqual(merged.keep, target.keep);
    merged.a.b.c = 99;
    assert.equal(target.a.b.c, 1);
  });

  it('clones nested objects coming from the source', () => {
    const src = { a: { b: 1 } };
    const merged = deepMerge({}, src);
    assert.notEqual(merged.a, src.a);
    merged.a.b = 2;
    assert.equal(src.a.b, 1);
  });

  it('ignores __proto__ keys so a hostile config cannot swap the prototype', () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":1},"normal":2}');
    const merged = deepMerge({}, hostile);
    assert.equal(Object.getPrototypeOf(merged), Object.prototype, 'merged [[Prototype]] must stay default');
    assert.equal(merged.normal, 2);
    assert.equal(merged.polluted, undefined);
    // nested too
    const nested = deepMerge({ theme: {} }, JSON.parse('{"theme":{"__proto__":{"primary":"INJECTED"}}}'));
    assert.equal(Object.getPrototypeOf(nested.theme), Object.prototype);
    assert.equal(nested.theme.primary, undefined);
    // no global pollution
    assert.equal(({}).polluted, undefined);
  });

  it('allows primitive source to overwrite object target and vice versa', () => {
    const fromObj = deepMerge({ theme: { primary: 'cyan' } }, { theme: 'cyberpunk' });
    assert.equal(fromObj.theme, 'cyberpunk');

    const toObj = deepMerge({ theme: 'ocean' }, { theme: { primary: 'green' } });
    assert.deepEqual(toObj.theme, { primary: 'green' });
  });

  it('caps merge depth so a pathologically deep config cannot overflow the stack', () => {
    let deep = { leaf: 1 };
    for (let i = 0; i < 10000; i++) deep = { next: deep };
    let m;
    assert.doesNotThrow(() => { m = deepMerge({}, deep); });
    assert.ok(m, 'deep config must merge without throwing');
  });
});

describe('loadConfig', () => {
  it('returns default config when no overrides exist', () => {
    const config = loadConfig('/nonexistent/path');
    assert.equal(config.theme.primary, 'cyan');
    assert.equal(config.theme.name, 'ocean');
    assert.equal(config.display.showTokenBar, true);
    assert.equal(config.thresholds.warning, 0.7);
    assert.equal(config.language, 'en');
  });

  it('does not leak mutations into DEFAULT_CONFIG', () => {
    const { DEFAULT_CONFIG } = require('../../runtime/config.js');
    const config = loadConfig('/nonexistent/path');
    config.display.maxLines = 9999;
    config.theme.primary = 'red';
    assert.equal(DEFAULT_CONFIG.display.maxLines, 4);
    assert.equal(DEFAULT_CONFIG.theme, 'ocean');
  });

  it('handles non-string cwd gracefully without throwing', () => {
    assert.doesNotThrow(() => loadConfig({ invalid: 'cwd' }));
    assert.doesNotThrow(() => loadConfig(12345));
    assert.doesNotThrow(() => loadConfig(null));
    assert.doesNotThrow(() => loadConfig(undefined));
  });

  it('reads a rewritten project config even when its mtime is preserved', () => {
    const projectDir = path.join(tmpDir, 'project-config-reload');
    const configPath = path.join(projectDir, 'codebuddy-hud.config.json');
    const fixedTime = new Date('2026-01-01T00:00:00.000Z');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ defaultEffortLevel: 'low' }));
    fs.utimesSync(configPath, fixedTime, fixedTime);
    assert.equal(loadConfig(projectDir).defaultEffortLevel, 'low');

    fs.writeFileSync(configPath, JSON.stringify({ defaultEffortLevel: 'max' }));
    fs.utimesSync(configPath, fixedTime, fixedTime);
    assert.equal(loadConfig(projectDir).defaultEffortLevel, 'max');
  });
});

describe('THEME_PRESETS and resolveTheme', () => {
  it('has 5 classic built-in presets with dark and light variants', () => {
    const expected = ['ocean', 'emerald', 'cyberpunk', 'amber', 'monochrome'];
    for (const name of expected) {
      assert.ok(THEME_PRESETS[name], `Preset ${name} must exist`);
      assert.ok(THEME_PRESETS[name].dark, `Preset ${name}.dark must exist`);
      assert.ok(THEME_PRESETS[name].light, `Preset ${name}.light must exist`);
      assert.ok(THEME_PRESETS[name].label, `Preset ${name}.label must exist`);
    }
  });

  it('resolves string theme names to matching palettes', () => {
    const ocean = resolveTheme({ theme: 'ocean', themeMode: 'dark' });
    assert.equal(ocean.primary, 'cyan');
    assert.equal(ocean.name, 'ocean');

    const cyberpunk = resolveTheme({ theme: 'cyberpunk', themeMode: 'dark' });
    assert.equal(cyberpunk.primary, 'magenta');
    assert.equal(cyberpunk.name, 'cyberpunk');

    const emerald = resolveTheme({ theme: 'emerald', themeMode: 'dark' });
    assert.equal(emerald.primary, 'green');
    assert.equal(emerald.name, 'emerald');

    const amber = resolveTheme({ theme: 'amber', themeMode: 'dark' });
    assert.equal(amber.primary, 'yellow');
    assert.equal(amber.name, 'amber');

    const monochrome = resolveTheme({ theme: 'monochrome', themeMode: 'dark' });
    assert.equal(monochrome.primary, 'gray');
    assert.equal(monochrome.name, 'monochrome');
  });

  it('resolves light mode palettes with higher contrast', () => {
    const oceanLight = resolveTheme({ theme: 'ocean', themeMode: 'light' });
    assert.equal(oceanLight.primary, 'blue');
    assert.equal(oceanLight.mode, 'light');
  });

  it('supports custom theme objects and partial overrides', () => {
    const custom = resolveTheme({ theme: { primary: 'magenta', diffAdd: 'cyan' }, themeMode: 'dark' });
    assert.equal(custom.primary, 'magenta');
    assert.equal(custom.diffAdd, 'cyan');
    assert.equal(custom.diffRemove, 'red'); // inherited from preset
  });

  it('falls back gracefully on unknown theme string', () => {
    const fallback = resolveTheme({ theme: 'nonexistent-theme-xyz', themeMode: 'dark' });
    assert.equal(fallback.primary, 'cyan');
  });
});

describe('detectThemeMode', () => {
  it('respects explicit themeMode', () => {
    assert.equal(detectThemeMode({ themeMode: 'light' }), 'light');
    assert.equal(detectThemeMode({ themeMode: 'dark' }), 'dark');
  });

  it('detects light mode from COLORFGBG environment variable', () => {
    const orig = process.env.COLORFGBG;
    try {
      process.env.COLORFGBG = '0;15'; // 15 is bright white (light background)
      assert.equal(detectThemeMode({ themeMode: 'auto' }), 'light');

      process.env.COLORFGBG = '15;0'; // 0 is black (dark background)
      assert.equal(detectThemeMode({ themeMode: 'auto' }), 'dark');
    } finally {
      if (orig === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = orig;
    }
  });
});

