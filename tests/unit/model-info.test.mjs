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

describe('resolveEffortLevel transcript signal', () => {
  // Real entry shapes, mirrored from a live transcript: the host persists each
  // /effort invocation as a skipRun user record whose whole text is the command
  // markup, plus a stdout record carrying an enter/exit system reminder. All
  // other entry types (reasoning, function_call, assistant messages) are echo
  // pollution and must be ignored.
  const usageLine = {
    type: 'message', role: 'assistant',
    providerData: { rawUsage: { prompt_tokens: 10 } },
  };
  const effortCommand = (level) => ({
    type: 'message', role: 'user',
    content: [{ type: 'input_text', text: `<command-name>/effort</command-name><command-args>${level}</command-args>` }],
    providerData: { skipRun: true },
  });
  const stdoutRecord = (marker) => ({
    type: 'message', role: 'user',
    content: [{ type: 'input_text', text: `<local-command-stdout><system-reminder data-role="ultra_effort_${marker}">\n</system-reminder></local-command-stdout>` }],
    providerData: { skipRun: true },
  });
  const echoEntry = (type, role) => ({
    type, role,
    content: [{ type: 'text', text: 'analyzing <command-name>/effort</command-name><command-args>xhigh</command-args> markers' }],
  });

  function writeTranscript(lines) {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
    return transcriptPath;
  }

  function dataWithTranscript(transcriptPath) {
    return { transcript_path: transcriptPath, cwd: tmpDir, model: { id: 'unknown-model-xyz' } };
  }

  function useSettings(value) {
    const settingsPath = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ reasoningEffort: value }));
    process.env.CODEBUDDY_SETTINGS_PATH = settingsPath;
    resetModelInfoCache();
  }

  it("shows ultracode from the /effort record even when settings.json still says 'max'", () => {
    useSettings('max');
    const transcriptPath = writeTranscript([usageLine, effortCommand('ultracode'), usageLine]);
    assert.equal(resolveEffortLevel(dataWithTranscript(transcriptPath)), 'ultracode');
  });

  it('detects ultracode from the enter stdout record alone', () => {
    useSettings('max');
    const transcriptPath = writeTranscript([stdoutRecord('enter'), usageLine]);
    assert.equal(resolveEffortLevel(dataWithTranscript(transcriptPath)), 'ultracode');
  });

  it('lets the newest /effort command win over older markers', () => {
    useSettings('max');
    const transcriptPath = writeTranscript([
      effortCommand('ultracode'),
      stdoutRecord('enter'),
      usageLine,
      effortCommand('max'),
      usageLine,
    ]);
    assert.equal(resolveEffortLevel(dataWithTranscript(transcriptPath)), 'max');
  });

  it('lets a session override beat the settings value', () => {
    useSettings('max');
    const transcriptPath = writeTranscript([effortCommand('high'), usageLine]);
    assert.equal(resolveEffortLevel(dataWithTranscript(transcriptPath)), 'high');
  });

  it('ignores empty-args /effort records (picker open) and keeps the older signal', () => {
    useSettings('max');
    const transcriptPath = writeTranscript([stdoutRecord('enter'), effortCommand(''), usageLine]);
    assert.equal(resolveEffortLevel(dataWithTranscript(transcriptPath)), 'ultracode');
  });

  it('ignores the host unresolved ${level} template record', () => {
    useSettings('max');
    const transcriptPath = writeTranscript([stdoutRecord('enter'), effortCommand('${level}'), usageLine]);
    assert.equal(resolveEffortLevel(dataWithTranscript(transcriptPath)), 'ultracode');
  });

  it('ignores effort markup echoed in reasoning, tool-call and assistant entries', () => {
    useSettings('max');
    const transcriptPath = writeTranscript([
      effortCommand('ultracode'),
      stdoutRecord('enter'),
      usageLine,
      echoEntry('reasoning'),
      echoEntry('function_call'),
      echoEntry('message', 'assistant'),
      usageLine,
    ]);
    assert.equal(resolveEffortLevel(dataWithTranscript(transcriptPath)), 'ultracode');
  });

  it('falls back to settings when the transcript has no effort markers', () => {
    useSettings('max');
    const transcriptPath = writeTranscript([usageLine, usageLine]);
    assert.equal(resolveEffortLevel(dataWithTranscript(transcriptPath)), 'max');
  });

  it('falls back to settings when the transcript file is missing', () => {
    useSettings('max');
    const data = { transcript_path: path.join(tmpDir, 'nope.jsonl'), cwd: tmpDir, model: { id: 'unknown-model-xyz' } };
    assert.equal(resolveEffortLevel(data), 'max');
  });

  it('finds markers far back in a transcript larger than the tail budget', () => {
    useSettings('max');
    const padding = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'pad '.repeat(6 * 1024) }] };
    const transcriptPath = writeTranscript([effortCommand('ultracode'), padding, usageLine]);
    assert.equal(resolveEffortLevel(dataWithTranscript(transcriptPath)), 'ultracode');
  });

  it('treats an exited ultracode as no session override', () => {
    useSettings('xhigh');
    const transcriptPath = writeTranscript([stdoutRecord('enter'), stdoutRecord('exit'), usageLine]);
    assert.equal(resolveEffortLevel(dataWithTranscript(transcriptPath)), 'xhigh');
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

describe('Large transcript (>256KB) effort retention & monotonicity', () => {
  const usageLine = {
    type: 'message', role: 'assistant',
    providerData: { rawUsage: { prompt_tokens: 10 } },
  };
  const effortCommand = (level) => ({
    type: 'message', role: 'user',
    content: [{ type: 'input_text', text: `<command-name>/effort</command-name><command-args>${level}</command-args>` }],
    providerData: { skipRun: true },
  });
  const stdoutRecord = (marker) => ({
    type: 'message', role: 'user',
    content: [{ type: 'input_text', text: `<local-command-stdout><system-reminder data-role="ultra_effort_${marker}">\n</system-reminder></local-command-stdout>` }],
    providerData: { skipRun: true },
  });

  function dataWithTranscript(transcriptPath) {
    return { transcript_path: transcriptPath, cwd: tmpDir, model: { id: 'unknown-model-xyz' } };
  }

  function useSettings(value) {
    const settingsPath = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ reasoningEffort: value }));
    process.env.CODEBUDDY_SETTINGS_PATH = settingsPath;
    resetModelInfoCache();
  }

  it('retains ultracode in a 1.2MB transcript where command is far outside tail window', () => {
    useSettings('max');
    const transcriptPath = path.join(tmpDir, 'large-transcript.jsonl');
    const padLine = JSON.stringify({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'x'.repeat(10000) }],
    }) + '\n';

    // 130 lines * 10KB ≈ 1.3MB padding between command and EOF
    const headLines = [
      JSON.stringify(effortCommand('ultracode')),
      JSON.stringify(stdoutRecord('enter')),
    ].join('\n') + '\n';
    const tailLines = JSON.stringify(usageLine) + '\n';

    fs.writeFileSync(transcriptPath, headLines + padLine.repeat(130) + tailLines);
    assert.ok(fs.statSync(transcriptPath).size > 1.2 * 1024 * 1024);

    const level = resolveEffortLevel(dataWithTranscript(transcriptPath));
    assert.equal(level, 'ultracode');
  });

  it('monotonicity: preserves exit signal and does not ghost-resurrect ultracode from head after growth', () => {
    useSettings('max');
    const transcriptPath = path.join(tmpDir, 'large-exit.jsonl');
    const padLine = JSON.stringify({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'y'.repeat(10000) }],
    }) + '\n';

    // Step 1: Initial ultracode, followed by 500KB+ of conversation, then exit
    const part1 = [
      JSON.stringify(effortCommand('ultracode')),
      JSON.stringify(stdoutRecord('enter')),
      padLine.repeat(55),
      JSON.stringify(stdoutRecord('exit')),
      JSON.stringify(usageLine),
    ].join('\n') + '\n';
    fs.writeFileSync(transcriptPath, part1);

    // Verify exit signal was recognized and saved (falls back to settings 'max')
    const levelAtExit = resolveEffortLevel(dataWithTranscript(transcriptPath));
    assert.equal(levelAtExit, 'max');

    // Step 2: Session grows by another 300KB+ (total > 800KB).
    // Exit marker is now pushed 350KB away from tail (outside the 256KB tail window).
    fs.appendFileSync(transcriptPath, padLine.repeat(35) + JSON.stringify(usageLine) + '\n');
    assert.ok(fs.statSync(transcriptPath).size > 800 * 1024);

    // Verify subsequent resolution does NOT ghost-resurrect ultracode from the file head!
    const levelAfterGrowth = resolveEffortLevel(dataWithTranscript(transcriptPath));
    assert.equal(levelAfterGrowth, 'max');
  });
});
