import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { getRecentToolActivity, getTurnToolActivity, getRecentUsageMetrics, getTurnUsageMetrics, getSessionUsageMetrics, extractUsageMetrics, MAX_TOTAL_BYTES } = require('../../runtime/transcript.js');
const { getTranscriptUsageStatePath } = require('../../runtime/paths.js');

let tmpDir;
let originalCodeBuddyHome;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-transcript-'));
  originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  process.env.CODEBUDDY_HOME = path.join(tmpDir, 'codebuddy-home');
});

after(() => {
  if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTmp(name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
}

function cbLine(obj) {
  return JSON.stringify(obj);
}

const cbCall = (callId, name, argsObj) => cbLine({
  type: 'function_call', callId, name, arguments: JSON.stringify(argsObj), sessionId: 's1',
});
const cbResult = (callId, name) => cbLine({
  type: 'function_call_result', callId, name, status: 'completed',
});
const cbMessage = cbLine({ type: 'message', role: 'assistant', message: { content: 'text' } });

describe('getRecentToolActivity — input guards', () => {
  it('returns null for null / empty / non-string paths', () => {
    assert.equal(getRecentToolActivity(null), null);
    assert.equal(getRecentToolActivity(''), null);
    assert.equal(getRecentToolActivity(42), null);
    assert.equal(getRecentToolActivity({}), null);
  });

  it('returns null for paths containing NUL', () => {
    assert.equal(getRecentToolActivity('/tmp/evil\0.json'), null);
  });

  it('returns null when the file does not exist', () => {
    assert.equal(getRecentToolActivity(path.join(tmpDir, 'missing.jsonl')), null);
  });

  it('returns null for an empty file', () => {
    const p = writeTmp('empty.jsonl', '');
    assert.equal(getRecentToolActivity(p), null);
  });

  it('returns null when no tool entries exist', () => {
    const p = writeTmp('notool.jsonl', [cbMessage, cbLine({ type: 'summary', summary: 'x' })].join('\n'));
    assert.equal(getRecentToolActivity(p), null);
  });
});

describe('getRecentToolActivity — CodeBuddy format (function_call)', () => {
  it('reports active when the newest call has no result yet', () => {
    const p = writeTmp('active.jsonl', [
      cbCall('call-1', 'Read', { file_path: '/a/b/first.txt' }),
      cbResult('call-1', 'Read'),
      cbCall('call-2', 'Edit', { file_path: '/a/b/target.ts' }),
    ].join('\n'));
    const r = getRecentToolActivity(p);
    assert.deepEqual(r, { status: 'active', tool: 'Edit', detail: 'target.ts' });
  });

  it('reports done when the newest call has a matching result', () => {
    const p = writeTmp('done.jsonl', [
      cbCall('call-1', 'Bash', { command: 'npm test --silent' }),
      cbResult('call-1', 'Bash'),
    ].join('\n'));
    const r = getRecentToolActivity(p);
    assert.equal(r.status, 'done');
    assert.equal(r.tool, 'Bash');
    assert.equal(r.detail, 'npm test --silent');
  });

  it('handles arguments given as an object', () => {
    const p = writeTmp('objargs.jsonl', cbLine({
      type: 'function_call', callId: 'c1', name: 'Grep', arguments: { pattern: 'foo.*bar' },
    }));
    const r = getRecentToolActivity(p);
    assert.equal(r.tool, 'Grep');
    assert.equal(r.detail, 'foo.*bar');
  });
});

describe('getRecentToolActivity — Claude format (tool_use blocks)', () => {
  it('parses tool_use / tool_result inside message.content', () => {
    const p = writeTmp('claude.jsonl', [
      cbLine({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/x/readme.md' } }] } }),
      cbLine({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }] } }),
      cbLine({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-2', name: 'Write', input: { file_path: '/x/out.md' } }] } }),
    ].join('\n'));
    const r = getRecentToolActivity(p);
    assert.deepEqual(r, { status: 'active', tool: 'Write', detail: 'out.md' });
  });

  it('parses top-level content blocks as well', () => {
    const p = writeTmp('claude-top.jsonl', cbLine({
      type: 'assistant',
      content: [{ type: 'tool_use', id: 'tu-9', name: 'Glob', input: { pattern: 'src/**/*.ts' } }],
    }));
    const r = getRecentToolActivity(p);
    assert.equal(r.status, 'active');
    assert.equal(r.tool, 'Glob');
  });
});

describe('getRecentToolActivity — resilience', () => {
  it('skips a truncated trailing line and finds the call before it', () => {
    const good = cbCall('call-1', 'Edit', { file_path: '/a/x.ts' });
    const half = cbCall('call-2', 'Bash', { command: 'rm' }).slice(0, 20);
    const p = writeTmp('half.jsonl', good + '\n' + half);
    const r = getRecentToolActivity(p);
    assert.equal(r.tool, 'Edit');
    assert.equal(r.status, 'active');
  });

  it('skips corrupt middle lines', () => {
    const p = writeTmp('corrupt.jsonl', [
      cbCall('call-1', 'Read', { file_path: '/a/f.txt' }),
      '%%% not json %%%',
      cbResult('call-1', 'Read'),
    ].join('\n'));
    const r = getRecentToolActivity(p);
    assert.equal(r.status, 'done');
  });

  it('respects the 40-line scan cap', () => {
    const lines = [cbCall('call-old', 'Edit', { file_path: '/a/old.ts' })];
    for (let i = 0; i < 45; i++) lines.push(cbMessage);
    const p = writeTmp('cap.jsonl', lines.join('\n'));
    assert.equal(getRecentToolActivity(p), null);
  });

  it('finds the newest call with a small tail window (sliding)', () => {
    // newest call first in file order: pad between call and result forces sliding
    const lines = [cbCall('call-1', 'Edit', { file_path: '/a/deep.ts' })];
    for (let i = 0; i < 10; i++) lines.push(cbMessage);
    lines.push(cbResult('call-1', 'Edit'));
    const p = writeTmp('slide.jsonl', lines.join('\n'));
    const r = getRecentToolActivity(p, { tailBytes: 64 });
    assert.equal(r.tool, 'Edit');
    assert.equal(r.status, 'done');
  });

  it('reconstructs a call line that straddles a window boundary (carry)', () => {
    const call = cbCall('call-1', 'MultiLineTool', { file_path: '/a/b/carry-check.ts' });
    assert.ok(call.length > 64);
    const p = writeTmp('carry.jsonl', call + '\n' + cbResult('call-1', 'MultiLineTool'));
    const r = getRecentToolActivity(p, { tailBytes: 64 });
    assert.equal(r.tool, 'MultiLineTool');
    assert.equal(r.detail, 'carry-check.ts');
    assert.equal(r.status, 'done');
  });

  it('handles a large file by reading only the tail', () => {
    const filler = cbMessage;
    const parts = [];
    let size = 0;
    while (size < 2 * 1024 * 1024) { parts.push(filler); size += filler.length + 1; }
    parts.push(cbCall('call-big', 'Edit', { file_path: '/big/file.ts' }));
    const p = writeTmp('big.jsonl', parts.join('\n'));
    const start = process.hrtime.bigint();
    const r = getRecentToolActivity(p);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    assert.equal(r.tool, 'Edit');
    assert.ok(elapsedMs < 50, `took ${elapsedMs}ms`);
  });

  it('does not read beyond the MAX_TOTAL_BYTES safety cap', () => {
    const paddingLine = JSON.stringify({ type: 'noise', data: 'x'.repeat(1000) }) + '\n';
    const lines = [];
    for (let i = 0; i < 400; i++) lines.push(paddingLine);
    lines.push(cbCall('call_cap', 'CapTestTool', { action: 'done' }) + '\n');
    const p = writeTmp('cap-test.jsonl', lines.join(''));
    const r = getRecentToolActivity(p);
    assert.ok(r !== null);
    assert.equal(r.tool, 'CapTestTool');
  });
});

describe('getRecentToolActivity — path handling & sanitization', () => {
  it('resolves relative paths against opts.cwd', () => {
    const p = writeTmp('rel.jsonl', cbCall('c1', 'Read', { file_path: '/a/r.txt' }));
    const r = getRecentToolActivity('rel.jsonl', { cwd: tmpDir });
    assert.equal(r.tool, 'Read');
  });

  it('sanitizes ANSI/OSC injection in tool names', () => {
    const p = writeTmp('inject.jsonl', cbCall('c1', 'Edit\x1b]0;evil\x07\x1b[31m', { file_path: '/a/x' }));
    const r = getRecentToolActivity(p);
    assert.ok(!r.tool.includes('\x1b'));
    assert.ok(!r.tool.includes('\x07'));
    assert.ok(r.tool.startsWith('Edit'));
  });

  it('sanitizes detail values', () => {
    const p = writeTmp('inject2.jsonl', cbCall('c1', 'Bash', { command: 'echo\x1b[2J hi' }));
    const r = getRecentToolActivity(p);
    assert.ok(!r.detail.includes('\x1b'));
  });

  it('falls back to empty detail for unknown argument shapes', () => {
    const p = writeTmp('nodetail.jsonl', cbCall('c1', 'Think', { thoughts: 'deep' }));
    const r = getRecentToolActivity(p);
    assert.equal(r.tool, 'Think');
    assert.equal(r.detail, '');
  });
});

// Real providerData shapes observed in ~/.codebuddy/projects/**/*.jsonl.
// Note the trap: `cache_read_input_tokens` is present but hard-zero, while the
// real hit count is `prompt_cache_hit_tokens`.
describe('extractUsageMetrics — real providerData shapes', () => {
  const realRawUsage = {
    prompt_tokens: 133461,
    completion_tokens: 381,
    total_tokens: 133842,
    prompt_tokens_details: { cached_tokens: 133120 },
    prompt_cache_hit_tokens: 133120,
    prompt_cache_miss_tokens: 341,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    prompt_cache_write_tokens: 0,
  };

  it('reads prompt_cache_hit_tokens from rawUsage', () => {
    const m = extractUsageMetrics({
      type: 'function_call',
      providerData: { model: 'hy4-preview', rawUsage: realRawUsage },
    });
    assert.equal(m.hitTokens, 133120);
    assert.equal(m.promptTokens, 133461);
    assert.equal(m.source, 'rawUsage');
    // hit + miss === prompt_tokens proves the denominator is self-consistent
    assert.equal(realRawUsage.prompt_cache_hit_tokens + realRawUsage.prompt_cache_miss_tokens,
      realRawUsage.prompt_tokens);
  });

  it('reads actual credit spend independently from cache telemetry', () => {
    const m = extractUsageMetrics({
      providerData: { rawUsage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 900, credit: 1.25 } },
    });
    assert.equal(m.credit, 1.25);

    const creditOnly = extractUsageMetrics({ providerData: { rawUsage: { credit: 0 } } });
    assert.equal(creditOnly.credit, 0, 'an explicitly reported zero is real telemetry');
    assert.equal(creditOnly.promptTokens, null);
  });

  it('rejects invalid credit telemetry', () => {
    assert.equal(extractUsageMetrics({ providerData: { rawUsage: { credit: -1 } } }), null);
    assert.equal(extractUsageMetrics({ providerData: { rawUsage: { credit: '1.25' } } }), null);
    assert.equal(extractUsageMetrics({ providerData: { rawUsage: { credit: NaN } } }), null);
    assert.equal(extractUsageMetrics({ providerData: { rawUsage: { credit: Infinity } } }), null);
    assert.equal(extractUsageMetrics({ providerData: { rawUsage: { credit: new Number(2) } } }), null);
  });

  it('reads cached_tokens from rawUsage.prompt_tokens_details when prompt_cache_hit_tokens absent', () => {
    const m = extractUsageMetrics({
      providerData: {
        rawUsage: {
          prompt_tokens: 80000,
          prompt_tokens_details: { cached_tokens: 72000 },
        },
      },
    });
    assert.equal(m.hitTokens, 72000);
    assert.equal(m.promptTokens, 80000);
    assert.equal(m.source, 'rawUsage');
  });

  it('falls back to usage.inputTokensDetails when rawUsage absent', () => {
    const m = extractUsageMetrics({
      providerData: {
        usage: {
          inputTokens: 133461,
          outputTokens: 381,
          inputTokensDetails: [{ cached_tokens: 133120 }],
        },
      },
    });
    assert.equal(m.hitTokens, 133120);
    assert.equal(m.promptTokens, 133461);
    assert.equal(m.source, 'usage');
  });

  it('returns null when no providerData', () => {
    assert.equal(extractUsageMetrics({ type: 'function_call' }), null);
    assert.equal(extractUsageMetrics(null), null);
    assert.equal(extractUsageMetrics({ providerData: {} }), null);
  });

  it('reports a genuine cold turn as 0 hits, not null', () => {
    // First turn: prompt_tokens present, cache hit legitimately 0.
    const m = extractUsageMetrics({
      providerData: { rawUsage: { prompt_tokens: 50000, prompt_cache_hit_tokens: 0 } },
    });
    assert.equal(m.hitTokens, 0);
    assert.equal(m.promptTokens, 50000);
  });
});

describe('getRecentUsageMetrics', () => {
  it('returns null for missing path', () => {
    assert.equal(getRecentUsageMetrics(null), null);
    assert.equal(getRecentUsageMetrics(''), null);
    assert.equal(getRecentUsageMetrics('/nonexistent/x.jsonl'), null);
  });

  it('finds the most recent usage block near EOF', () => {
    const older = JSON.stringify({
      type: 'function_call', callId: 'c1', name: 'Read',
      providerData: { rawUsage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 10 } },
    });
    const newer = JSON.stringify({
      type: 'function_call', callId: 'c2', name: 'Edit',
      providerData: { rawUsage: { prompt_tokens: 133461, prompt_cache_hit_tokens: 133120 } },
    });
    const p = writeTmp('usage.jsonl', older + '\n' + newer + '\n');
    const m = getRecentUsageMetrics(p);
    assert.equal(m.promptTokens, 133461);
    assert.equal(m.hitTokens, 133120);
  });

  it('skips corrupt lines and lines without providerData', () => {
    const noise = JSON.stringify({ type: 'user', message: { content: 'hi' } });
    const good = JSON.stringify({
      providerData: { rawUsage: { prompt_tokens: 5000, prompt_cache_hit_tokens: 4000 } },
    });
    const p = writeTmp('usage-noise.jsonl', noise + '\n{broken json\n' + good + '\n');
    const m = getRecentUsageMetrics(p);
    assert.equal(m.promptTokens, 5000);
    assert.equal(m.hitTokens, 4000);
  });

  it('degrades to null when no usage block exists', () => {
    const p = writeTmp('no-usage.jsonl',
      JSON.stringify({ type: 'function_call', callId: 'x', name: 'Read' }) + '\n');
    assert.equal(getRecentUsageMetrics(p), null);
  });
});

// A turn spans many API calls. Sampling only the newest one makes the badge
// swing to ~0% whenever that call is a cold start; per-turn aggregation does not.
describe('getTurnUsageMetrics — per-turn aggregation', () => {
  const userMsg = (text) => JSON.stringify({
    type: 'message', role: 'user', content: [{ type: 'input_text', text }],
  });
  const call = (prompt, hit, credit) => JSON.stringify({
    type: 'function_call', callId: 'c' + prompt, name: 'Bash',
    providerData: {
      rawUsage: {
        prompt_tokens: prompt,
        prompt_cache_hit_tokens: hit,
        ...(credit === undefined ? {} : { credit }),
      },
    },
  });

  it('aggregates every call in the current turn', () => {
    const p = writeTmp('turn-agg.jsonl', [
      userMsg('start'),
      call(100000, 0),
      call(100000, 99000),
      call(100000, 99500),
    ].join('\n') + '\n');

    const m = getTurnUsageMetrics(p);
    assert.equal(m.callCount, 3);
    assert.equal(m.hitTokens, 198500);
    assert.equal(m.promptTokens, 300000);
  });

  it('stays stable when the newest call is a cold start (the 0% bug)', () => {
    const p = writeTmp('turn-cold-last.jsonl', [
      userMsg('start'),
      call(100000, 99000),
      call(100000, 0),
    ].join('\n') + '\n');

    const turn = getTurnUsageMetrics(p);
    const inst = getRecentUsageMetrics(p);
    const instPct = inst.hitTokens / inst.promptTokens * 100;
    const turnPct = turn.hitTokens / turn.promptTokens * 100;

    assert.ok(Math.abs(instPct - 0) < 0.01, 'instantaneous should be 0%, got ' + instPct);
    assert.ok(Math.abs(turnPct - 49.5) < 0.01, 'per-turn should be 49.5%, got ' + turnPct);
  });

  it('stops at the turn boundary and excludes the previous turn', () => {
    const p = writeTmp('turn-boundary.jsonl', [
      userMsg('first question'),
      call(50000, 40000),
      call(50000, 45000),
      userMsg('second question'),
      call(100000, 90000),
    ].join('\n') + '\n');

    const m = getTurnUsageMetrics(p);
    assert.equal(m.callCount, 1, 'only the current turn should be counted');
    assert.equal(m.promptTokens, 100000);
    assert.equal(m.hitTokens, 90000);
  });

  it('aggregates actual credits without crossing the user-turn boundary', () => {
    const p = writeTmp('turn-credits.jsonl', [
      userMsg('first question'),
      call(1000, 900, 10),
      userMsg('second question'),
      call(1000, 950, 1.25),
      call(2000, 1800, 4.6),
      call(3000, 2700, 0),
    ].join('\n') + '\n');

    const m = getTurnUsageMetrics(p);
    assert.equal(m.callCount, 3);
    assert.equal(m.creditCallCount, 3);
    assert.equal(m.credits, 5.85);
  });

  it('returns null when the transcript has no usage blocks', () => {
    const p = writeTmp('turn-empty.jsonl',
      userMsg('hi') + '\n' + JSON.stringify({ type: 'function_call', callId: 'x', name: 'Read' }) + '\n');
    assert.equal(getTurnUsageMetrics(p), null);
  });

  it('returns null for missing path', () => {
    assert.equal(getTurnUsageMetrics(null), null);
    assert.equal(getTurnUsageMetrics('/nonexistent/x.jsonl'), null);
  });

  it('handles a turn with no preceding user message', () => {
    const p = writeTmp('turn-noboundary.jsonl',
      call(1000, 500) + '\n' + call(2000, 1500) + '\n');
    const m = getTurnUsageMetrics(p);
    assert.equal(m.callCount, 2);
    assert.equal(m.hitTokens, 2000);
    assert.equal(m.promptTokens, 3000);
  });

  it('collects the previous completed turn when the file ends with an unresponded user message', () => {
    // Reproduces the idle/input state where a new user prompt has been appended
    // to transcript but the assistant has not made any API calls yet.
    const p = writeTmp('turn-trailing-user.jsonl', [
      userMsg('first turn'),
      call(50000, 40000),
      call(50000, 45000),
      userMsg('second turn pending'),
    ].join('\n') + '\n');

    const m = getTurnUsageMetrics(p);
    assert.equal(m.callCount, 2);
    assert.equal(m.promptTokens, 100000);
    assert.equal(m.hitTokens, 85000);
  });

  it('handles multiple trailing user messages and snapshot entries at EOF', () => {
    const snapshot = JSON.stringify({ type: 'file-history-snapshot', isSnapshotUpdate: false });
    const p = writeTmp('turn-trailing-multi.jsonl', [
      userMsg('turn 1'),
      call(100000, 95000),
      userMsg('system reminder'),
      userMsg('/commit command'),
      snapshot,
    ].join('\n') + '\n');

    const m = getTurnUsageMetrics(p);
    assert.equal(m.callCount, 1);
    assert.equal(m.promptTokens, 100000);
    assert.equal(m.hitTokens, 95000);
  });
});

describe('getSessionUsageMetrics — incremental session aggregation', () => {
  const call = (id, credit) => JSON.stringify({
    type: 'function_call', callId: id, name: 'Bash',
    providerData: { rawUsage: { credit } },
  });

  it('sums credits across every turn and only scans appended lines thereafter', () => {
    const p = writeTmp('session-credits.jsonl', call('a', 1.25) + '\n' + call('b', 4.6) + '\n');
    const state = path.join(tmpDir, 'session-state.json');
    let m = getSessionUsageMetrics(p, { statePath: state });
    assert.equal(m.credits, 5.85);
    assert.equal(m.creditCallCount, 2);
    fs.appendFileSync(p, call('c', 0) + '\n');
    m = getSessionUsageMetrics(p, { statePath: state });
    assert.equal(m.credits, 5.85);
    assert.equal(m.creditCallCount, 3);
    fs.appendFileSync(p, call('d', 2) + '\n');
    m = getSessionUsageMetrics(p, { statePath: state });
    assert.equal(m.credits, 7.85);
    assert.equal(m.creditCallCount, 4);
  });

  it('reads only the appended tail after a normal file growth', () => {
    const filler = JSON.stringify({ message: 'x'.repeat(4096) }) + '\n';
    const p = writeTmp('session-incremental-bytes.jsonl', filler.repeat(160));
    const state = path.join(tmpDir, 'session-incremental-bytes-state.json');
    assert.equal(getSessionUsageMetrics(p, { statePath: state }).credits, null);

    fs.appendFileSync(p, call('appended', 3) + '\n');
    const originalReadSync = fs.readSync;
    let bytesRead = 0;
    fs.readSync = function trackedReadSync(fd, buffer, offset, length, position) {
      const result = originalReadSync.call(this, fd, buffer, offset, length, position);
      bytesRead += typeof result === 'number' ? result : 0;
      return result;
    };
    try {
      const m = getSessionUsageMetrics(p, { statePath: state });
      assert.equal(m.credits, 3);
      assert.equal(m.creditCallCount, 1);
    } finally {
      fs.readSync = originalReadSync;
    }

    // The head/checkpoint validation reads at most 8KiB, then only the newly
    // appended line. A full rescan of the 650KiB prefix would exceed this.
    assert.ok(bytesRead < 32 * 1024, `unexpected full rescan: ${bytesRead} bytes`);
  });

  it('rebuilds from scratch when state is corrupt or transcript is truncated', () => {
    const p = writeTmp('session-rebuild.jsonl', call('a', 2) + '\n');
    const state = path.join(tmpDir, 'session-rebuild-state.json');
    assert.equal(getSessionUsageMetrics(p, { statePath: state }).credits, 2);
    fs.writeFileSync(state, '{not json');
    assert.equal(getSessionUsageMetrics(p, { statePath: state }).credits, 2);
    fs.writeFileSync(p, call('new', 3) + '\n');
    assert.equal(getSessionUsageMetrics(p, { statePath: state }).credits, 3);
  });

  it('returns null when no valid credit telemetry exists', () => {
    const p = writeTmp('session-no-credit.jsonl', JSON.stringify({ providerData: { rawUsage: { prompt_tokens: 1 } } }) + '\n');
    const m = getSessionUsageMetrics(p, { statePath: path.join(tmpDir, 'session-no-credit-state.json') });
    assert.equal(m.credits, null);
    assert.equal(m.creditCallCount, 0);
  });

  it('does not commit an incomplete trailing JSONL line', () => {
    const p = writeTmp('session-partial.jsonl', call('a', 1) + '\n' + call('b', 2).slice(0, -3));
    const state = path.join(tmpDir, 'session-partial-state.json');
    let m = getSessionUsageMetrics(p, { statePath: state });
    assert.equal(m.credits, 1);
    assert.ok(m.offset < fs.statSync(p).size);

    fs.appendFileSync(p, call('b', 2).slice(-3) + '\n');
    m = getSessionUsageMetrics(p, { statePath: state });
    assert.equal(m.credits, 3);
    assert.equal(m.creditCallCount, 2);
  });

  it('detects an in-place transcript rewrite even when the path remains the same', () => {
    const p = writeTmp('session-rewrite.jsonl', call('a', 1) + '\n' + call('b', 2) + '\n');
    const state = path.join(tmpDir, 'session-rewrite-state.json');
    assert.equal(getSessionUsageMetrics(p, { statePath: state }).credits, 3);

    // Keep the file path and shape but replace its contents with a new
    // transcript. The head/checkpoint fingerprint must invalidate the old sum.
    fs.writeFileSync(p, call('x', 9) + '\n' + call('y', 8) + '\n');
    const m = getSessionUsageMetrics(p, { statePath: state });
    assert.equal(m.credits, 17);
    assert.equal(m.creditCallCount, 2);
  });

  it('detects a same-size rewrite in the middle of a large transcript', () => {
    const paddedCall = (id, credit) => JSON.stringify({
      type: 'function_call', callId: id, name: 'Bash',
      // Keep the changed credit near the beginning while leaving the final
      // checkpoint window unchanged. mtime/ctime identity must invalidate the
      // cached total even though path, inode and size remain stable.
      providerData: { rawUsage: { credit }, padding: 'x'.repeat(12000) },
    });
    const p = writeTmp('session-large-rewrite.jsonl', paddedCall('a', 1) + '\n' + paddedCall('b', 2) + '\n');
    const state = path.join(tmpDir, 'session-large-rewrite-state.json');
    assert.equal(getSessionUsageMetrics(p, { statePath: state }).credits, 3);

    const replacement = Buffer.from(paddedCall('b', 9) + '\n');
    const original = fs.readFileSync(p, 'utf8');
    const secondStart = original.indexOf(paddedCall('b', 2));
    assert.ok(secondStart > 4096);
    const fd = fs.openSync(p, 'r+');
    try {
      fs.writeSync(fd, replacement, 0, replacement.length, secondStart);
    } finally {
      fs.closeSync(fd);
    }
    assert.equal(fs.statSync(p).size, original.length);
    assert.equal(getSessionUsageMetrics(p, { statePath: state }).credits, 10);
  });

  it('keeps working when the usage state cannot be written', () => {
    const p = writeTmp('session-state-readonly.jsonl', call('a', 2) + '\n');
    // An invalid path is not writable, so persistence fails while the current
    // invocation still returns the computed total.
    const m = getSessionUsageMetrics(p, { statePath: path.join(tmpDir, 'bad\0state') });
    assert.equal(m.credits, 2);
    assert.equal(m.creditCallCount, 1);
  });

  it('scans a 20MB transcript without requiring a full-size buffer', () => {
    const filler = JSON.stringify({ message: 'x'.repeat(8192) }) + '\n';
    const parts = [];
    let bytes = 0;
    while (bytes < 20 * 1024 * 1024) {
      parts.push(filler);
      bytes += Buffer.byteLength(filler);
    }
    parts.push(call('final', 7) + '\n');
    const p = writeTmp('session-20mb.jsonl', parts.join(''));
    const state = path.join(tmpDir, 'session-20mb-state.json');
    const start = process.hrtime.bigint();
    const m = getSessionUsageMetrics(p, { statePath: state });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    assert.equal(m.credits, 7);
    assert.equal(m.creditCallCount, 1);
    assert.ok(elapsedMs < 1500, `took ${elapsedMs}ms`);
  });

  it('handles one 20MB JSONL line without quadratic chunk copying', () => {
    const p = writeTmp('session-20mb-single-line.jsonl', JSON.stringify({
      providerData: { rawUsage: { credit: 8 } },
      padding: 'x'.repeat(20 * 1024 * 1024),
    }));
    const state = path.join(tmpDir, 'session-20mb-single-line-state.json');
    const start = process.hrtime.bigint();
    const m = getSessionUsageMetrics(p, { statePath: state });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    assert.equal(m.credits, 8);
    assert.equal(m.creditCallCount, 1);
    assert.ok(elapsedMs < 1500, `took ${elapsedMs}ms`);
  });

  it('uses independent default state files for different transcript paths', () => {
    const p1 = writeTmp('session-isolated-a.jsonl', call('a', 1) + '\n');
    const p2 = writeTmp('session-isolated-b.jsonl', call('b', 4) + '\n');
    assert.notEqual(getTranscriptUsageStatePath(p1), getTranscriptUsageStatePath(p2));
    assert.equal(getSessionUsageMetrics(p1).credits, 1);
    assert.equal(getSessionUsageMetrics(p2).credits, 4);
  });
});

describe('getTurnToolActivity — per-turn aggregation', () => {
  it('returns null for missing or empty transcript', () => {
    assert.equal(getTurnToolActivity(null), null);
    assert.equal(getTurnToolActivity(''), null);
    assert.equal(getTurnToolActivity(path.join(tmpDir, 'nonexistent-tool.jsonl')), null);
  });

  it('aggregates active tool and completed tools in current turn', () => {
    const p = writeTmp('turn-tools-active-comp.jsonl', [
      cbLine({ type: 'message', role: 'user', content: 'hello' }),
      cbCall('c1', 'Read', { file_path: '/src/a.ts' }),
      cbResult('c1', 'Read'),
      cbCall('c2', 'Read', { file_path: '/src/b.ts' }),
      cbResult('c2', 'Read'),
      cbCall('c3', 'Grep', { pattern: 'test' }),
      cbResult('c3', 'Grep'),
      cbCall('c4', 'Edit', { file_path: '/src/c.ts' }),
    ].join('\n'));

    const res = getTurnToolActivity(p);
    assert.ok(res);
    assert.deepEqual(res.active, { tool: 'Edit', detail: 'c.ts' });
    assert.deepEqual(res.completed, [
      { tool: 'Read', count: 2 },
      { tool: 'Grep', count: 1 },
    ]);
    assert.equal(res.totalCompleted, 3);
  });

  it('stops collecting at user turn boundary', () => {
    const p = writeTmp('turn-tools-boundary.jsonl', [
      cbLine({ type: 'message', role: 'user', content: 'turn 1' }),
      cbCall('old-1', 'Bash', { command: 'ls' }),
      cbResult('old-1', 'Bash'),
      cbLine({ type: 'message', role: 'user', content: 'turn 2' }),
      cbCall('new-1', 'Read', { file_path: '/src/new.ts' }),
      cbResult('new-1', 'Read'),
    ].join('\n'));

    const res = getTurnToolActivity(p);
    assert.ok(res);
    assert.equal(res.active, null);
    assert.deepEqual(res.completed, [{ tool: 'Read', count: 1 }]);
    assert.equal(res.totalCompleted, 1);
  });

  it('sorts completed tools descending by count', () => {
    const p = writeTmp('turn-tools-sort.jsonl', [
      cbCall('c1', 'Grep', { pattern: '1' }),
      cbResult('c1', 'Grep'),
      cbCall('c2', 'Read', { file_path: 'a' }),
      cbResult('c2', 'Read'),
      cbCall('c3', 'Read', { file_path: 'b' }),
      cbResult('c3', 'Read'),
      cbCall('c4', 'Read', { file_path: 'c' }),
      cbResult('c4', 'Read'),
    ].join('\n'));

    const res = getTurnToolActivity(p);
    assert.ok(res);
    assert.equal(res.completed[0].tool, 'Read');
    assert.equal(res.completed[0].count, 3);
    assert.equal(res.completed[1].tool, 'Grep');
    assert.equal(res.completed[1].count, 1);
  });
});

