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
  it('anchors a fresh identity at the current cost and shows increments after', () => {
    // Identity miss (first frame on a new transcript) = new session: Δ/⏱ start at zero.
    assert.deepEqual(sessionCost(payload(), cost()), cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
    assert.deepEqual(sessionCost(payload({ totalInput: 110000, currentInput: 98000 }), cost({ added: 1710, totalMs: 10030000 })),
      cost({ added: 10, removed: 0, totalMs: 10000, apiMs: 0 }));
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

  it('anchors at zero when the state file is corrupt or cannot persist', () => {
    const statePath = path.join(tmpDir, 'state.json');
    fs.writeFileSync(statePath, '{not-json');
    assert.deepEqual(getLogicalSessionCostData(payload(), cost(), { statePath }),
      cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
    // Unwritable state path: every frame misses, so the frame stays anchored at
    // its own cost — a permanent Δ=0 (previously it degraded to full host totals).
    assert.deepEqual(getLogicalSessionCostData(payload(), cost(), { statePath: path.join(tmpDir, 'bad\0state') }),
      cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
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

  it('shows new-process totals when cost counters drop on an identity hit', () => {
    const statePath = path.join(tmpDir, 'state-hit-drop.json');
    const input = payload();
    assert.deepEqual(
      getLogicalSessionCostData(input, cost({ added: 500, removed: 50, totalMs: 200000, apiMs: 90000 }), { statePath }),
      cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 })
    );
    // Host restarted: cumulative counters fall while the identity stays — the
    // new lower totals are the new process's truth and remain visible.
    assert.deepEqual(
      getLogicalSessionCostData(input, cost({ added: 7, removed: 1, totalMs: 9000, apiMs: 2000 }), { statePath }),
      cost({ added: 7, removed: 1, totalMs: 9000, apiMs: 2000 })
    );
  });

  it('explicit regression: identity hit with truncation or session change anchors at cost', () => {
    const transcript = path.join(tmpDir, 'hit-reset.jsonl');
    fs.writeFileSync(transcript, 'x'.repeat(2000));
    const statePath = path.join(tmpDir, 'state-hit-reset.json');
    const big = cost({ added: 300, removed: 20, totalMs: 150000, apiMs: 70000 });
    assert.deepEqual(
      getLogicalSessionCostData({ ...payload(), transcript_path: transcript }, big, { statePath }),
      cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 })
    );
    // /clear physically truncates the same transcript on an identity hit
    fs.writeFileSync(transcript, 'x'.repeat(100));
    assert.deepEqual(
      getLogicalSessionCostData({ ...payload(), transcript_path: transcript }, big, { statePath }),
      cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 })
    );
    // Growth after the reset is measured from the re-anchored baseline
    assert.deepEqual(
      getLogicalSessionCostData({ ...payload(), transcript_path: transcript },
        cost({ added: 310, removed: 22, totalMs: 153000, apiMs: 71000 }), { statePath }),
      cost({ added: 10, removed: 2, totalMs: 3000, apiMs: 1000 })
    );
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
    assert.deepEqual(continued, cost({ added: 20, removed: 5, totalMs: 0, apiMs: 0 }));
  });

  it('handles long initial prompt without baseline confusion: 3800 tokens first turn', () => {
    const transcript = path.join(tmpDir, 'long-init.jsonl');
    fs.writeFileSync(transcript, '');
    const p = { ...payload({ currentInput: 3800 }), transcript_path: transcript };

    const first = sessionCost(p, cost({ added: 12, removed: 0 }));
    assert.deepEqual(first, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
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

describe('/clear with a fresh transcript file (identity miss = new session)', () => {
  let tmpDir;
  let cwd;
  let oldTranscript;
  let newTranscript;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-session-swap-'));
    cwd = path.join(tmpDir, 'proj');
    fs.mkdirSync(cwd);
    oldTranscript = path.join(tmpDir, 'old.jsonl');
    newTranscript = path.join(tmpDir, 'new.jsonl');
    fs.writeFileSync(oldTranscript, 'x'.repeat(1200));
    fs.writeFileSync(newTranscript, '');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function turn({ transcript, sessionId, totalInput, currentInput, cost: costArgs, statePath }) {
    return getLogicalSessionCostData({
      session_id: sessionId,
      transcript_path: transcript,
      context_window: {
        total_input_tokens: totalInput,
        current_usage: { input_tokens: currentInput },
      },
    }, cost(costArgs), { statePath, cwd });
  }

  it('P1: /clear swapping to a fresh transcript restarts Δ/⏱ at zero without shared state', () => {
    const statePath = path.join(tmpDir, 'state.json');
    turn({
      transcript: oldTranscript, sessionId: 's1', totalInput: 10483815, currentInput: 160902,
      cost: { added: 157, removed: 1, totalMs: 3178000, apiMs: 1500000 }, statePath,
    });

    // /clear: brand-new transcript file, same cwd, host cost fields preserved
    const postClear = turn({
      transcript: newTranscript, sessionId: 's2', totalInput: 0, currentInput: 0,
      cost: { added: 157, removed: 1, totalMs: 3178000, apiMs: 1500000 }, statePath,
    });
    assert.deepEqual(postClear, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));

    // New conversation work grows from zero
    const grown = turn({
      transcript: newTranscript, sessionId: 's2', totalInput: 5000, currentInput: 4000,
      cost: { added: 170, removed: 2, totalMs: 3200000, apiMs: 1511000 }, statePath,
    });
    assert.deepEqual(grown, cost({ added: 13, removed: 1, totalMs: 22000, apiMs: 11000 }));
  });

  it('P2: two windows with isolated statePath anchor independently and never leak to each other', () => {
    const statePathA = path.join(tmpDir, 'window-a.json');
    const statePathB = path.join(tmpDir, 'window-b.json');

    // Window A accumulates a large session
    turn({
      transcript: oldTranscript, sessionId: 'wA', totalInput: 100000, currentInput: 90000,
      cost: { added: 500, removed: 40, totalMs: 2000000, apiMs: 900000 }, statePath: statePathA,
    });

    // Window B (same cwd) starts fresh: anchored at its own small cost
    const freshB = turn({
      transcript: newTranscript, sessionId: 'wB', totalInput: 1000, currentInput: 1000,
      cost: { added: 3, removed: 0, totalMs: 5000, apiMs: 1200 }, statePath: statePathB,
    });
    assert.deepEqual(freshB, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));

    // Window A /clear: anchored at its own cumulative, never at window B's values
    const postClearA = turn({
      transcript: newTranscript, sessionId: 'wA2', totalInput: 0, currentInput: 0,
      cost: { added: 510, removed: 41, totalMs: 2010000, apiMs: 902000 }, statePath: statePathA,
    });
    assert.deepEqual(postClearA, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));

    // Window B keeps growing from its own anchor, unaffected by window A
    const grownB = turn({
      transcript: newTranscript, sessionId: 'wB', totalInput: 2000, currentInput: 1500,
      cost: { added: 10, removed: 2, totalMs: 25000, apiMs: 6200 }, statePath: statePathB,
    });
    assert.deepEqual(grownB, cost({ added: 7, removed: 2, totalMs: 20000, apiMs: 5000 }));
  });

  it('S6: host restart with lower counters anchors at the low values (Δ=0)', () => {
    const statePath = path.join(tmpDir, 'state-restart.json');
    turn({
      transcript: oldTranscript, sessionId: 's1', totalInput: 100000, currentInput: 90000,
      cost: { added: 157, removed: 1, totalMs: 3178000, apiMs: 1500000 }, statePath,
    });

    const fresh = turn({
      transcript: newTranscript, sessionId: 's2', totalInput: 3000, currentInput: 3000,
      cost: { added: 2, removed: 0, totalMs: 5000, apiMs: 1200 }, statePath,
    });
    assert.deepEqual(fresh, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
  });

  it('S7: windows in different cwds anchor independently (no cross-cwd inheritance)', () => {
    const cwdOne = path.join(tmpDir, 'proj-one');
    const cwdTwo = path.join(tmpDir, 'proj-two');
    fs.mkdirSync(cwdOne);
    fs.mkdirSync(cwdTwo);

    // cwd one accumulates, then clears → anchored at its own cumulative
    turn({
      transcript: oldTranscript, sessionId: 'one-a', totalInput: 100000, currentInput: 90000,
      cost: { added: 200, removed: 30, totalMs: 900000, apiMs: 400000 }, statePath: path.join(tmpDir, 'one.json'),
    });
    const clearedOne = turn({
      transcript: newTranscript, sessionId: 'one-b', totalInput: 0, currentInput: 0,
      cost: { added: 210, removed: 32, totalMs: 910000, apiMs: 405000 }, statePath: path.join(tmpDir, 'one.json'),
    });
    assert.deepEqual(clearedOne, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));

    // cwd two never sees cwd one's values
    const freshTwo = turn({
      transcript: newTranscript, sessionId: 'two-a', totalInput: 500, currentInput: 400,
      cost: { added: 4, removed: 1, totalMs: 7000, apiMs: 2100 }, statePath: path.join(tmpDir, 'two.json'),
    });
    assert.deepEqual(freshTwo, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
  });

  it('S8: first frame with no prior state anchors at cost (Δ=0)', () => {
    const first = turn({
      transcript: oldTranscript, sessionId: 's1', totalInput: 100000, currentInput: 90000,
      cost: { added: 157, removed: 1, totalMs: 3178000, apiMs: 1500000 },
      statePath: path.join(tmpDir, 'state-fresh.json'),
    });
    assert.deepEqual(first, cost({ added: 0, removed: 0, totalMs: 0, apiMs: 0 }));
  });
});

describe('Windows path case normalization', () => {
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
});
