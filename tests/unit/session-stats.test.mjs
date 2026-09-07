import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getLogicalSessionCostData } = require('../../runtime/session-stats.js');

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
