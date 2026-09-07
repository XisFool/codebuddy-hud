import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseCodeBuddyInput, extractTokenData, extractDiffStats, extractCostData } = require('../../runtime/parser.js');

describe('parseCodeBuddyInput', () => {
  it('parses valid JSON', () => {
    const result = parseCodeBuddyInput('{"model":{"id":"gpt-5.5"}}');
    assert.deepEqual(result, { model: { id: 'gpt-5.5' } });
  });

  it('returns null for empty string', () => {
    assert.equal(parseCodeBuddyInput(''), null);
    assert.equal(parseCodeBuddyInput('   '), null);
  });

  it('returns null for malformed JSON', () => {
    assert.equal(parseCodeBuddyInput('{invalid}'), null);
  });

  it('returns null for non-object JSON', () => {
    assert.equal(parseCodeBuddyInput('"string"'), null);
    assert.equal(parseCodeBuddyInput('42'), null);
  });

  it('returns null for null/undefined input', () => {
    assert.equal(parseCodeBuddyInput(null), null);
    assert.equal(parseCodeBuddyInput(undefined), null);
  });
});

describe('extractTokenData', () => {
  it('extracts token data from full payload', () => {
    const data = {
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
    const result = extractTokenData(data);
    assert.equal(result.inTokens, 91000);
    assert.equal(result.outTokens, 700);
    assert.equal(result.cacheRead, 5800000);
    assert.equal(result.ctxSize, 1000000);
    assert.equal(result.ctxPercent, 9.17);
  });

  it('returns null when context_window is missing', () => {
    assert.equal(extractTokenData({}), null);
    assert.equal(extractTokenData(null), null);
  });

  it('handles missing current_usage gracefully', () => {
    const data = { context_window: { context_window_size: 1000000, used_percentage: 5 } };
    const result = extractTokenData(data);
    assert.equal(result.inTokens, 0);
    assert.equal(result.ctxSize, 1000000);
  });
});

describe('extractDiffStats', () => {
  it('extracts lines added/removed', () => {
    const data = { cost: { total_lines_added: 168, total_lines_removed: 1 } };
    const result = extractDiffStats(data);
    assert.equal(result.linesAdded, 168);
    assert.equal(result.linesRemoved, 1);
  });

  it('defaults to zero when cost is missing', () => {
    const result = extractDiffStats({});
    assert.equal(result.linesAdded, 0);
    assert.equal(result.linesRemoved, 0);
  });
});

describe('extractCostData', () => {
  it('extracts cost and duration', () => {
    const data = { cost: { total_cost_usd: 0.5, total_duration_ms: 769524, total_api_duration_ms: 600596 } };
    const result = extractCostData(data);
    assert.equal(result.totalCostUsd, 0.5);
    assert.equal(result.totalDurationMs, 769524);
  });

  it('returns null when cost is missing', () => {
    assert.equal(extractCostData({}), null);
  });
});
