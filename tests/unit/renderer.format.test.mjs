import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { formatTokens, formatDurationMs, createProgressBar, ANSI_COLORS, color } = require('../../runtime/renderer/format.js');

describe('formatTokens', () => {
  it('formats zero', () => assert.equal(formatTokens(0), '0'));
  it('formats small numbers', () => assert.equal(formatTokens(42), '42'));
  it('formats hundreds', () => assert.equal(formatTokens(999), '999'));
  it('formats thousands', () => assert.equal(formatTokens(1000), '1k'));
  it('formats mid-range k', () => assert.equal(formatTokens(1500), '1.5k'));
  it('formats large k', () => assert.equal(formatTokens(150000), '150k'));
  it('boundary: 999949 stays in k', () => assert.equal(formatTokens(999949), '999.9k'));
  it('boundary: 999950 becomes M', () => assert.equal(formatTokens(999950), '1M'));
  it('formats millions', () => assert.equal(formatTokens(1500000), '1.5M'));
  it('handles negative', () => assert.equal(formatTokens(-5), '0'));
  it('handles NaN', () => assert.equal(formatTokens(NaN), '0'));
  it('handles Infinity', () => assert.equal(formatTokens(Infinity), '0'));
});

describe('formatDurationMs', () => {
  it('formats zero', () => assert.equal(formatDurationMs(0), '0s'));
  it('formats seconds', () => assert.equal(formatDurationMs(5000), '5s'));
  it('formats minutes and seconds', () => assert.equal(formatDurationMs(65000), '1m5s'));
  it('formats hours and minutes', () => assert.equal(formatDurationMs(3720000), '1h2m'));
  it('formats large hours without minutes', () => assert.equal(formatDurationMs(36000000), '10h'));
  it('formats days', () => assert.equal(formatDurationMs(90000000), '1d1h'));
  it('formats large days without hours', () => assert.equal(formatDurationMs(864000000), '10d'));
  it('handles the fixture value 769524ms', () => assert.equal(formatDurationMs(769524), '12m49s'));
});

describe('createProgressBar', () => {
  const unicodeGlyphs = { bar: '\u2588', empty: '\u2591' };
  const thresholds = { warning: 0.7, critical: 0.9 };

  it('renders empty bar at 0%', () => {
    const bar = createProgressBar(0, 10, thresholds, unicodeGlyphs);
    assert.ok(bar.includes('\u2591'.repeat(10)));
  });

  it('renders full bar at 100%', () => {
    const bar = createProgressBar(100, 10, thresholds, unicodeGlyphs);
    assert.ok(bar.includes('\u2588'.repeat(10)));
  });

  it('renders half bar at 50%', () => {
    const bar = createProgressBar(50, 10, thresholds, unicodeGlyphs);
    assert.ok(bar.includes('\u2588'.repeat(5)));
    assert.ok(bar.includes('\u2591'.repeat(5)));
  });

  it('uses green below warning threshold', () => {
    const bar = createProgressBar(50, 10, thresholds, unicodeGlyphs);
    assert.ok(bar.includes('\x1b[32m'));
  });

  it('uses yellow at warning threshold', () => {
    const bar = createProgressBar(75, 10, thresholds, unicodeGlyphs);
    assert.ok(bar.includes('\x1b[33m'));
  });

  it('uses red at critical threshold', () => {
    const bar = createProgressBar(95, 10, thresholds, unicodeGlyphs);
    assert.ok(bar.includes('\x1b[31m'));
  });
});

describe('color and ANSI_COLORS', () => {
  it('includes brightPurple in ANSI_COLORS and formats text with 16-color high bright purple', () => {
    assert.equal(ANSI_COLORS.brightPurple, '\x1b[95m');
    assert.equal(color('test', 'brightPurple'), '\x1b[95mtest\x1b[0m');
  });
});
