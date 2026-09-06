import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { resolveEffortLevel, resolveCreditSpend, resetModelInfoCache } = require('../../runtime/model-info.js');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODEL_INFO_PATH = path.join(REPO_ROOT, 'runtime', 'model-info.js');

let originalSettingsPath;
let originalCodeBuddyHome;
let tmpDir;

beforeEach(() => {
  resetModelInfoCache();
  originalSettingsPath = process.env.CODEBUDDY_SETTINGS_PATH;
  originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-modelinfo-'));
  process.env.CODEBUDDY_HOME = path.join(tmpDir, 'codebuddy-home');
  process.env.CODEBUDDY_SETTINGS_PATH = path.join(tmpDir, 'missing-settings.json');
});

afterEach(() => {
  if (originalSettingsPath === undefined) {
    delete process.env.CODEBUDDY_SETTINGS_PATH;
  } else {
    process.env.CODEBUDDY_SETTINGS_PATH = originalSettingsPath;
  }
  if (originalCodeBuddyHome === undefined) {
    delete process.env.CODEBUDDY_HOME;
  } else {
    process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
  }
  resetModelInfoCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveEffortLevel', () => {
  it('returns null for null cbData', () => {
    assert.equal(resolveEffortLevel(null), null);
  });

  it('prefers top-level reasoning_effort', () => {
    const data = { reasoning_effort: 'HIGH', model: { effort: 'low' } };
    assert.equal(resolveEffortLevel(data), 'high');
  });

  it('falls back to model.effort', () => {
    const data = { model: { effort: 'Max' } };
    assert.equal(resolveEffortLevel(data), 'max');
  });

  it('falls back to model.reasoning_effort', () => {
    const data = { model: { reasoning_effort: 'LOW' } };
    assert.equal(resolveEffortLevel(data), 'low');
  });

  it('infers effort from GPT-5 model name', () => {
    const data = { model: { id: 'gpt-5-turbo' } };
    assert.equal(resolveEffortLevel(data), 'high');
  });

  it('infers effort from Claude Sonnet', () => {
    const data = { model: { display_name: 'Claude 3.5 Sonnet' } };
    assert.equal(resolveEffortLevel(data), 'high');
  });

  it('infers effort from Claude Opus', () => {
    const data = { model: { id: 'claude-opus-4' } };
    assert.equal(resolveEffortLevel(data), 'max');
  });

  it('infers effort from Claude Haiku', () => {
    const data = { model: { id: 'claude-haiku-3' } };
    assert.equal(resolveEffortLevel(data), 'medium');
  });

  it('infers effort from o1 model', () => {
    const data = { model: { id: 'o1-preview' } };
    assert.equal(resolveEffortLevel(data), 'max');
  });

  it('infers effort from o3 model', () => {
    const data = { model: { id: 'o3-mini' } };
    assert.equal(resolveEffortLevel(data), 'max');
  });

  it('infers effort from o4-mini', () => {
    const data = { model: { id: 'o4-mini' } };
    assert.equal(resolveEffortLevel(data), 'high');
  });

  it('infers effort from GPT-4o', () => {
    const data = { model: { id: 'gpt-4o' } };
    assert.equal(resolveEffortLevel(data), 'medium');
  });

  it('infers effort from Gemini Pro', () => {
    const data = { model: { id: 'gemini-2.0-pro' } };
    assert.equal(resolveEffortLevel(data), 'high');
  });

  it('infers effort from Gemini Flash', () => {
    const data = { model: { id: 'gemini-2.0-flash' } };
    assert.equal(resolveEffortLevel(data), 'medium');
  });

  it('infers effort from DeepSeek R1', () => {
    const data = { model: { id: 'deepseek-r1' } };
    assert.equal(resolveEffortLevel(data), 'max');
  });

  it('infers effort from generic DeepSeek', () => {
    const data = { model: { id: 'deepseek-chat' } };
    assert.equal(resolveEffortLevel(data), 'medium');
  });

  it('uses config defaultEffortLevel as final fallback', () => {
    const data = { model: { id: 'unknown-model-xyz' } };
    const config = { defaultEffortLevel: 'High' };
    assert.equal(resolveEffortLevel(data, config), 'high');
  });

  it('returns null when no source available and no config fallback', () => {
    const data = { model: { id: 'unknown-model-xyz' } };
    assert.equal(resolveEffortLevel(data, {}), null);
  });

  it('normalizes effort to lowercase and recognizes 6 effort levels', () => {
    assert.equal(resolveEffortLevel({ reasoning_effort: 'LOW' }), 'low');
    assert.equal(resolveEffortLevel({ reasoning_effort: 'MEDIUM' }), 'medium');
    assert.equal(resolveEffortLevel({ reasoning_effort: 'HIGH' }), 'high');
    assert.equal(resolveEffortLevel({ reasoning_effort: 'XHIGH' }), 'xhigh');
    assert.equal(resolveEffortLevel({ reasoning_effort: 'MAX' }), 'max');
    assert.equal(resolveEffortLevel({ reasoning_effort: 'ULTRACODE' }), 'ultracode');
  });

  it('recognizes aliases for effort levels', () => {
    assert.equal(resolveEffortLevel({ reasoning_effort: 'extra-high' }), 'xhigh');
    assert.equal(resolveEffortLevel({ reasoning_effort: 'extra_high' }), 'xhigh');
    assert.equal(resolveEffortLevel({ reasoning_effort: 'maximum' }), 'max');
    assert.equal(resolveEffortLevel({ reasoning_effort: 'ultra' }), 'ultracode');
  });

  it('rejects non-whitelisted effort values and falls through to inference', () => {
    const data = { reasoning_effort: 'INVALID_EFFORT_XYZ', model: { id: 'gpt-5-turbo' } };
    assert.equal(resolveEffortLevel(data), 'high');
  });

  it('rejects an injected effort value from any source', () => {
    const data = { reasoning_effort: 'high\x1b[2J\x1b]0;pwned\x07', model: { id: 'unknown-model-xyz' } };
    const config = { defaultEffortLevel: 'max\x1b[2J\x1b[1;31mINJECT' };
    assert.equal(resolveEffortLevel(data, config), null);
  });

  it('rejects non-whitelisted defaultEffortLevel from untrusted project config', () => {
    const data = { model: { id: 'unknown-model-xyz' } };
    const config = { defaultEffortLevel: 'max\x1b[2J\x1b[1;31mINJECT\x1b]8;;http://evil\x07' };
    assert.equal(resolveEffortLevel(data, config), null);
  });

  it('rejects non-string effort values', () => {
    const data = { reasoning_effort: { malicious: true }, model: { id: 'unknown-model-xyz' } };
    const config = { defaultEffortLevel: 5 };
    assert.equal(resolveEffortLevel(data, config), null);
  });

  it('reads reasoningEffort from settings.json when present', () => {
    const tmpSettings = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(tmpSettings, JSON.stringify({ reasoningEffort: 'xhigh' }));
    process.env.CODEBUDDY_SETTINGS_PATH = tmpSettings;
    resetModelInfoCache();
    const data = { model: { id: 'unknown-model-xyz' } };
    assert.equal(resolveEffortLevel(data), 'xhigh');
  });

  it('keeps same-mtime settings files separate when the configured path changes', () => {
    const settingsA = path.join(tmpDir, 'settings-a.json');
    const settingsB = path.join(tmpDir, 'settings-b.json');
    const fixedTime = new Date('2026-01-01T00:00:00.000Z');
    const data = { model: { id: 'unknown-model-xyz' } };
    fs.writeFileSync(settingsA, JSON.stringify({ reasoningEffort: 'high' }));
    fs.writeFileSync(settingsB, JSON.stringify({ reasoningEffort: 'low' }));
    fs.utimesSync(settingsA, fixedTime, fixedTime);
    fs.utimesSync(settingsB, fixedTime, fixedTime);

    process.env.CODEBUDDY_SETTINGS_PATH = settingsA;
    assert.equal(resolveEffortLevel(data), 'high');
    process.env.CODEBUDDY_SETTINGS_PATH = settingsB;
    assert.equal(resolveEffortLevel(data), 'low');
  });

  it('does not read a legacy disk effort cache in a separate process', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    const cachePath = path.join(process.env.CODEBUDDY_HOME, 'codebuddy-hud-cache-state.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ reasoningEffort: 'low' }));
    const legacyCache = JSON.stringify({
      settingsMtime: fs.statSync(settingsPath).mtimeMs,
      settingsEffort: 'high',
    });
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, legacyCache);

    const output = execFileSync(process.execPath, ['-e', [
      "const { resolveEffortLevel } = require(process.env.MODEL_INFO_PATH);",
      "process.stdout.write(String(resolveEffortLevel({ model: { id: 'unknown-model' } })));",
    ].join(' ')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEBUDDY_SETTINGS_PATH: settingsPath,
        MODEL_INFO_PATH,
      },
    });
    assert.equal(output, 'low');
    assert.equal(fs.readFileSync(cachePath, 'utf8'), legacyCache);
  });

  it('does not create an effort disk cache', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    const cachePath = path.join(process.env.CODEBUDDY_HOME, 'codebuddy-hud-cache-state.json');
    fs.mkdirSync(process.env.CODEBUDDY_HOME, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ reasoningEffort: 'max' }));
    process.env.CODEBUDDY_SETTINGS_PATH = settingsPath;

    assert.equal(resolveEffortLevel({ model: { id: 'unknown-model-xyz' } }), 'max');
    assert.equal(fs.existsSync(cachePath), false);
  });

  it('caches a missing settings file as null for the current path', () => {
    const settingsPath = process.env.CODEBUDDY_SETTINGS_PATH;
    const data = { model: { id: 'unknown-model-xyz' } };
    assert.equal(resolveEffortLevel(data), null);
    fs.writeFileSync(settingsPath, JSON.stringify({ reasoningEffort: 'high' }));
    assert.equal(resolveEffortLevel(data), null);
  });
});

describe('resolveCreditSpend', () => {
  it('returns actual credits from the payload', () => {
    const data = { cost: { credits: 2.5 } };
    assert.equal(resolveCreditSpend(data), 2.5);
  });

  it('preserves a genuine zero-credit payload', () => {
    assert.equal(resolveCreditSpend({ cost: { credits: 0 } }), 0);
  });

  it('returns null for non-numeric or negative credits', () => {
    const data = { cost: { credits: 'premium tier' } };
    assert.equal(resolveCreditSpend(data), null);
    assert.equal(resolveCreditSpend({ cost: { credits: -1 } }), null);
  });

  it('does not invent a zero or use model metadata as a spend fallback', () => {
    assert.equal(resolveCreditSpend({}), null);
    assert.equal(resolveCreditSpend(null), null);
  });
});
