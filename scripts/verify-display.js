#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, '..', 'tests', 'fixtures');
const HUD_BIN = path.join(__dirname, '..', 'runtime', 'bin', 'codebuddy-hud.js');
const MAX_TIME_MS = 1500;

const fixtures = [
  'payload-full.json',
  'payload-minimal.json',
  'payload-empty-cost.json',
];

let passed = 0;
let failed = 0;

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*?(?:\x07|\x1b\\|$)/g, '');
}

function spawnHud(payloadStr, args = [], envOverrides = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [HUD_BIN, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CODEBUDDY_HUD_FORCE_ASCII: '1', CODEBUDDY_HUD_NO_UPDATE_CHECK: '1', ...envOverrides },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.stdin.on('error', () => {});

    child.on('close', (code) => {
      resolve({ code, stdout, stderr, elapsed: Date.now() - start });
    });

    if (payloadStr !== null) child.stdin.write(payloadStr);
    child.stdin.end();
  });
}

function checkInvariants(result, label) {
  const clean = stripAnsi(result.stdout).trim();
  const lines = clean ? clean.split('\n') : [];
  const errors = [];

  if (result.code !== 0) errors.push(`exit code ${result.code}`);
  if (result.elapsed > MAX_TIME_MS) errors.push(`took ${result.elapsed}ms (>${MAX_TIME_MS}ms)`);
  if (!clean) errors.push('empty output');
  if (lines.length > 3) errors.push(`${lines.length} lines (>3)`);
  if (result.stderr.trim()) errors.push(`stderr: ${result.stderr.trim().slice(0, 100)}`);

  return { clean, lines, errors };
}

