import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { calculateTurnCacheMetrics, formatTurnCacheBadge, metricsFromPromptCache, normalizeTokenCount } = require('../../runtime/renderer/format.js');

describe('calculateTurnCacheMetrics', () => {
  it('handles standard input with cache included (in >= cacheTotal)', () => {
    const usage = { input_tokens: 5000, cache_read_input_tokens: 3000, cache_creation_input_tokens: 1000 };
    const m = calculateTurnCacheMetrics(usage);
    assert.equal(m.available, true);
    assert.equal(m.totalPrompt, 5000);
    assert.ok(Math.abs(m.hitRate - 60.0) < 0.01);
  });

  it('handles incremental input (in < cacheTotal)', () => {
    const usage = { input_tokens: 1000, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 };
    const m = calculateTurnCacheMetrics(usage);
    assert.equal(m.available, true);
    assert.equal(m.totalPrompt, 4000);
    assert.ok(Math.abs(m.hitRate - 75.0) < 0.01);
  });

  it('cold start with zero cache read', () => {
    const usage = { input_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const m = calculateTurnCacheMetrics(usage);
    assert.equal(m.available, true);
    assert.equal(m.hitRate, 0);
  });

  it('returns null for null usage', () => {
    const m = calculateTurnCacheMetrics(null);
    assert.equal(m, null);
  });

  it('returns null for undefined usage', () => {
    const m = calculateTurnCacheMetrics(undefined);
    assert.equal(m, null);
  });

  it('returns unavailable when both cacheRead and inTokens are zero', () => {
    const usage = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const m = calculateTurnCacheMetrics(usage);
    assert.equal(m.available, false);
  });

  it('returns unavailable when cache_read_input_tokens is missing (was the 0% bug)', () => {
    // Real CodeBuddy sessions often omit cache_read_input_tokens entirely. Previously
    // this fell through to 0 and rendered `cache 0.0%`, indistinguishable from a
    // genuine cold start. Now it should surface as `cache --` instead.
    const usage = { input_tokens: 1100000, output_tokens: 1200 };
    const m = calculateTurnCacheMetrics(usage);
    assert.equal(m.available, false);
  });

  it('returns unavailable when input_tokens is missing', () => {
    const usage = { cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 };
    const m = calculateTurnCacheMetrics(usage);
    assert.equal(m.available, false);
  });

  it('tolerates non-numeric strings by treating them as missing', () => {
    const usage = { input_tokens: 'NaN', cache_read_input_tokens: 'abc' };
    const m = calculateTurnCacheMetrics(usage);
    assert.equal(m.available, false);
  });

  it('treats an empty-string hit field as missing rather than a genuine 0%', () => {
    const m = calculateTurnCacheMetrics({ prompt_tokens: 5000, prompt_cache_hit_tokens: '' });
    assert.equal(m.available, false);
  });

  it('clamps hitRate to 100 max', () => {
    const usage = { input_tokens: 10000, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 };
    const m = calculateTurnCacheMetrics(usage);
    assert.equal(m.available, true);
    assert.equal(m.hitRate, 100);
  });
});

describe('formatTurnCacheBadge', () => {
  it('excellent tier (>=80%) uses green+bold', () => {
    const metrics = { available: true, hitRate: 85.2, cacheRead: 8520, totalPrompt: 10000 };
    const result = formatTurnCacheBadge(metrics);
    assert.ok(result.includes('\x1b[32m'));
    assert.ok(result.includes('\x1b[1m'));
    assert.ok(result.includes('cache 85.2%'));
    assert.ok(result.endsWith('\x1b[0m'));
  });

  it('partial tier (50%-80%) uses yellow', () => {
    const metrics = { available: true, hitRate: 60.0, cacheRead: 6000, totalPrompt: 10000 };
    const result = formatTurnCacheBadge(metrics);
    assert.ok(result.includes('\x1b[33m'));
    assert.ok(!result.includes('\x1b[1m'));
    assert.ok(!result.includes('\x1b[2m'));
    assert.ok(result.includes('cache 60.0%'));
  });

  it('low tier (0%-50%) uses yellow+dim', () => {
    const metrics = { available: true, hitRate: 25.0, cacheRead: 2500, totalPrompt: 10000 };
    const result = formatTurnCacheBadge(metrics);
    assert.ok(result.includes('\x1b[33m'));
    assert.ok(result.includes('\x1b[2m'));
    assert.ok(result.includes('cache 25.0%'));
  });

  it('cold tier (0%) uses gray+dim', () => {
    const metrics = { available: true, hitRate: 0, cacheRead: 0, totalPrompt: 5000 };
    const result = formatTurnCacheBadge(metrics);
    assert.ok(result.includes('\x1b[90m'));
    assert.ok(result.includes('\x1b[2m'));
    assert.ok(result.includes('cache 0.0%'));
  });

  it('unavailable metrics returns dim gray dash', () => {
    const metrics = { available: false };
    const result = formatTurnCacheBadge(metrics);
    assert.ok(result.includes('\x1b[90m'));
    assert.ok(result.includes('\x1b[2m'));
    assert.ok(result.includes('cache --'));
  });

  it('null metrics returns dim gray dash', () => {
    const result = formatTurnCacheBadge(null);
    assert.ok(result.includes('cache --'));
  });

  it('respects custom thresholds', () => {
    const metrics = { available: true, hitRate: 55, cacheRead: 5500, totalPrompt: 10000 };
    const customThresholds = { excellent: 50, partial: 30 };
    const result = formatTurnCacheBadge(metrics, 'cache', false, customThresholds);
    assert.ok(result.includes('\x1b[32m'));
    assert.ok(result.includes('\x1b[1m'));
  });
});

// Regression guard for the "cache always 0%" bug (2026-09-01).
// On this provider rawUsage carries BOTH a hard-zero `cache_read_input_tokens`
// and the real `prompt_cache_hit_tokens`. Reading only the Anthropic-style name
// reported ~0% for sessions actually hitting 96-99%.
describe('cache field priority (real provider trap)', () => {
  const trapUsage = {
    prompt_tokens: 133461,
    prompt_cache_hit_tokens: 133120,
    prompt_cache_miss_tokens: 341,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };

  it('prefers prompt_cache_hit_tokens over a zero cache_read_input_tokens', () => {
    const m = calculateTurnCacheMetrics(trapUsage);
    assert.equal(m.available, true);
    assert.equal(m.source, 'prompt_cache_hit');
    assert.equal(m.cacheRead, 133120);
    assert.equal(m.totalPrompt, 133461);
    assert.ok(Math.abs(m.hitRate - 99.74) < 0.01, `got ${m.hitRate}`);
  });

  it('does not add cache to the denominator for the prompt_cache_hit shape', () => {
    // hit + miss === prompt_tokens, so the denominator is the prompt total.
    // The legacy self-adaptive branch would have produced 133120/(0+133120+341... ) wrong.
    const m = calculateTurnCacheMetrics(trapUsage);
    assert.equal(m.totalPrompt, 133461);
  });

  it('reports a genuine 0% cold turn rather than falling through', () => {
    const m = calculateTurnCacheMetrics({
      prompt_tokens: 50000,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 50000,
    });
    assert.equal(m.available, true);
    assert.equal(m.hitRate, 0);
  });

  it('uses inputTokensDetails when only the OpenAI usage shape is present', () => {
    const m = calculateTurnCacheMetrics({
      inputTokens: 133461,
      inputTokensDetails: [{ cached_tokens: 133120 }],
    });
    assert.equal(m.available, true);
    assert.equal(m.source, 'inputTokensDetails');
    assert.ok(Math.abs(m.hitRate - 99.74) < 0.01);
  });

  it('still honours Anthropic-style fields when no provider shape exists', () => {
    const m = calculateTurnCacheMetrics({
      input_tokens: 5000,
      cache_read_input_tokens: 3000,
      cache_creation_input_tokens: 0,
    });
    assert.equal(m.available, true);
    assert.equal(m.source, 'cache_read_input_tokens');
    assert.equal(m.hitRate, 60);
  });
});

describe('normalizeTokenCount', () => {
  it('treats empty and whitespace-only strings as missing, not as zero', () => {
    assert.equal(normalizeTokenCount(''), null);
    assert.equal(normalizeTokenCount('   '), null);
    assert.equal(normalizeTokenCount('0'), 0);
    assert.equal(normalizeTokenCount(0), 0);
    assert.equal(normalizeTokenCount(null), null);
  });
});

describe('metricsFromPromptCache', () => {
  it('builds metrics from transcript-sourced hit/prompt pair', () => {
    const m = metricsFromPromptCache(133120, 133461);
    assert.equal(m.available, true);
    assert.equal(m.source, 'transcript');
    assert.ok(Math.abs(m.hitRate - 99.74) < 0.01);
  });

  it('returns null for a non-positive or missing prompt', () => {
    assert.equal(metricsFromPromptCache(0, 0), null);
    assert.equal(metricsFromPromptCache(10, 0), null);
    assert.equal(metricsFromPromptCache(null, 100), null);
    assert.equal(metricsFromPromptCache(10, null), null);
  });
});
