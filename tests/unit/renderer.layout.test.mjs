import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';

const require = createRequire(import.meta.url);
const { renderHUD } = require('../../runtime/renderer.js');

let originalCodeBuddyHome;
let testCodeBuddyHome;

before(() => {
  originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  testCodeBuddyHome = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'cbhud-renderer-home-'));
  process.env.CODEBUDDY_HOME = testCodeBuddyHome;
});

after(() => {
  if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
  fs.rmSync(testCodeBuddyHome, { recursive: true, force: true });
});

const fullPayload = {
  model: { id: 'gpt-5.5', display_name: 'GPT-5.5' },
  permission_mode: 'default',
  cwd: '/tmp/my-project',
  version: '2.95.1',
  cost: {
    total_cost_usd: 0.5,
    total_duration_ms: 769524,
    total_api_duration_ms: 600596,
    total_lines_added: 168,
    total_lines_removed: 1,
  },
  context_window: {
    total_input_tokens: 715867,
    total_output_tokens: 22905,
    context_window_size: 1000000,
    used_percentage: 9.17,
    current_usage: {
      input_tokens: 91000,
      output_tokens: 700,
      cache_read_input_tokens: 5800000,
      cache_creation_input_tokens: 0,
    },
  },
};

const defaultConfig = {
  theme: { primary: 'green', secondary: 'gray', warning: 'yellow', critical: 'red', accent: 'cyan', diffAdd: 'green', diffRemove: 'red' },
  display: { showTokenBar: true, showDiffStats: true, showAgentStatus: true, showCost: true, showDuration: true, showCurrentDir: true, showVersion: true, showPermissionMode: true, useNerdFonts: false, unicode: false, maxLines: 3, progressBarWidth: 10, showCacheHitRate: true },
  thresholds: { warning: 0.7, critical: 0.9 },
  cacheHitThresholds: { excellent: 80, partial: 50 },
  defaultEffortLevel: 'medium',
  language: 'en',
};

