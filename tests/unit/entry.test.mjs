// Integration tests for the entry point: every path must exit 0 with clean
// stderr. The EPIPE case is the load-bearing one — see the handler comment in
// runtime/bin/codebuddy-hud.js (the natural-drain exit rework unmasked an
// unhandled stdout 'error' that used to be hidden by process.exit()).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BIN = fileURLToPath(new URL('../../runtime/bin/codebuddy-hud.js', import.meta.url));
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-entry-home-'));
const TEST_ENV = { ...process.env, CODEBUDDY_HOME: TEST_HOME };
const payload = JSON.stringify({
  model: { display_name: 'Hy4', id: 'hy4' },
  cwd: 'D:/code_sum/Github/codebuddy-cli-hud',
  context_window: { context_window_size: 1000000, used_percentage: 18, current_usage: { input_tokens: 170219, output_tokens: 4600 } },
});

function run({ destroyStdoutEarly = false, input = null, keepStdinOpen = false, args = [], env = TEST_ENV, bin = BIN } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.on('error', () => {});
    if (destroyStdoutEarly) child.stdout.destroy(); // race the child's first write
    if (input !== null) {
      child.stdin.write(input);
      if (!keepStdinOpen) child.stdin.end();
    } else if (!keepStdinOpen) {
      child.stdin.end();
    }
    child.on('close', (code) => resolve({ code, out, err, elapsed: Date.now() - started }));
  });
}

test('renders from stdin and exits 0 with clean stderr', async () => {
  const r = await run({ input: payload });
  assert.equal(r.code, 0);
  assert.ok(r.out.length > 0);
  assert.equal(r.err, '');
});

test('exits 0 when stdout is closed early (EPIPE race must not crash)', async () => {
  const r = await run({ input: payload, destroyStdoutEarly: true });
  assert.equal(r.code, 0, 'unhandled EPIPE crashed the process; stderr: ' + r.err);
  assert.equal(r.err, '');
});

test('garbage stdin degrades silently to exit 0', async () => {
  const r = await run({ input: 'not json at all {{{' });
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.equal(r.err, '');
});

test('empty stdin and oversized stdin exit 0 without output', async () => {
  const empty = await run();
  assert.equal(empty.code, 0);
  assert.equal(empty.out, '');
  assert.equal(empty.err, '');

  const oversized = await run({ input: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal(oversized.code, 0);
  assert.equal(oversized.out, '');
  assert.equal(oversized.err, '');
});

test('an open stdin is released well before the 1500ms process budget', async () => {
  const r = await run({ keepStdinOpen: true });
  assert.equal(r.code, 0);
  assert.ok(r.elapsed < 1450, `open stdin took ${r.elapsed}ms`);
  assert.equal(r.err, '');
});

test('setup and uninstall failures still exit 0 without a stack trace', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-entry-'));
  const blocker = path.join(tempRoot, 'not-a-directory');
  const copiedRuntime = path.join(tempRoot, 'runtime');
  const copiedBin = path.join(copiedRuntime, 'bin', 'codebuddy-hud.js');
  fs.writeFileSync(blocker, 'x');
  fs.cpSync(path.dirname(path.dirname(BIN)), copiedRuntime, { recursive: true });
  const badSettingsPath = path.join(blocker, 'settings.json');
  const env = { ...process.env, CODEBUDDY_HOME: tempRoot, CODEBUDDY_SETTINGS_PATH: badSettingsPath };
  try {
    for (const arg of ['--setup', '--uninstall']) {
      const r = await run({ args: [arg], env, bin: copiedBin });
      assert.equal(r.code, 0, `${arg}: ${r.err}`);
      assert.ok(!/\n\s*at \S+ \(/.test(r.err), `${arg} leaked a stack: ${r.err}`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('--status renders and exits 0', async () => {
  const child = spawn(process.execPath, [BIN, '--status'], { stdio: ['ignore', 'pipe', 'pipe'], env: TEST_ENV });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  assert.ok(out.trim().length > 0);
  const plainOutput = out.replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(plainOutput, /DeepSeek V4 Flash/);
  assert.match(plainOutput, /82\.04 credits/);
  assert.equal(err, '');
});

test('--theme list renders theme options and exits 0', async () => {
  const r = await run({ args: ['--theme', 'list'] });
  assert.equal(r.code, 0);
  assert.match(r.out, /Available HUD Themes/);
  assert.equal(r.err, '');
});

test('--theme <valid> saves theme and exits 0', async () => {
  const r = await run({ args: ['--theme', 'ocean'] });
  assert.equal(r.code, 0);
  const plain = r.out.replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(plain, /HUD theme set to 'ocean'/);
  assert.equal(r.err, '');
});

test('--theme <invalid> prints error and exits 0', async () => {
  const r = await run({ args: ['--theme', 'non_existent_theme_xyz'] });
  assert.equal(r.code, 0);
  assert.match(r.err, /Unknown theme/);
});

test('--doctor and --doctor --json exit 0', async () => {
  const docText = await run({ args: ['--doctor'] });
  assert.equal(docText.code, 0);
  assert.ok(docText.out.length > 0);
  assert.equal(docText.err, '');

  const docJson = await run({ args: ['--doctor', '--json'] });
  assert.equal(docJson.code, 0);
  assert.doesNotThrow(() => JSON.parse(docJson.out));
  assert.equal(docJson.err, '');
});

test('timeout path correctly reconstructs multi-byte UTF-8 split across chunks without corruption', async () => {
  const fullPayload = JSON.stringify({
    model: { display_name: '测试模型·极速版', id: 'test-model' },
    cwd: 'D:/code_sum/Github/codebuddy-cli-hud',
    context_window: { context_window_size: 1000000, used_percentage: 18, current_usage: { input_tokens: 170219, output_tokens: 4600 } },
  });
  const buf = Buffer.from(fullPayload, 'utf8');
  const splitIndex = buf.indexOf(0xe6) + 1;
  const chunk1 = buf.subarray(0, splitIndex);
  const chunk2 = buf.subarray(splitIndex);

  await new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN], { stdio: ['pipe', 'pipe', 'pipe'], env: TEST_ENV });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.write(chunk1);
    child.stdin.write(chunk2);
    // Intentionally keep stdin open to trigger 800ms timeout
    child.on('close', (code) => {
      assert.equal(code, 0);
      assert.ok(out.length > 0, 'output should render properly even under timeout');
      const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
      assert.match(plain, /测试模型/);
      assert.equal(err, '');
      resolve();
    });
  });
});


after(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});
