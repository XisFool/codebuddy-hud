import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getLogicalSessionCostData } = require('../../runtime/session-stats.js');
const { getSessionStatsHandoffPath } = require('../../runtime/paths.js');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-session-stats-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function payload({ sessionId = 'session-a', totalInput = 100000, currentInput = 90000 } = {}) {
  return {
    session_id: sessionId,
    transcript_path: path.join(tmpDir, 'session.jsonl'),
    context_window: {
      total_input_tokens: totalInput,
      current_usage: { input_tokens: currentInput },
    },
  };
}

function cost({ added = 1700, removed = 161, totalMs = 10020000, apiMs = 4980000 } = {}) {
  return {
    linesAdded: added,
    linesRemoved: removed,
    totalDurationMs: totalMs,
    apiDurationMs: apiMs,
  };
}

function sessionCost(input, costData) {
  return getLogicalSessionCostData(input, costData, {
    statePath: path.join(tmpDir, 'state.json'),
  });
}

describe('getLogicalSessionCostData', () => {
  it('keeps host totals until a clear boundary is observed', () => {
    assert.deepEqual(sessionCost(payload(), cost()), cost());
    assert.deepEqual(sessionCost(payload({ totalInput: 110000, currentInput: 98000 }), cost({ added: 1710, totalMs: 10030000 })),
      cost({ added: 1710, totalMs: 10030000 }));
  });

  it('resets diff and duration after /clear reuses the transcript and host totals', () => {
    sessionCost(payload(), cost());

    const cleared = sessionCost(payload({ totalInput: 0, currentInput: 0 }), cost());
    assert.deepEqual(cleared, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));

    const nextTurn = sessionCost(payload({ totalInput: 900, currentInput: 900 }), cost({
      added: 12,
      removed: 3,
      totalMs: 25000,
      apiMs: 9000,
    }));
    assert.deepEqual(nextTurn, cost({ added: 12, removed: 3, totalMs: 25000, apiMs: 9000 }));
  });

  it('uses a near-zero current context as a fallback clear signal', () => {
    sessionCost(payload({ totalInput: 100000, currentInput: 90000 }), cost());
    const cleared = sessionCost(payload({ totalInput: 101000, currentInput: 10 }), cost());
    assert.deepEqual(cleared, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
  });

  it('resets when the host assigns a new session id to the same transcript', () => {
    sessionCost(payload({ sessionId: 'session-a' }), cost());
    const reset = sessionCost(payload({ sessionId: 'session-b', totalInput: 100100, currentInput: 90100 }), cost());
    assert.deepEqual(reset, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
  });

  it('rebuilds after a corrupt state file and degrades when it cannot persist', () => {
    const statePath = path.join(tmpDir, 'state.json');
    fs.writeFileSync(statePath, '{not-json');
    assert.deepEqual(getLogicalSessionCostData(payload(), cost(), { statePath }), cost());
    assert.deepEqual(getLogicalSessionCostData(payload(), cost(), { statePath: path.join(tmpDir, 'bad\0state') }), cost());
  });

  it('returns unmodified data when no stable session identity is available', () => {
    const input = { context_window: { total_input_tokens: 100000, current_usage: { input_tokens: 90000 } } };
    assert.deepEqual(getLogicalSessionCostData(input, cost(), { statePath: path.join(tmpDir, 'state.json') }), cost());
  });

  it('does not rewrite state file when data is unchanged (dirty-driven)', () => {
    const statePath = path.join(tmpDir, 'state.json');
    sessionCost(payload(), cost());
    const initialMtime = fs.statSync(statePath).mtimeMs;

    // Second call with identical payload and cost should not touch disk
    sessionCost(payload(), cost());
    const secondMtime = fs.statSync(statePath).mtimeMs;
    assert.equal(secondMtime, initialMtime);
  });
});

describe('adaptive /clear detection (context reset)', () => {
  function sessionCost(p, c) {
    const statePath = path.join(tmpDir, 'state.json');
    return getLogicalSessionCostData(p, c, { statePath });
  }

  it('detects cliff drop: 25000 -> 3500 tokens (86% relative + 21.5k absolute)', () => {
    const transcript = path.join(tmpDir, 'cliff.jsonl');
    fs.writeFileSync(transcript, '');
    const p = { ...payload({ currentInput: 25000 }), transcript_path: transcript };
    sessionCost(p, cost({ added: 370, removed: 103 }));

    const cleared = sessionCost({ ...payload({ currentInput: 3500 }), transcript_path: transcript }, cost({ added: 370, removed: 103 }));
    assert.deepEqual(cleared, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
  });

  it('detects mid-session clear: 7500 -> 2500 tokens', () => {
    const transcript = path.join(tmpDir, 'mid.jsonl');
    fs.writeFileSync(transcript, '');
    const p = { ...payload({ currentInput: 7500 }), transcript_path: transcript };
    sessionCost(p, cost({ added: 200, removed: 50 }));

    const cleared = sessionCost({ ...payload({ currentInput: 2500 }), transcript_path: transcript }, cost({ added: 200, removed: 50 }));
    assert.deepEqual(cleared, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
  });

  it('does NOT reset on normal fluctuation: 5200 -> 4800 tokens', () => {
    const transcript = path.join(tmpDir, 'fluctuate.jsonl');
    fs.writeFileSync(transcript, '');
    const p = { ...payload({ currentInput: 5200 }), transcript_path: transcript };
    sessionCost(p, cost({ added: 150, removed: 20 }));

    const continued = sessionCost({ ...payload({ currentInput: 4800 }), transcript_path: transcript }, cost({ added: 170, removed: 25 }));
    assert.deepEqual(continued, cost({ added: 170, removed: 25 }));
  });

  it('handles long initial prompt without baseline confusion: 3800 tokens first turn', () => {
    const transcript = path.join(tmpDir, 'long-init.jsonl');
    fs.writeFileSync(transcript, '');
    const p = { ...payload({ currentInput: 3800 }), transcript_path: transcript };

    const first = sessionCost(p, cost({ added: 12, removed: 0 }));
    assert.deepEqual(first, cost({ added: 12, removed: 0 }));
  });

  it('detects transcript physical truncation (hard signal)', () => {
    const transcript = path.join(tmpDir, 'truncate.jsonl');
    fs.writeFileSync(transcript, 'x'.repeat(10000)); // 10KB
    const p = { ...payload({ currentInput: 5000 }), transcript_path: transcript };

    sessionCost(p, cost({ added: 100, removed: 20 }));

    // Simulate /clear truncating the file
    fs.writeFileSync(transcript, 'x'.repeat(500)); // 500B
    const cleared = sessionCost(p, cost({ added: 100, removed: 20 }));
    assert.deepEqual(cleared, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
  });

  it('respects explicit clear_signal flag (forward compatibility)', () => {
    const transcript = path.join(tmpDir, 'explicit.jsonl');
    fs.writeFileSync(transcript, '');
    const p = { ...payload({ currentInput: 5000 }), transcript_path: transcript };

    sessionCost(p, cost({ added: 100, removed: 30 }));
    const cleared = sessionCost({ ...p, clear_signal: true }, cost({ added: 100, removed: 30 }));
    assert.deepEqual(cleared, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
  });

  it('respects is_clear flag (forward compatibility)', () => {
    const transcript = path.join(tmpDir, 'is-clear.jsonl');
    fs.writeFileSync(transcript, '');
    const p = { ...payload({ currentInput: 5000 }), transcript_path: transcript };

    sessionCost(p, cost({ added: 80, removed: 10 }));
    const cleared = sessionCost({ ...p, is_clear: true }, cost({ added: 80, removed: 10 }));
    assert.deepEqual(cleared, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
  });
});

describe('/clear with a fresh transcript file (identity swap)', () => {
  let tmpDir;
  let cwd;
  let oldTranscript;
  let newTranscript;
  let statePath;
  let handoffPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-session-swap-'));
    cwd = path.join(tmpDir, 'proj');
    fs.mkdirSync(cwd);
    oldTranscript = path.join(tmpDir, 'old.jsonl');
    newTranscript = path.join(tmpDir, 'new.jsonl');
    fs.writeFileSync(oldTranscript, 'x'.repeat(1200));
    fs.writeFileSync(newTranscript, '');
    statePath = path.join(tmpDir, 'state.json');
    handoffPath = path.join(tmpDir, 'handoff.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function turn({ transcript, sessionId, totalInput, currentInput, cost: costArgs }) {
    return getLogicalSessionCostData({
      session_id: sessionId,
      transcript_path: transcript,
      context_window: {
        total_input_tokens: totalInput,
        current_usage: { input_tokens: currentInput },
      },
    }, cost(costArgs), { statePath, handoffPath, cwd });
  }

  it('resets Δ/⏱ when /clear swaps to a new transcript while host cost keeps accumulating', () => {
    const preClear = turn({
      transcript: oldTranscript, sessionId: 's1', totalInput: 10483815, currentInput: 160902,
      cost: { added: 157, removed: 1, totalMs: 3178000, apiMs: 1500000 },
    });
    assert.deepEqual(preClear, cost({ added: 157, removed: 1, totalMs: 3178000, apiMs: 1500000 }));

    // /clear: brand-new transcript file, same cwd, host cost fields preserved
    const postClear = turn({
      transcript: newTranscript, sessionId: 's2', totalInput: 0, currentInput: 0,
      cost: { added: 157, removed: 1, totalMs: 3178000, apiMs: 1500000 },
    });
    assert.deepEqual(postClear, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));

    // New conversation work grows from zero
    const grown = turn({
      transcript: newTranscript, sessionId: 's2', totalInput: 5000, currentInput: 4000,
      cost: { added: 170, removed: 2, totalMs: 3200000, apiMs: 1511000 },
    });
    assert.deepEqual(grown, cost({ added: 13, removed: 1, totalMs: 22000, apiMs: 11000 }));
  });

  it('does not inherit when the host process restarted (cost counters dropped)', () => {
    turn({
      transcript: oldTranscript, sessionId: 's1', totalInput: 100000, currentInput: 90000,
      cost: { added: 157, removed: 1, totalMs: 3178000, apiMs: 1500000 },
    });

    const fresh = turn({
      transcript: newTranscript, sessionId: 's2', totalInput: 3000, currentInput: 3000,
      cost: { added: 2, removed: 0, totalMs: 5000, apiMs: 1200 },
    });
    assert.deepEqual(fresh, cost({ added: 2, removed: 0, totalMs: 5000, apiMs: 1200 }));
  });

  it('does not inherit across a different cwd', () => {
    turn({
      transcript: oldTranscript, sessionId: 's1', totalInput: 100000, currentInput: 90000,
      cost: { added: 157, removed: 1, totalMs: 3178000, apiMs: 1500000 },
    });

    const other = getLogicalSessionCostData({
      session_id: 's2',
      transcript_path: newTranscript,
      context_window: { total_input_tokens: 0, current_usage: { input_tokens: 0 } },
    }, cost(), { statePath, handoffPath, cwd: path.join(tmpDir, 'other-proj') });
    assert.deepEqual(other, cost());
  });

  it('behaves as before when no handoff record exists', () => {
    const first = turn({
      transcript: oldTranscript, sessionId: 's1', totalInput: 100000, currentInput: 90000,
      cost: { added: 157, removed: 1, totalMs: 3178000, apiMs: 1500000 },
    });
    assert.deepEqual(first, cost({ added: 157, removed: 1, totalMs: 3178000, apiMs: 1500000 }));
  });
});

describe('Windows path case normalization & TTL safety', () => {
  let tmpDir;
  let oldTranscript;
  let newTranscript;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-norm-'));
    oldTranscript = path.join(tmpDir, 'old.jsonl');
    newTranscript = path.join(tmpDir, 'new.jsonl');
    fs.writeFileSync(oldTranscript, 'x'.repeat(100));
    fs.writeFileSync(newTranscript, '');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  (process.platform === 'win32' ? it : it.skip)('inherits baseline across Windows drive letter case differences (d: vs D:)', () => {
    const cwdLower = 'd:\\test_repo';
    const cwdUpper = 'D:\\test_repo';
    const handoffPathLower = getSessionStatsHandoffPath(cwdLower);
    const handoffPathUpper = getSessionStatsHandoffPath(cwdUpper);

    // Verify both casing variants resolve to the exact same handoff path on Windows
    assert.equal(handoffPathLower, handoffPathUpper);

    // Pre-clear turn in d:\test_repo
    getLogicalSessionCostData({
      session_id: 's1',
      transcript_path: oldTranscript,
      context_window: { total_input_tokens: 50000, current_usage: { input_tokens: 40000 } },
    }, cost({ added: 150, removed: 20, totalMs: 50000, apiMs: 20000 }), {
      statePath: path.join(tmpDir, 'state-old.json'),
      handoffPath: handoffPathLower,
      cwd: cwdLower,
    });

    // /clear switches to new transcript in D:\test_repo with host cumulative cost unchanged
    const postClear = getLogicalSessionCostData({
      session_id: 's2',
      transcript_path: newTranscript,
      context_window: { total_input_tokens: 0, current_usage: { input_tokens: 0 } },
    }, cost({ added: 150, removed: 20, totalMs: 50000, apiMs: 20000 }), {
      statePath: path.join(tmpDir, 'state-new.json'),
      handoffPath: handoffPathUpper,
      cwd: cwdUpper,
    });

    // Verify handoff baseline was successfully inherited (Δ and ⏱ reset to 0)
    assert.deepEqual(postClear, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));

    // Clean up created handoff file
    try { fs.unlinkSync(handoffPathLower); } catch { /* ignore */ }
  });

  it('rejects handoff baseline if older than 5 minutes TTL', () => {
    const cwd = path.join(tmpDir, 'proj');
    const handoffPath = path.join(tmpDir, 'handoff.json');

    // Hand-craft a handoff state from 10 minutes ago
    fs.writeFileSync(handoffPath, JSON.stringify({
      version: 1,
      cost: { linesAdded: 200, linesRemoved: 50, totalDurationMs: 60000, apiDurationMs: 30000 },
      cwd,
      updatedAt: Date.now() - (10 * 60 * 1000), // 10 minutes ago
    }));

    // New session starts
    const res = getLogicalSessionCostData({
      session_id: 's-new',
      transcript_path: newTranscript,
      context_window: { total_input_tokens: 1000, current_usage: { input_tokens: 1000 } },
    }, cost({ added: 200, removed: 50, totalMs: 60000, apiMs: 30000 }), {
      statePath: path.join(tmpDir, 'state-new.json'),
      handoffPath,
      cwd,
    });

    // Expired handoff baseline must NOT be inherited
    assert.deepEqual(res, cost({ added: 200, removed: 50, totalMs: 60000, apiMs: 30000 }));
  });

  it('does not inherit when host cost dropped (host process restarted)', () => {
    const cwd = path.join(tmpDir, 'proj');
    const handoffPath = path.join(tmpDir, 'handoff.json');

    // Fresh handoff from 5 seconds ago with higher cost
    fs.writeFileSync(handoffPath, JSON.stringify({
      version: 1,
      cost: { linesAdded: 500, linesRemoved: 100, totalDurationMs: 100000, apiDurationMs: 50000 },
      cwd,
      updatedAt: Date.now() - 5000,
    }));

    // Host restarted, reporting lower cost
    const res = getLogicalSessionCostData({
      session_id: 's-restart',
      transcript_path: newTranscript,
      context_window: { total_input_tokens: 500, current_usage: { input_tokens: 500 } },
    }, cost({ added: 10, removed: 2, totalMs: 3000, apiMs: 1000 }), {
      statePath: path.join(tmpDir, 'state-new.json'),
      handoffPath,
      cwd,
    });

    // Must NOT inherit baseline from dead process
    assert.deepEqual(res, cost({ added: 10, removed: 2, totalMs: 3000, apiMs: 1000 }));
  });
});
