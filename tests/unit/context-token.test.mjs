import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';

const require = createRequire(import.meta.url);
const { extractTokenData } = require('../../runtime/parser.js');
const { getTurnMetricsAndActivity } = require('../../runtime/transcript.js');
const { renderHUD } = require('../../runtime/renderer.js');

let originalCodeBuddyHome;
let testCodeBuddyHome;
let testDir;

before(() => {
  originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  testCodeBuddyHome = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'cbhud-context-token-home-'));
  process.env.CODEBUDDY_HOME = testCodeBuddyHome;
  testDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'cbhud-context-token-'));
});

after(() => {
  if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
  fs.rmSync(testCodeBuddyHome, { recursive: true, force: true });
  fs.rmSync(testDir, { recursive: true, force: true });
});

// Numbers taken from a real session (deepseek-v4.1-flash): the host treats miss
// as creation (codebuddy.js:11493650), making cacheRead + cacheCreation === prompt,
// so current_usage.input_tokens arrives as 0 regardless of hit rate.
const HOST_TOTAL = 27861;
const HOST_HIT = 27648;
const HOST_MISS = 213;
const HOST_OUTPUT = 10;
const HOST_CTX_SIZE = 1000000;
const HOST_PCT = 2.79;

function hostContextWindow() {
  return {
    total_input_tokens: HOST_TOTAL,
    total_output_tokens: HOST_OUTPUT,
    context_window_size: HOST_CTX_SIZE,
    used_percentage: HOST_PCT,
    current_usage: {
      input_tokens: 0,
      output_tokens: HOST_OUTPUT,
      cache_read_input_tokens: HOST_HIT,
      cache_creation_input_tokens: HOST_MISS,
    },
  };
}