describe('renderHUD', () => {
  it('renders 3 lines for full payload', () => {
    const output = renderHUD(fullPayload, defaultConfig);
    const lines = output.split('\n');
    assert.equal(lines.length, 3);
  });

  it('line 1 contains model name', () => {
    const output = renderHUD(fullPayload, defaultConfig);
    const line1 = output.split('\n')[0];
    assert.ok(line1.includes('GPT-5.5'));
  });

  it('line 1 contains directory name', () => {
    const output = renderHUD(fullPayload, defaultConfig);
    const line1 = output.split('\n')[0];
    assert.ok(line1.includes('my-project'));
  });

  it('line 2 contains token info and progress bar', () => {
    const output = renderHUD(fullPayload, defaultConfig);
    const line2 = output.split('\n')[1];
    assert.ok(line2.includes('Token'));
    assert.ok(line2.includes('91k'));
    assert.ok(line2.includes('#') || line2.includes('\u2588'));
  });

  it('line 3 contains diff stats', () => {
    const output = renderHUD(fullPayload, defaultConfig);
    const line3 = output.split('\n')[2];
    assert.ok(line3.includes('+168'));
    assert.ok(line3.includes('-1'));
  });

  it('line 3 merged with diff and cost info', () => {
    const output = renderHUD(fullPayload, defaultConfig);
    const line3 = output.split('\n')[2];
    assert.ok(line3.includes('+168'));
    assert.ok(line3.includes('-1'));
    assert.ok(line3.includes('$0.50'));
  });

  it('omits line 3 for minimal payload', () => {
    const minimal = {
      model: { display_name: 'Test' },
      context_window: { context_window_size: 100000, used_percentage: 5, current_usage: { input_tokens: 5000, output_tokens: 100 } },
    };
    const output = renderHUD(minimal, defaultConfig);
    const lines = output.split('\n');
    assert.equal(lines.length, 2);
  });

  it('returns empty string for null input', () => {
    assert.equal(renderHUD(null, defaultConfig), '');
  });

  it('respects maxLines config', () => {
    const config = { ...defaultConfig, display: { ...defaultConfig.display, maxLines: 2 } };
    const output = renderHUD(fullPayload, config);
    assert.equal(output.split('\n').length, 2);
  });

  it('never exceeds three lines even when untrusted config requests more', () => {
    const config = { ...defaultConfig, display: { ...defaultConfig.display, maxLines: 9999 } };
    assert.ok(renderHUD(fullPayload, config).split('\n').length <= 3);
  });

  it('line 2 contains the transcript-sourced cache hit rate', () => {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'cbhud-layout-cache-'));
    try {
      const transcript = nodePath.join(dir, 'cache.jsonl');
      fs.writeFileSync(transcript, JSON.stringify({
        type: 'function_call', callId: 'cache-1', name: 'Read',
        providerData: { rawUsage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 900 } },
      }) + '\n');
      // Unique cwd keeps session-stats state isolated from the shared
      // fullPayload cwd used by the diff assertions later in this file.
      const output = renderHUD({ ...fullPayload, cwd: dir, transcript_path: transcript }, defaultConfig);
      const line2 = output.split('\n')[1];
      assert.ok(line2.includes('cache 90.0%'), line2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('degrades to cache -- instead of faking 0.0% when the transcript is missing', () => {
    const payload = {
      ...fullPayload,
      cwd: nodePath.join(os.tmpdir(), 'cbhud-missing-transcript-proj'),
      transcript_path: nodePath.join(os.tmpdir(), 'cbhud-definitely-missing.jsonl'),
      context_window: {
        ...fullPayload.context_window,
        current_usage: {
          input_tokens: 10000, output_tokens: 500,
          cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
        },
      },
    };
    const output = renderHUD(payload, defaultConfig);
    const line2 = output.split('\n')[1];
    assert.ok(line2.includes('cache --'), line2);
    assert.ok(!/cache \d+\.\d+%/.test(line2), line2);
  });

  it('showCacheHitRate false disables cache badge', () => {
    const config = { ...defaultConfig, display: { ...defaultConfig.display, showCacheHitRate: false } };
    const output = renderHUD(fullPayload, config);
    const line2 = output.split('\n')[1];
    assert.ok(!line2.match(/cache \d+\.\d+%/));
  });

  it('line 2 numerator matches used_percentage (no 1.1M/1M=6% mismatch)', () => {
    // Reproduces the bug where total_input_tokens (session cumulative) was used
    // as the numerator while used_percentage was current_usage based. The two
    // were often wildly inconsistent. Fix: use inTokens for both.
    // fullPayload: current_usage.input_tokens=91000, context_window_size=1000000,
    // used_percentage=9.17 → current input must appear, cumulative must not.
    const output = renderHUD(fullPayload, defaultConfig);
    const line2 = output.split('\n')[1];
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const plain = stripAnsi(line2);
    assert.ok(plain.includes('91k') && plain.includes('1M'),
      `expected 91k and 1M in line2, got: ${plain}`);
    assert.ok(!plain.includes('715.9k') && !plain.includes('715k'),
      `cumulative numerator must not leak: ${plain}`);
  });

  it('line 1 preserves bypassPermissions in full (no bypassPermissio truncation)', () => {
    const payload = { ...fullPayload, permission_mode: 'bypassPermissions' };
    const output = renderHUD(payload, defaultConfig);
    const line1 = output.split('\n')[0];
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const plain = stripAnsi(line1);
    assert.ok(plain.includes('bypassPermissions'),
      `expected full bypassPermissions, got: ${plain}`);
    // `bypassPermissio` was the 15-char truncation. `bypassPermissions` is the
    // legitimate full word and contains that prefix as a substring, so assert the
    // truncated form is not present *as a token* (followed by ANSI reset).
    assert.ok(!/bypassPermissio\x1b/.test(line1),
      `must not end with bypassPermissio: ${JSON.stringify(line1)}`);
  });
});

describe('renderHUD — tool activity merged into line 3', () => {
  let tmpDir;
  let transcriptPath;

  before(() => {
    tmpDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'cbhud-layout-'));
    transcriptPath = nodePath.join(tmpDir, 'transcript.jsonl');
    const call = JSON.stringify({
      type: 'function_call', callId: 'call-x', name: 'Edit',
      arguments: JSON.stringify({ file_path: '/proj/auth.ts' }), sessionId: 's',
    });
    fs.writeFileSync(transcriptPath, call + '\n');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('merges diff and tool segment on line 3', () => {
    const payload = { ...fullPayload, transcript_path: transcriptPath };
    const output = renderHUD(payload, defaultConfig);
    const lines = output.split('\n');
    assert.equal(lines.length, 3);
    const line3 = lines[2];
    assert.ok(line3.includes('+168'));
    assert.ok(line3.includes('Edit'));
    assert.ok(line3.includes('auth.ts'));
  });

  it('shows tool segment alone when no diff/cost data', () => {
    const payload = {
      model: { display_name: 'Test' },
      transcript_path: transcriptPath,
      context_window: { context_window_size: 100000, used_percentage: 5, current_usage: { input_tokens: 5000, output_tokens: 100 } },
    };
    const output = renderHUD(payload, defaultConfig);
    const lines = output.split('\n');
    assert.equal(lines.length, 3);
    assert.ok(lines[2].includes('Edit'));
  });

  it('showToolActivity=false suppresses the tool segment', () => {
    const config = { ...defaultConfig, display: { ...defaultConfig.display, showToolActivity: false } };
    const payload = { ...fullPayload, transcript_path: transcriptPath };
    const output = renderHUD(payload, config);
    assert.ok(!output.includes('auth.ts'));
  });

  it('missing transcript file degrades silently', () => {
    const payload = { ...fullPayload, transcript_path: nodePath.join(tmpDir, 'nope.jsonl') };
    const output = renderHUD(payload, defaultConfig);
    assert.equal(output.split('\n').length, 3);
  });

  it('uses one turn scan to render actual transcript credits', () => {
    const creditTranscript = nodePath.join(tmpDir, 'credits.jsonl');
    const user = JSON.stringify({ type: 'message', role: 'user', content: [] });
    const usage = (credit) => JSON.stringify({
      type: 'function_call', callId: 'credit-' + credit, name: 'Bash',
      providerData: { rawUsage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 900, credit } },
    });
    fs.writeFileSync(creditTranscript, [user, usage(1.25), usage(4.6)].join('\n') + '\n');
    const payload = {
      ...fullPayload,
      cost: { ...fullPayload.cost, total_cost_usd: 0 },
      transcript_path: creditTranscript,
    };
    const output = renderHUD(payload, defaultConfig);
    assert.ok(output.includes('5.85 credits'), output);
    assert.ok(!output.includes('0.00x credits'), output);
  });

  it('hides incomplete transcript credits without falling back to payload credits', () => {
    const transcriptPath = nodePath.join(tmpDir, 'incomplete-credits.jsonl');
    const usage = (id, credit, padding = 0) => JSON.stringify({
      type: 'function_call', callId: id, name: 'Bash',
      providerData: { rawUsage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 900, credit } },
      padding: 'x'.repeat(padding),
    });
    const first = usage('first', 5) + '\n';
    fs.writeFileSync(transcriptPath, first + usage('noise', null, 130000) + '\n' + usage('last', 7) + '\n');

    const originalNow = Date.now;
    const ticks = [0, 0, 101];
    let output;
    try {
      Date.now = () => (ticks.length > 0 ? ticks.shift() : 102);
      output = renderHUD({
        ...fullPayload,
        cost: { ...fullPayload.cost, credits: 99, total_cost_usd: 0 },
        transcript_path: transcriptPath,
      }, defaultConfig);
    } finally {
      Date.now = originalNow;
    }

    assert.ok(!output.includes('5.00 credits'), output);
    assert.ok(!output.includes('99.00 credits'), output);
  });

  it('resets visible diff and duration after /clear while the transcript path remains stable', () => {
    // Unique cwd keeps the cwd-scoped session-stats handoff record isolated
    // from other tests that share the default fullPayload cwd.
    const clearCwd = nodePath.join(tmpDir, 'clear-proj');
    const clearTranscript = nodePath.join(tmpDir, 'clear-session.jsonl');
    fs.writeFileSync(clearTranscript, '');
    const beforeClear = {
      ...fullPayload,
      cwd: clearCwd,
      session_id: 'clear-session',
      transcript_path: clearTranscript,
      cost: {
        total_cost_usd: 0,
        total_lines_added: 1700,
        total_lines_removed: 161,
        total_duration_ms: 10020000,
        total_api_duration_ms: 4980000,
      },
      context_window: {
        ...fullPayload.context_window,
        total_input_tokens: 100000,
        current_usage: { ...fullPayload.context_window.current_usage, input_tokens: 90000 },
      },
    };
    assert.ok(renderHUD(beforeClear, defaultConfig).includes('+1.7k'));

    const afterClear = {
      ...beforeClear,
      context_window: {
        ...beforeClear.context_window,
        total_input_tokens: 0,
        current_usage: { ...beforeClear.context_window.current_usage, input_tokens: 0 },
      },
    };
    const clearedOutput = renderHUD(afterClear, defaultConfig);
    assert.ok(!clearedOutput.includes('+1.7k'), clearedOutput);
    assert.ok(!clearedOutput.includes('2h47m'), clearedOutput);

    const nextTurn = {
      ...afterClear,
      cost: {
        ...afterClear.cost,
        total_lines_added: 1712,
        total_lines_removed: 164,
        total_duration_ms: 10045000,
        total_api_duration_ms: 4989000,
      },
      context_window: {
        ...afterClear.context_window,
        total_input_tokens: 900,
        current_usage: { ...afterClear.context_window.current_usage, input_tokens: 900 },
      },
    };
    const nextOutput = renderHUD(nextTurn, defaultConfig);
    assert.ok(nextOutput.includes('+12'), nextOutput);
    assert.ok(nextOutput.includes('-3'), nextOutput);
    assert.ok(nextOutput.includes('25s'), nextOutput);
  });
});

