import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { renderDiffSegment, formatCreditSpend } = require('../../runtime/renderer/diff-render.js');

const glyphs = { diffIcon: '[D] ', costIcon: '[$] ', clockIcon: '[t] ', vbar: '|' };

describe('renderDiffSegment', () => {
  it('renders +N -M with colors', () => {
    const diff = { linesAdded: 168, linesRemoved: 1 };
    const result = renderDiffSegment(diff, null, {}, glyphs);
    assert.ok(result.includes('+168'));
    assert.ok(result.includes('-1'));
    assert.ok(result.includes('[D]'));
    assert.ok(result.includes('\x1b[32m')); // green for additions
    assert.ok(result.includes('\x1b[31m')); // red for removals
  });

  it('returns empty when both are zero', () => {
    const diff = { linesAdded: 0, linesRemoved: 0 };
    assert.equal(renderDiffSegment(diff, null, {}, glyphs), '');
  });

  it('renders only additions', () => {
    const diff = { linesAdded: 50, linesRemoved: 0 };
    const result = renderDiffSegment(diff, null, {}, glyphs);
    assert.ok(result.includes('+50'));
    assert.ok(!result.includes('-'));
  });

  it('uses the supplied Unicode delta icon for a diff summary', () => {
    const unicodeGlyphs = { ...glyphs, diffIcon: '\u0394 ' };
    const result = renderDiffSegment({ linesAdded: 50, linesRemoved: 1 }, null, {}, unicodeGlyphs);
    const plain = result.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('\u0394 +50 -1'));
  });

  it('includes cost when available', () => {
    const diff = { linesAdded: 10, linesRemoved: 0 };
    const cost = { totalCostUsd: 0.5, totalDurationMs: 0, apiDurationMs: 0 };
    const result = renderDiffSegment(diff, cost, {}, glyphs);
    assert.ok(result.includes('$0.50'));
  });

  it('includes duration when available without API duration', () => {
    const diff = { linesAdded: 0, linesRemoved: 0 };
    const cost = { totalCostUsd: 0, totalDurationMs: 769524, apiDurationMs: 600596 };
    const result = renderDiffSegment(diff, cost, {}, glyphs);
    assert.ok(result.includes('12m49s'));
    assert.ok(!result.includes('API:'));
  });

  it('shows actual credit spend when USD cost is unavailable', () => {
    const result = renderDiffSegment({ linesAdded: 0, linesRemoved: 0 }, null, {}, glyphs, 5.85);
    assert.ok(result.includes('5.85 credits'));
  });

  it('shows a genuine zero-credit telemetry value', () => {
    const result = renderDiffSegment({ linesAdded: 0, linesRemoved: 0 }, null, {}, glyphs, 0);
    assert.ok(result.includes('0.00 credits'));
  });

  it('omits an unknown credit spend rather than inventing 0.00x credits', () => {
    const result = renderDiffSegment({ linesAdded: 0, linesRemoved: 0 }, null, {}, glyphs, null);
    assert.equal(result, '');
    assert.equal(formatCreditSpend(null), '');
  });

  it('keeps cumulative transcript credits ahead of USD cost', () => {
    const cost = { totalCostUsd: 0.5, totalDurationMs: 0, apiDurationMs: 0 };
    const result = renderDiffSegment({ linesAdded: 0, linesRemoved: 0 }, cost, {}, glyphs, 5.85);
    assert.ok(result.includes('5.85 credits'));
    assert.ok(!result.includes('$0.50'));
  });

  it('respects showDiffStats=false', () => {
    const diff = { linesAdded: 100, linesRemoved: 5 };
    const config = { display: { showDiffStats: false } };
    const result = renderDiffSegment(diff, null, config, glyphs);
    assert.ok(!result.includes('+100'));
  });

  it('includes tool activity segment when provided', () => {
    const result = renderDiffSegment(null, null, {}, glyphs, null, '◐ Edit: parser.js');
    assert.ok(result.includes('Edit: parser.js'));
  });

  it('merges diff, credits, duration, and tool segment on line 3', () => {
    const diff = { linesAdded: 157, linesRemoved: 1 };
    const cost = { totalCostUsd: 0, totalDurationMs: 1589000 };
    const tool = '◐ Edit: parser.js  ✓ Read ×3 ✓ Grep ×2';
    const result = renderDiffSegment(diff, cost, {}, glyphs, 11.02, tool);
    assert.ok(result.includes('+157'));
    assert.ok(result.includes('-1'));
    assert.ok(result.includes('11.02 credits'));
    assert.ok(result.includes('26m29s'));
    assert.ok(result.includes('Edit: parser.js'));
    assert.ok(result.includes('Read ×3'));
    assert.ok(!result.includes('API:'));
  });
});