async function main() {
  console.log('=== codebuddy-cli-hud E2E Verification ===\n');

  for (const fixture of fixtures) {
    const fixturePath = path.join(FIXTURES_DIR, fixture);
    const payload = fs.readFileSync(fixturePath, 'utf8');
    const result = await spawnHud(payload);
    const { clean, lines, errors } = checkInvariants(result, fixture);

    if (errors.length === 0) {
      console.log(`  PASS  ${fixture} (${result.elapsed}ms, ${lines.length} lines)`);
      passed++;
    } else {
      console.log(`  FAIL  ${fixture}: ${errors.join(', ')}`);
      failed++;
    }
    void clean;
  }

  // Tool activity: real temp transcript with a pending function_call
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-e2e-'));
  try {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const call = JSON.stringify({
      type: 'function_call', callId: 'call-e2e', name: 'Edit',
      arguments: JSON.stringify({ file_path: '/proj/verify.ts' }), sessionId: 's',
    });
    fs.writeFileSync(transcriptPath, call + '\n');

    const basePayload = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'payload-full.json'), 'utf8'));
    basePayload.transcript_path = transcriptPath;
    const result = await spawnHud(JSON.stringify(basePayload));
    const { clean, lines, errors } = checkInvariants(result, 'tool-activity');
    if (!clean.includes('Edit')) errors.push('tool segment missing (expected "Edit")');

    if (errors.length === 0) {
      console.log(`  PASS  tool-activity (${result.elapsed}ms, ${lines.length} lines, tool segment rendered)`);
      passed++;
    } else {
      console.log(`  FAIL  tool-activity: ${errors.join(', ')}`);
      failed++;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // CLI smoke: --status
  const statusResult = await spawnHud(null, ['--status']);
  const statusCheck = checkInvariants(statusResult, 'cli-status');
  if (statusCheck.errors.length === 0) {
    console.log(`  PASS  cli-status (${statusResult.elapsed}ms, ${statusCheck.lines.length} lines)`);
    passed++;
  } else {
    console.log(`  FAIL  cli-status: ${statusCheck.errors.join(', ')}`);
    failed++;
  }

  // CLI smoke: --doctor
  const doctorResult = await spawnHud(null, ['--doctor']);
  const doctorErrors = [];
  if (doctorResult.code !== 0) doctorErrors.push(`exit code ${doctorResult.code}`);
  if (doctorResult.elapsed > MAX_TIME_MS) doctorErrors.push(`took ${doctorResult.elapsed}ms (>${MAX_TIME_MS}ms)`);
  if (!doctorResult.stdout.trim()) doctorErrors.push('empty output');
  if (/\n\s*at \S+ \(/.test(doctorResult.stderr)) doctorErrors.push('stack trace in stderr');
  if (doctorErrors.length === 0) {
    console.log(`  PASS  cli-doctor (${doctorResult.elapsed}ms, text report)`);
    passed++;
  } else {
    console.log(`  FAIL  cli-doctor: ${doctorErrors.join(', ')}`);
    failed++;
  }

  // CLI smoke: --doctor --json
  const doctorJsonResult = await spawnHud(null, ['--doctor', '--json']);
  const doctorJsonErrors = [];
  if (doctorJsonResult.code !== 0) doctorJsonErrors.push(`exit code ${doctorJsonResult.code}`);
  if (doctorJsonResult.elapsed > MAX_TIME_MS) doctorJsonErrors.push(`took ${doctorJsonResult.elapsed}ms (>${MAX_TIME_MS}ms)`);
  if (/\n\s*at \S+ \(/.test(doctorJsonResult.stderr)) doctorJsonErrors.push('stack trace in stderr');
  try {
    const parsed = JSON.parse(doctorJsonResult.stdout);
    if (!parsed || typeof parsed !== 'object') doctorJsonErrors.push('invalid JSON root');
    if (!Array.isArray(parsed.checks)) doctorJsonErrors.push('missing checks array');
  } catch (err) {
    doctorJsonErrors.push(`invalid JSON: ${err && err.message}`);
  }
  if (doctorJsonErrors.length === 0) {
    console.log(`  PASS  cli-doctor-json (${doctorJsonResult.elapsed}ms, valid JSON schema)`);
    passed++;
  } else {
    console.log(`  FAIL  cli-doctor-json: ${doctorJsonErrors.join(', ')}`);
    failed++;
  }

  // Boundary: empty stdin
  const emptyResult = await spawnHud(null);
  const emptyErrors = [];
  if (emptyResult.code !== 0) emptyErrors.push(`exit code ${emptyResult.code}`);
  if (emptyResult.elapsed > MAX_TIME_MS) emptyErrors.push(`took ${emptyResult.elapsed}ms (>${MAX_TIME_MS}ms)`);
  if (/\n\s*at \S+ \(/.test(emptyResult.stderr)) emptyErrors.push('stack trace in stderr');
  if (emptyErrors.length === 0) {
    console.log(`  PASS  boundary-empty-stdin (${emptyResult.elapsed}ms, graceful exit 0)`);
    passed++;
  } else {
    console.log(`  FAIL  boundary-empty-stdin: ${emptyErrors.join(', ')}`);
    failed++;
  }

  // Boundary: oversized stdin (>1MB overflow intercepted)
  const oversizedPayload = 'x'.repeat(1024 * 1024 + 1024);
  const oversizedResult = await spawnHud(oversizedPayload);
  const oversizedErrors = [];
  if (oversizedResult.code !== 0) oversizedErrors.push(`exit code ${oversizedResult.code}`);
  if (oversizedResult.elapsed > MAX_TIME_MS) oversizedErrors.push(`took ${oversizedResult.elapsed}ms (>${MAX_TIME_MS}ms)`);
  if (/\n\s*at \S+ \(/.test(oversizedResult.stderr)) oversizedErrors.push('stack trace in stderr');
  if (oversizedErrors.length === 0) {
    console.log(`  PASS  boundary-oversized-stdin (${oversizedResult.elapsed}ms, >1MB overflow intercepted)`);
    passed++;
  } else {
    console.log(`  FAIL  boundary-oversized-stdin: ${oversizedErrors.join(', ')}`);
    failed++;
  }

  // Boundary: malformed non-JSON input
  const malformedResult = await spawnHud('<<< not a valid json string >>> { [');
  const malformedErrors = [];
  if (malformedResult.code !== 0) malformedErrors.push(`exit code ${malformedResult.code}`);
  if (malformedResult.elapsed > MAX_TIME_MS) malformedErrors.push(`took ${malformedResult.elapsed}ms (>${MAX_TIME_MS}ms)`);
  if (/\n\s*at \S+ \(/.test(malformedResult.stderr)) malformedErrors.push('stack trace in stderr');
  if (malformedErrors.length === 0) {
    console.log(`  PASS  boundary-malformed-json (${malformedResult.elapsed}ms, invalid JSON handled)`);
    passed++;
  } else {
    console.log(`  FAIL  boundary-malformed-json: ${malformedErrors.join(', ')}`);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