describe('effort label injection defence (hard constraint 5)', () => {
  const config = {
    theme: {}, display: { maxLines: 4 }, thresholds: {}, cacheHitThresholds: {},
    defaultEffortLevel: 'medium',
  };

  it('never emits raw escapes carried by payload effort fields', () => {
    const payload = {
      model: { display_name: 'Hy4', id: 'hy4', effort: 'high\x1b[31m\x07\x1b]0;PWNED\x07' },
      cwd: os.tmpdir(),
      permission_mode: 'default',
      context_window: { context_window_size: 1000000, used_percentage: 1, current_usage: { input_tokens: 1, output_tokens: 1 } },
    };
    const output = renderHUD(payload, config);
    assert.ok(!output.includes('\x1b]0;PWNED'), 'OSC title sequence leaked');
    assert.ok(!/\x1b\[31m/.test(output), 'raw SGR leaked');
  });

  it('never emits raw escapes carried by an untrusted project config defaultEffortLevel', () => {
    const evilConfig = {
      ...config,
      defaultEffortLevel: 'max\x1b[2J\x1b[1;31mINJECT\x1b]8;;http://evil\x07',
    };
    const payload = {
      model: { display_name: 'Hy4', id: 'hy4' },
      cwd: os.tmpdir(),
      permission_mode: 'default',
      context_window: { context_window_size: 1000000, used_percentage: 1, current_usage: { input_tokens: 1, output_tokens: 1 } },
    };
    const output = renderHUD(payload, evilConfig);
    assert.ok(!/\x1b\[2J/.test(output), 'clear-screen CSI leaked');
    assert.ok(!/\x1b\]8;;http/.test(output), 'OSC-8 hyperlink leaked');
    assert.ok(!output.includes('\x07'), 'BEL leaked');
  });

  it('sanitizes model, permission, version, and agent fields from the payload', () => {
    const payload = {
      model: { display_name: 'model\x1b]8;;https://evil.invalid\x07name\u202e', id: 'ignored' },
      cwd: os.tmpdir(),
      permission_mode: 'perm\x9b2J\u2066',
      version: 'v\x1b[2J\u200f',
      agents: [{ id: 'a', name: 'agent\x1b]0;title\x07\u202e', status: 'active' }],
      context_window: { context_window_size: 1000000, used_percentage: 1, current_usage: { input_tokens: 1, output_tokens: 1 } },
    };
    const output = renderHUD(payload, { ...config, display: { ...config.display, showVersion: true } });
    assert.ok(!output.includes('\x1b]8;;https://evil.invalid'));
    assert.ok(!output.includes('\x1b]0;title'));
    assert.ok(!output.includes('\x1b[2J'));
    assert.ok(!/[\x80-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(output));
  });

  it('renders gracefully without crashing when config lacks display or theme sub-objects', () => {
    const payload = {
      model: { display_name: 'TestModel', id: 'test' },
      cwd: os.tmpdir(),
      context_window: { context_window_size: 1000000, used_percentage: 20, current_usage: { input_tokens: 100, output_tokens: 50 } },
    };
    const out1 = renderHUD(payload, {});
    assert.ok(typeof out1 === 'string' && out1.length > 0);
    assert.ok(out1.split('\n').length <= 3);
    assert.ok(out1.includes('TestModel'));

    const out2 = renderHUD(payload, { theme: {} });
    assert.ok(typeof out2 === 'string' && out2.length > 0);
    assert.ok(out2.split('\n').length <= 3);
    assert.ok(out2.includes('TestModel'));
  });

  it('clamps context percentage string to [0, 100]', () => {
    const overflowPayload = {
      model: { display_name: 'TestModel', id: 'test' },
      cwd: os.tmpdir(),
      context_window: { context_window_size: 1000000, used_percentage: 250, current_usage: { input_tokens: 100, output_tokens: 50 } },
    };
    const underflowPayload = {
      model: { display_name: 'TestModel', id: 'test' },
      cwd: os.tmpdir(),
      context_window: { context_window_size: 1000000, used_percentage: -20, current_usage: { input_tokens: 100, output_tokens: 50 } },
    };
    const overflowOut = renderHUD(overflowPayload, defaultConfig);
    const underflowOut = renderHUD(underflowPayload, defaultConfig);
    assert.ok(overflowOut.includes('100%'), 'overflow must clamp to 100%');
    assert.ok(!overflowOut.includes('250%'), 'overflow must not display 250%');
    assert.ok(underflowOut.includes('0%'), 'underflow must clamp to 0%');
    assert.ok(!underflowOut.includes('-20%'), 'underflow must not display negative percentage');
  });
});