// Mirrors the real transcript entry shape of the affected session.
function assistantEntry() {
  return {
    type: 'message',
    role: 'assistant',
    id: 'msg-assistant',
    parentId: 'msg-user',
    status: 'completed',
    providerData: {
      agent: 'cli',
      usage: {
        requests: 1,
        inputTokens: HOST_TOTAL,
        outputTokens: HOST_OUTPUT,
        totalTokens: HOST_TOTAL + HOST_OUTPUT,
        inputTokensDetails: [{ cached_tokens: HOST_HIT }],
        outputTokensDetails: [{ reasoning_tokens: 0 }],
      },
      rawUsage: {
        prompt_tokens: HOST_TOTAL,
        completion_tokens: HOST_OUTPUT,
        prompt_cache_hit_tokens: HOST_HIT,
        prompt_cache_miss_tokens: HOST_MISS,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  };
}

function userEntry() {
  return { type: 'message', role: 'user', id: 'msg-user', providerData: { agent: 'cli' } };
}

function compactEntry() {
  return {
    type: 'message',
    role: 'assistant',
    id: 'msg-compact',
    status: 'completed',
    providerData: { isCompacted: true, isSummary: true, isCompactInternal: true, agent: 'compact' },
  };
}

function writeTranscript(name, entries) {
  const file = nodePath.join(testDir, `${name}.jsonl`);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

const config = {
  theme: { primary: 'green', secondary: 'gray', warning: 'yellow', critical: 'red', accent: 'cyan', diffAdd: 'green', diffRemove: 'red' },
  display: { showTokenBar: true, showDiffStats: true, showAgentStatus: true, showCost: true, showDuration: true, showCurrentDir: true, showVersion: true, showPermissionMode: true, useNerdFonts: false, unicode: true, maxLines: 3, progressBarWidth: 10, showCacheHitRate: true },
  thresholds: { warning: 0.7, critical: 0.9 },
  cacheHitThresholds: { excellent: 80, partial: 50 },
  defaultEffortLevel: 'medium',
  language: 'en',
};

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('extractTokenData context input occupancy', () => {
  it('restores the host total when the host deducted the cache down to 0', () => {
    const result = extractTokenData({ context_window: hostContextWindow() });
    assert.equal(result.inTokens, HOST_TOTAL);
    assert.equal(result.outTokens, HOST_OUTPUT);
    assert.equal(result.ctxSize, HOST_CTX_SIZE);
    assert.equal(result.ctxPercent, HOST_PCT);
  });

  it('keeps the numerator on the same basis as used_percentage (AGENTS rule 6)', () => {
    const result = extractTokenData({ context_window: hostContextWindow() });
    const occupancy = (result.ctxPercent / 100) * result.ctxSize;
    assert.ok(
      Math.abs(result.inTokens - occupancy) / result.ctxSize < 0.01,
      `numerator ${result.inTokens} must agree with used_percentage occupancy ${occupancy}`,
    );
  });

  it('does not let a dirty cache field inflate the numerator', () => {
    // Same impossible data as tests/fixtures/payload-full.json: cache_read (5.8M)
    // exceeds the context window, so the guard must fall back to input_tokens.
    const result = extractTokenData({
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
    });
    assert.equal(result.inTokens, 91000);
    assert.equal(result.cacheRead, 5800000);
  });

  it('leaves payloads without cache fields untouched', () => {
    const result = extractTokenData({
      context_window: {
        context_window_size: 100000,
        used_percentage: 5,
        current_usage: { input_tokens: 5000, output_tokens: 100 },
      },
    });
    assert.equal(result.inTokens, 5000);
  });

  it('does not double-count when payload carries raw prompt along with cache fields', () => {
    const result = extractTokenData({
      context_window: {
        context_window_size: HOST_CTX_SIZE,
        used_percentage: HOST_PCT,
        current_usage: {
          input_tokens: HOST_TOTAL,
          output_tokens: HOST_OUTPUT,
          cache_read_input_tokens: HOST_HIT,
          cache_creation_input_tokens: HOST_MISS,
        },
      },
    });
    assert.equal(result.inTokens, HOST_TOTAL);
  });

  it('reports 0 when there is no telemetry at all', () => {
    const result = extractTokenData({ context_window: { context_window_size: 1000000 } });
    assert.equal(result.inTokens, 0);
  });
});

describe('context freshness against the host-adjusted payload', () => {
  it('marks the payload fresh when the host-adjusted input matches the transcript usage', () => {
    const transcript = writeTranscript('fresh', [userEntry(), assistantEntry()]);
    const result = getTurnMetricsAndActivity(transcript, { contextWindow: hostContextWindow() });
    assert.equal(result.contextStatus, 'fresh');
  });

  it('still resolves fresh for payloads that carry the raw prompt total', () => {
    const transcript = writeTranscript('raw', [userEntry(), assistantEntry()]);
    const result = getTurnMetricsAndActivity(transcript, {
      contextWindow: {
        context_window_size: HOST_CTX_SIZE,
        used_percentage: HOST_PCT,
        current_usage: { input_tokens: HOST_TOTAL, output_tokens: HOST_OUTPUT },
      },
    });
    assert.equal(result.contextStatus, 'fresh');
  });

  it('resolves fresh when payload carries raw prompt along with cache fields', () => {
    const transcript = writeTranscript('raw-with-cache', [userEntry(), assistantEntry()]);
    const result = getTurnMetricsAndActivity(transcript, {
      contextWindow: {
        context_window_size: HOST_CTX_SIZE,
        used_percentage: HOST_PCT,
        current_usage: {
          input_tokens: HOST_TOTAL,
          output_tokens: HOST_OUTPUT,
          cache_read_input_tokens: HOST_HIT,
          cache_creation_input_tokens: HOST_MISS,
        },
      },
    });
    assert.equal(result.contextStatus, 'fresh');
  });

  it('marks stale when a successful compact summary follows the usage', () => {
    const transcript = writeTranscript('stale', [userEntry(), assistantEntry(), compactEntry()]);
    const result = getTurnMetricsAndActivity(transcript, { contextWindow: hostContextWindow() });
    assert.equal(result.contextStatus, 'stale');
  });

  it('stays unknown when the payload matches no usage in the transcript', () => {
    const transcript = writeTranscript('unknown', [
      userEntry(),
      {
        type: 'message',
        role: 'assistant',
        id: 'msg-other',
        status: 'completed',
        providerData: {
          agent: 'cli',
          usage: { inputTokens: 99999, outputTokens: 999 },
        },
      },
    ]);
    const result = getTurnMetricsAndActivity(transcript, { contextWindow: hostContextWindow() });
    assert.equal(result.contextStatus, 'unknown');
  });

  it('stays unknown when the payload carries no usage at all', () => {
    const transcript = writeTranscript('no-usage', [userEntry(), assistantEntry()]);
    const result = getTurnMetricsAndActivity(transcript, {
      contextWindow: { context_window_size: HOST_CTX_SIZE, used_percentage: HOST_PCT },
    });
    assert.equal(result.contextStatus, 'unknown');
  });
});

describe('line 2 rendering for a cache-adjusted payload', () => {
  it('shows the real occupancy and the progress bar instead of "last reported"', () => {
    const transcript = writeTranscript('render-fresh', [userEntry(), assistantEntry()]);
    const payload = {
      model: { id: 'deepseek-v4.1-flash', display_name: 'Deepseek-V4.1-Flash' },
      cwd: testDir,
      transcript_path: transcript,
      context_window: hostContextWindow(),
    };
    const line2 = stripAnsi(renderHUD(payload, config).split('\n')[1]);
    assert.ok(line2.includes('Context Token 27.9k/1M'), line2);
    assert.ok(line2.includes('[') && line2.includes(']'), line2);
    assert.ok(line2.includes('3%'), line2);
    assert.ok(line2.includes('out 10'), line2);
    assert.ok(line2.includes('cache 99.2%'), line2);
    assert.ok(!line2.includes('last reported'), line2);
    assert.ok(!line2.includes('0/1M'), line2);
  });

  it('keeps the post-compact protection: -- plus the waiting hint, no bar', () => {
    const transcript = writeTranscript('render-stale', [userEntry(), assistantEntry(), compactEntry()]);
    const payload = {
      model: { id: 'deepseek-v4.1-flash', display_name: 'Deepseek-V4.1-Flash' },
      cwd: testDir,
      transcript_path: transcript,
      context_window: hostContextWindow(),
    };
    const line2 = stripAnsi(renderHUD(payload, config).split('\n')[1]);
    assert.ok(line2.includes('Context Token --/1M'), line2);
    assert.ok(line2.includes('awaiting usage after compact'), line2);
    assert.ok(!line2.includes('['), line2);
    assert.ok(!line2.includes('27.9k'), line2);
  });
});
