// Integration tests for the entry point: every path must exit 0 with clean
// stderr. The EPIPE case is the load-bearing one — see the handler comment in
// runtime/bin/codebuddy-hud.js (the natural-drain exit rework unmasked an
// unhandled stdout 'error' that used to be hidden by process.exit()).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
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

// An empty render is indistinguishable from a healthy one for the host (it
// only checks the exit code and the text), so the unavailability must at least
// be diagnosable from the HUD's own error log.
test('a missing payload leaves a diagnostic without touching stdout', async () => {
  const logPath = path.join(TEST_HOME, 'codebuddy-hud-error.log');
  if (fs.existsSync(logPath)) fs.rmSync(logPath);
  const r = await run();
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.equal(r.err, '');
  assert.match(fs.readFileSync(logPath, 'utf8'), /payload unavailable/);

  fs.rmSync(logPath);
  const garbage = await run({ input: 'not json at all {{{' });
  assert.equal(garbage.out, '');
  assert.match(fs.readFileSync(logPath, 'utf8'), /not valid JSON/);
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
  assert.match(plainOutput, /Deepseek-V4\.1-Flash/);
  assert.match(plainOutput, /82\.04 credits/);
  assert.equal(err, '');
});

test('--update reports already up to date and exits 0', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(BIN, '..', '..', '..', 'package.json'), 'utf8'));
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tag_name: `v${pkg.version}` }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/release.json`;
    const child = spawn(process.execPath, [BIN, '--update'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...TEST_ENV, CODEBUDDY_HUD_LATEST_RELEASE_URL: url },
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 0);
    assert.match(out, new RegExp(`Already up to date \\(v${pkg.version}\\)`));
    assert.equal(err, '');
  } finally {
    server.close();
  }
});

test('--theme list renders theme options and exits 0', async () => {
  const r = await run({ args: ['--theme', 'list'] });
  assert.equal(r.code, 0);
  assert.match(r.out, /Available themes/);
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

test('--theme <invalid> sanitizes control sequences from the argument', async () => {
  const evil = '\x1b]52;c;ZXZpbA==\x07\x1b[2J';
  const r = await run({ args: ['--theme', evil] });
  assert.equal(r.code, 0);
  assert.match(r.err, /Unknown theme/);
  assert.ok(!r.err.includes('\x1b]52'), 'OSC 52 must not reach stderr');
  assert.ok(!r.err.includes('\x1b[2J'), 'clear-screen CSI must not reach stderr');
});

test('--theme rejects prototype-chain names and never persists them', async () => {
  for (const name of ['__proto__', 'constructor', 'toString']) {
    const r = await run({ args: ['--theme', name] });
    assert.equal(r.code, 0);
    assert.match(r.err, /Unknown theme/, `${name} must be rejected`);
    assert.ok(!r.out.includes('HUD theme set'), `${name} must not be saved`);
  }
  // A previously persisted valid theme (the 'ocean' test above) must remain
  // untouched; a filtered single-test run may simply have no config yet.
  const userConfigPath = path.join(TEST_HOME, 'codebuddy-hud.config.json');
  if (fs.existsSync(userConfigPath)) {
    assert.equal(JSON.parse(fs.readFileSync(userConfigPath, 'utf8')).theme, 'ocean');
  }
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

test('prints version with --version and -v and exits 0', async () => {
  const r1 = await run({ args: ['--version'] });
  assert.equal(r1.code, 0);
  assert.match(r1.out, /^codebuddy-hud v\d+\.\d+\.\d+/);
  assert.equal(r1.err, '');

  const r2 = await run({ args: ['-v'] });
  assert.equal(r2.code, 0);
  assert.match(r2.out, /^codebuddy-hud v\d+\.\d+\.\d+/);
  assert.equal(r2.err, '');
});

test('prints help with --help and -h and exits 0', async () => {
  const r1 = await run({ args: ['--help'] });
  assert.equal(r1.code, 0);
  assert.match(r1.out, /Usage:/);
  assert.match(r1.out, /--footer \[mode\|list\]/);
  assert.match(r1.out, /--setup \[--theme <name>\] \[--footer <mode>\]/);
  assert.match(r1.out, /--version, -v/);
  assert.equal(r1.err, '');

  const r2 = await run({ args: ['-h'] });
  assert.equal(r2.code, 0);
  assert.match(r2.out, /Usage:/);
  assert.match(r2.out, /--help, -h/);
  assert.equal(r2.err, '');
});

for (const flag of ['--help', '-h', '--version', '-v']) {
  test(`${flag} takes precedence over commands without modifying the installation`, async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-entry-info-'));
    const home = path.join(tempRoot, 'home');
    const copiedRuntime = path.join(tempRoot, 'runtime');
    const copiedBin = path.join(copiedRuntime, 'bin', 'codebuddy-hud.js');
    const settingsPath = path.join(tempRoot, 'settings.json');
    const env = { ...process.env, CODEBUDDY_HOME: home, CODEBUDDY_SETTINGS_PATH: settingsPath };
    const isHelp = flag === '--help' || flag === '-h';
    function snapshot(dir) {
      return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
        const entryPath = path.join(dir, entry.name);
        return [entry.name, entry.isDirectory() ? snapshot(entryPath)
          : createHash('sha256').update(fs.readFileSync(entryPath)).digest('hex')];
      });
    }
    try {
      fs.mkdirSync(home);
      fs.cpSync(path.dirname(path.dirname(BIN)), copiedRuntime, { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: `node "${copiedBin}"` }, keep: true }));
      fs.writeFileSync(path.join(home, 'codebuddy-hud.config.json'), JSON.stringify({ theme: 'ocean' }));
      const before = snapshot(tempRoot);
      for (const command of [
        ['--setup'], ['--setup', '--theme', 'emerald'], ['--setup', '--footer', 'clean'], ['--uninstall'],
        ['--doctor'], ['-d'], ['--status'], ['--update'], ['--theme', 'emerald'], ['--footer', 'clean'],
      ]) {
        for (const args of [[...command, flag], [flag, ...command]]) {
          const label = args.join(' ');
          const r = await run({ args, env, bin: copiedBin });
          assert.equal(r.code, 0, label);
          assert.equal(r.err, '', label);
          assert.deepEqual(snapshot(tempRoot), before, `${label} modified the installation`);
          const helpRegex = command[0] === '--theme'
            ? /Available themes/
            : (command[0] === '--footer' ? /Available footer modes/ : /Usage:/);
          assert.match(r.out, isHelp ? helpRegex : /^codebuddy-hud v\d+\.\d+\.\d+\r?\n$/, label);
        }
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
}

test('--theme help lists themes without invoking the selector on a TTY', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-entry-theme-help-'));
  const copiedRuntime = path.join(tempRoot, 'runtime');
  const copiedBin = path.join(copiedRuntime, 'bin', 'codebuddy-hud.js');
  const env = { ...process.env, CODEBUDDY_HOME: tempRoot, CODEBUDDY_SETTINGS_PATH: path.join(tempRoot, 'settings.json') };
  try {
    fs.cpSync(path.dirname(path.dirname(BIN)), copiedRuntime, { recursive: true });
    for (const flag of ['--help', '-h']) {
      const script = `
        Object.defineProperty(process.stdin, 'isTTY', { value: true });
        Object.defineProperty(process.stdout, 'isTTY', { value: true });
        require(${JSON.stringify(path.join(copiedRuntime, 'theme-selector.js'))}).selectThemeInteractive = async () => {
          console.error('interactive selector must not run');
          return null;
        };
        process.argv = [process.execPath, ${JSON.stringify(copiedBin)}, '--theme', ${JSON.stringify(flag)}];
        require(${JSON.stringify(copiedBin)});
      `;
      const r = await run({ bin: '-e', args: [script], env });
      assert.equal(r.code, 0);
      assert.equal(r.err, '');
      assert.match(r.out, /Available themes/);
      assert.doesNotMatch(r.out, /--setup/);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('--footer CLI supports list, valid modes, invalid/sanitized modes, and help on TTY without selector', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-entry-footer-'));
  const copiedRuntime = path.join(tempRoot, 'runtime');
  const copiedBin = path.join(copiedRuntime, 'bin', 'codebuddy-hud.js');
  const settingsPath = path.join(tempRoot, 'settings.json');
  const env = { ...process.env, CODEBUDDY_HOME: tempRoot, CODEBUDDY_SETTINGS_PATH: settingsPath };
  try {
    fs.cpSync(path.dirname(path.dirname(BIN)), copiedRuntime, { recursive: true });

    const listRes = await run({ args: ['--footer', 'list'], env, bin: copiedBin });
    assert.equal(listRes.code, 0);
    assert.equal(listRes.err, '');
    assert.match(listRes.out, /Available footer modes/);

    // Non-TTY --footer with no argument falls back to listing
    const nonTtyRes = await run({ args: ['--footer'], env, bin: copiedBin });
    assert.equal(nonTtyRes.code, 0);
    assert.match(nonTtyRes.out, /Available footer modes/);

    const cleanRes = await run({ args: ['--footer', 'clean'], env, bin: copiedBin });
    assert.equal(cleanRes.code, 0);
    assert.equal(cleanRes.err, '');
    assert.match(cleanRes.out.replace(/\x1b\[[0-9;]*m/g, ''), /Host footer mode set to 'clean'/);
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).tui.statusLine, [
      'agents', 'shortcuts', 'permission', 'thinking', 'shells', 'context-remaining', 'tokens',
    ]);

    const offRes = await run({ args: ['--footer', 'off'], env, bin: copiedBin });
    assert.equal(offRes.code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).tui.statusLine, []);

    const fullRes = await run({ args: ['--footer', 'full'], env, bin: copiedBin });
    assert.equal(fullRes.code, 0);
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).tui, undefined);

    // Invalid and prototype/injection inputs exit 0, sanitize stderr, and leave settings untouched
    const beforeInvalid = fs.readFileSync(settingsPath, 'utf8');
    const evil = '\x1b]52;c;ZXZpbA==\x07\x1b[2J';
    for (const bad of ['nonexistent_footer', '__proto__', 'constructor', 'toString', '', evil]) {
      const badRes = await run({ args: ['--footer', bad], env, bin: copiedBin });
      assert.equal(badRes.code, 0);
      assert.match(badRes.err, /Unknown footer mode/);
      assert.ok(!badRes.err.includes('\x1b]52'));
      assert.ok(!badRes.err.includes('\x1b[2J'));
      assert.equal(fs.readFileSync(settingsPath, 'utf8'), beforeInvalid);
    }

    // --footer --help / -h on TTY lists modes without calling selectFooterInteractive
    for (const flag of ['--help', '-h']) {
      const script = `
        Object.defineProperty(process.stdin, 'isTTY', { value: true });
        Object.defineProperty(process.stdout, 'isTTY', { value: true });
        require(${JSON.stringify(path.join(copiedRuntime, 'footer-mode.js'))}).selectFooterInteractive = async () => {
          console.error('interactive footer selector must not run');
          return null;
        };
        process.argv = [process.execPath, ${JSON.stringify(copiedBin)}, '--footer', ${JSON.stringify(flag)}];
        require(${JSON.stringify(copiedBin)});
      `;
      const r = await run({ bin: '-e', args: [script], env });
      assert.equal(r.code, 0);
      assert.equal(r.err, '');
      assert.match(r.out, /Available footer modes/);
      assert.doesNotMatch(r.out, /--setup/);
    }

    // TTY --footer without args invokes selectFooterInteractive and saves selection (or no-ops on null)
    const beforeTtyCancel = fs.readFileSync(settingsPath, 'utf8');
    const ttyCancelScript = `
      Object.defineProperty(process.stdin, 'isTTY', { value: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true });
      require(${JSON.stringify(path.join(copiedRuntime, 'footer-mode.js'))}).selectFooterInteractive = async () => null;
      process.argv = [process.execPath, ${JSON.stringify(copiedBin)}, '--footer'];
      require(${JSON.stringify(copiedBin)});
    `;
    const ttyCancelRes = await run({ bin: '-e', args: [ttyCancelScript], env });
    assert.equal(ttyCancelRes.code, 0, ttyCancelRes.err);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), beforeTtyCancel);

    const ttyPickScript = `
      Object.defineProperty(process.stdin, 'isTTY', { value: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true });
      require(${JSON.stringify(path.join(copiedRuntime, 'footer-mode.js'))}).selectFooterInteractive = async () => 'clean';
      process.argv = [process.execPath, ${JSON.stringify(copiedBin)}, '--footer'];
      require(${JSON.stringify(copiedBin)});
    `;
    const ttyPickRes = await run({ bin: '-e', args: [ttyPickScript], env });
    assert.equal(ttyPickRes.code, 0, ttyPickRes.err);
    assert.match(ttyPickRes.out.replace(/\x1b\[[0-9;]*m/g, ''), /Host footer mode set to 'clean'/);
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).tui.statusLine.length, 7);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('--setup parses --footer, validates upfront, and prompts interactive footer selector in TTY', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-entry-setup-footer-'));
  const copiedRuntime = path.join(tempRoot, 'runtime');
  const copiedBin = path.join(copiedRuntime, 'bin', 'codebuddy-hud.js');
  const settingsPath = path.join(tempRoot, 'settings.json');
  const env = { ...process.env, CODEBUDDY_HOME: tempRoot, CODEBUDDY_SETTINGS_PATH: settingsPath };
  try {
    fs.cpSync(path.dirname(path.dirname(BIN)), copiedRuntime, { recursive: true });

    // Non-TTY --setup --footer clean configures both statusLine and tui.statusLine
    const setupClean = await run({ args: ['--setup', '--footer', 'clean'], env, bin: copiedBin });
    assert.equal(setupClean.code, 0);
    assert.equal(setupClean.err, '');
    const parsedClean = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(parsedClean.statusLine && parsedClean.statusLine.command);
    assert.ok(Array.isArray(parsedClean.tui && parsedClean.tui.statusLine));

    // Invalid, empty, or dangling --setup --footer aborts without modifying settings
    const beforeInvalid = fs.readFileSync(settingsPath, 'utf8');
    for (const badArgs of [['--setup', '--footer', 'bogus'], ['--setup', '--footer', ''], ['--setup', '--footer']]) {
      const setupInvalid = await run({ args: badArgs, env, bin: copiedBin });
      assert.equal(setupInvalid.code, 0);
      assert.match(setupInvalid.err, /setup failed/);
      assert.equal(fs.readFileSync(settingsPath, 'utf8'), beforeInvalid);
    }

    // TTY --setup prompts selectFooterInteractive after selectThemeInteractive; null keeps tui untouched
    fs.writeFileSync(settingsPath, '{"model":"keep"}');
    const cancelScript = `
      Object.defineProperty(process.stdin, 'isTTY', { value: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true });
      const calls = [];
      require(${JSON.stringify(path.join(copiedRuntime, 'theme-selector.js'))}).selectThemeInteractive = async () => {
        calls.push('theme');
        return 'emerald';
      };
      require(${JSON.stringify(path.join(copiedRuntime, 'footer-mode.js'))}).selectFooterInteractive = async () => {
        calls.push('footer');
        return null;
      };
      process.argv = [process.execPath, ${JSON.stringify(copiedBin)}, '--setup'];
      require(${JSON.stringify(copiedBin)});
      process.on('beforeExit', () => console.log('CALLS=' + JSON.stringify(calls)));
    `;
    const cancelRes = await run({ bin: '-e', args: [cancelScript], env });
    assert.equal(cancelRes.code, 0, cancelRes.err);
    assert.match(cancelRes.out, /CALLS=\["theme","footer"\]/);
    const afterCancel = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(afterCancel.tui, undefined);
    assert.equal(JSON.parse(fs.readFileSync(path.join(tempRoot, 'codebuddy-hud.config.json'), 'utf8')).theme, 'emerald');

    // TTY --setup selecting footer 'off' persists tui.statusLine = []
    const selectScript = `
      Object.defineProperty(process.stdin, 'isTTY', { value: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true });
      require(${JSON.stringify(path.join(copiedRuntime, 'theme-selector.js'))}).selectThemeInteractive = async () => null;
      require(${JSON.stringify(path.join(copiedRuntime, 'footer-mode.js'))}).selectFooterInteractive = async () => 'off';
      process.argv = [process.execPath, ${JSON.stringify(copiedBin)}, '--setup'];
      require(${JSON.stringify(copiedBin)});
    `;
    const selectRes = await run({ bin: '-e', args: [selectScript], env });
    assert.equal(selectRes.code, 0, selectRes.err);
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).tui.statusLine, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});


after(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});
