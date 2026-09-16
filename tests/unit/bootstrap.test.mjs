import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  getTargetDir,
  checkNodeVersion,
  rawBaseForTag,
  resolveRemoteRawBase,
  fetchLatestTagVia302,
  fetchLatestRelease,
  mirrorPrefix,
} = require('../../scripts/bootstrap.js');

describe('bootstrap installer', () => {
  test('checkNodeVersion runs cleanly on current node', () => {
    assert.doesNotThrow(() => {
      checkNodeVersion();
    });
  });

  test('getTargetDir prioritizes CODEBUDDY_HUD_DIR when set', () => {
    const originalEnv = process.env.CODEBUDDY_HUD_DIR;
    try {
      process.env.CODEBUDDY_HUD_DIR = '/custom/test/hud-runtime';
      const dir = getTargetDir();
      assert.ok(dir.includes('custom'));
    } finally {
      if (originalEnv === undefined) delete process.env.CODEBUDDY_HUD_DIR;
      else process.env.CODEBUDDY_HUD_DIR = originalEnv;
    }
  });

  test('uses immutable release tags for remote download sources', async () => {
    assert.equal(
      rawBaseForTag('v0.1.0'),
      'https://raw.githubusercontent.com/XisFool/codebuddy-hud/v0.1.0'
    );
    assert.throws(() => rawBaseForTag('master'));
    assert.equal(
      await resolveRemoteRawBase({ fetchLatestRelease: async () => ({ tag_name: 'v0.2.0' }) }),
      'https://raw.githubusercontent.com/XisFool/codebuddy-hud/v0.2.0'
    );
  });

  test('fetchLatestTagVia302 parses the tag out of a 302 Location header', async () => {
    const http = require('http');
    const server = http.createServer((req, res) => {
      if (req.url === '/tag') {
        res.writeHead(302, { Location: 'https://github.com/XisFool/codebuddy-hud/releases/tag/v1.2.3' });
      } else if (req.url === '/no-tag') {
        res.writeHead(302, { Location: 'https://github.com/XisFool/codebuddy-hud/releases' });
      } else {
        res.writeHead(200);
      }
      res.end();
    });
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      assert.equal(await fetchLatestTagVia302(`${base}/tag`), 'v1.2.3');
      await assert.rejects(() => fetchLatestTagVia302(`${base}/no-tag`), /Failed to resolve latest tag/);
      await assert.rejects(() => fetchLatestTagVia302(`${base}/ok`), /Failed to resolve latest tag/);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('resolveRemoteRawBase prepends CODEBUDDY_HUD_MIRROR to raw base', async () => {
    const saved = process.env.CODEBUDDY_HUD_MIRROR;
    try {
      process.env.CODEBUDDY_HUD_MIRROR = 'https://mirror.example';
      const result = await resolveRemoteRawBase({
        fetchLatestRelease: async () => ({ tag_name: 'v0.3.0' }),
      });
      assert.equal(
        result,
        'https://mirror.example/https://raw.githubusercontent.com/XisFool/codebuddy-hud/v0.3.0'
      );
    } finally {
      if (saved === undefined) delete process.env.CODEBUDDY_HUD_MIRROR;
      else process.env.CODEBUDDY_HUD_MIRROR = saved;
    }
  });

  test('resolveRemoteRawBase without mirror returns plain raw base', async () => {
    const saved = process.env.CODEBUDDY_HUD_MIRROR;
    try {
      delete process.env.CODEBUDDY_HUD_MIRROR;
      const result = await resolveRemoteRawBase({
        fetchLatestRelease: async () => ({ tag_name: 'v0.2.0' }),
      });
      assert.equal(
        result,
        'https://raw.githubusercontent.com/XisFool/codebuddy-hud/v0.2.0'
      );
    } finally {
      if (saved === undefined) delete process.env.CODEBUDDY_HUD_MIRROR;
      else process.env.CODEBUDDY_HUD_MIRROR = saved;
    }
  });

  test('mirrorPrefix trims whitespace and strips hash fragments', () => {
    const saved = process.env.CODEBUDDY_HUD_MIRROR;
    try {
      process.env.CODEBUDDY_HUD_MIRROR = '  https://mirror.example/#frag/  ';
      assert.equal(mirrorPrefix(), 'https://mirror.example');
      process.env.CODEBUDDY_HUD_MIRROR = '   ';
      assert.equal(mirrorPrefix(), '');
      delete process.env.CODEBUDDY_HUD_MIRROR;
      assert.equal(mirrorPrefix(), '');
    } finally {
      if (saved === undefined) delete process.env.CODEBUDDY_HUD_MIRROR;
      else process.env.CODEBUDDY_HUD_MIRROR = saved;
    }
  });

  test('fetchLatestRelease falls back to next API candidate on 200 HTML or missing tag_name', async () => {
    const http = require('http');
    const server = http.createServer((req, res) => {
      if (req.url === '/html-error') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>Proxy Error</body></html>');
      } else if (req.url === '/no-tag') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      } else if (req.url === '/valid-tag') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tag_name: 'v1.5.0' }));
      } else {
        res.writeHead(404).end();
      }
    });

    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const base = `http://127.0.0.1:${server.address().port}`;

      // Candidate 1 returns 200 HTML, Candidate 2 returns valid tag
      const res1 = await fetchLatestRelease({
        candidates302: [],
        apiCandidates: [`${base}/html-error`, `${base}/valid-tag`],
      });
      assert.equal(res1.tag_name, 'v1.5.0');

      // Candidate 1 returns JSON without tag_name, Candidate 2 returns valid tag
      const res2 = await fetchLatestRelease({
        candidates302: [],
        apiCandidates: [`${base}/no-tag`, `${base}/valid-tag`],
      });
      assert.equal(res2.tag_name, 'v1.5.0');

      // All candidates return 200 HTML -> throws error
      await assert.rejects(
        () => fetchLatestRelease({
          candidates302: [],
          apiCandidates: [`${base}/html-error`],
        }),
        /was not valid JSON/
      );
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('install copies local repo files and configures statusline in isolated environment', async () => {
    const fs = require('fs');
    const os = require('os');
    const { install } = require('../../scripts/bootstrap.js');
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-boot-test-'));
    const targetDir = path.join(testRoot, 'runtime-target');
    const testHome = path.join(testRoot, 'home');
    const settingsFile = path.join(testHome, 'settings.json');
    fs.mkdirSync(testHome, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({}));

    const savedEnv = {
      CODEBUDDY_HUD_DIR: process.env.CODEBUDDY_HUD_DIR,
      CODEBUDDY_HOME: process.env.CODEBUDDY_HOME,
      CODEBUDDY_SETTINGS_PATH: process.env.CODEBUDDY_SETTINGS_PATH,
    };
    try {
      process.env.CODEBUDDY_HUD_DIR = targetDir;
      process.env.CODEBUDDY_HOME = testHome;
      process.env.CODEBUDDY_SETTINGS_PATH = settingsFile;

      await install();

      assert.ok(fs.existsSync(path.join(targetDir, 'runtime', 'bin', 'codebuddy-hud.js')));
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      assert.ok(settings.statusLine);
      assert.ok(settings.statusLine.command);
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('standalone bootstrap downloads a complete runtime and supports uninstall', async () => {
    const fs = require('fs');
    const os = require('os');
    const http = require('http');
    const { spawn } = require('child_process');
    const repoRoot = path.dirname(path.dirname(require.resolve('../../scripts/bootstrap.js')));
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-remote-install-'));
    const standalone = path.join(testRoot, 'standalone', 'scripts', 'bootstrap.js');
    const targetDir = path.join(testRoot, 'installed');
    const testHome = path.join(testRoot, 'home');
    const settingsPath = path.join(testHome, 'settings.json');
    const requests = [];
    const server = http.createServer((req, res) => {
      const relative = new URL(req.url, 'http://localhost').pathname.slice(1);
      const source = path.resolve(repoRoot, relative);
      if (!source.startsWith(repoRoot + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      try {
        const content = fs.readFileSync(source);
        requests.push(relative);
        res.end(content);
      } catch {
        res.writeHead(404).end();
      }
    });
    try {
      fs.mkdirSync(path.dirname(standalone), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, 'scripts', 'bootstrap.js'), standalone);
      fs.mkdirSync(testHome);
      fs.writeFileSync(settingsPath, JSON.stringify({ model: 'retained' }));
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const env = {
        ...process.env,
        CODEBUDDY_HOME: testHome,
        CODEBUDDY_SETTINGS_PATH: settingsPath,
        CODEBUDDY_HUD_DIR: targetDir,
        CODEBUDDY_HUD_RAW_BASE: `http://127.0.0.1:${server.address().port}`,
        CODEBUDDY_HUD_NO_UPDATE_CHECK: '1',
      };
      const run = (bin, args = []) => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [bin, ...args], {
          cwd: testRoot, env, windowsHide: true, timeout: 15000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        child.once('error', reject);
        child.once('close', code => resolve({ code, output }));
      });
      const installed = await run(standalone);
      assert.equal(installed.code, 0, installed.output);
      assert.match(installed.output, /Mode: Remote download/);
      assert.ok(requests.includes('runtime/settings-file.js'));
      assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).model, 'retained');
      assert.ok(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).statusLine.command);
      const removed = await run(path.join(targetDir, 'runtime', 'bin', 'codebuddy-hud.js'), ['--uninstall']);
      assert.equal(removed.code, 0, removed.output);
      assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), { model: 'retained' });
    } finally {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  // The raw downloads and the release-tag lookup live on different GitHub
  // hosts, so a mirror prefix that only covers `raw.githubusercontent.com`
  // leaves the tag lookup hitting a blocked host. This drives the real install
  // path and asserts the mirror receives the `releases/latest` request.
  test('CODEBUDDY_HUD_MIRROR covers the release-tag lookup, not just raw downloads', async () => {
    const fs = require('fs');
    const os = require('os');
    const http = require('http');
    const { spawn } = require('child_process');
    const repoRoot = path.dirname(path.dirname(require.resolve('../../scripts/bootstrap.js')));
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-mirror-discovery-'));
    const standalone = path.join(testRoot, 'standalone', 'scripts', 'bootstrap.js');
    const targetDir = path.join(testRoot, 'installed');
    const testHome = path.join(testRoot, 'home');
    const settingsPath = path.join(testHome, 'settings.json');
    const LATEST_PATH = 'https://github.com/XisFool/codebuddy-hud/releases/latest';
    const RAW_PREFIX = 'https://raw.githubusercontent.com/XisFool/codebuddy-hud/v0.0.0/';
    const requests = [];
    // A mirror proxy sees the original GitHub URL as the request path.
    const server = http.createServer((req, res) => {
      const proxied = req.url.replace(/^\//, '');
      requests.push(proxied);
      if (proxied === LATEST_PATH) {
        res.writeHead(302, { Location: 'https://github.com/XisFool/codebuddy-hud/releases/tag/v0.0.0' });
        res.end();
        return;
      }
      if (!proxied.startsWith(RAW_PREFIX)) {
        res.writeHead(404).end();
        return;
      }
      const source = path.resolve(repoRoot, proxied.slice(RAW_PREFIX.length));
      if (!source.startsWith(repoRoot + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      try {
        res.end(fs.readFileSync(source));
      } catch {
        res.writeHead(404).end();
      }
    });
    try {
      fs.mkdirSync(path.dirname(standalone), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, 'scripts', 'bootstrap.js'), standalone);
      fs.mkdirSync(testHome);
      fs.writeFileSync(settingsPath, JSON.stringify({ model: 'retained' }));
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const env = {
        ...process.env,
        CODEBUDDY_HOME: testHome,
        CODEBUDDY_SETTINGS_PATH: settingsPath,
        CODEBUDDY_HUD_DIR: targetDir,
        CODEBUDDY_HUD_MIRROR: `http://127.0.0.1:${server.address().port}`,
        CODEBUDDY_HUD_NO_UPDATE_CHECK: '1',
      };
      // No CODEBUDDY_HUD_RAW_BASE / CODEBUDDY_HUD_VERSION: tag discovery must run.
      delete env.CODEBUDDY_HUD_RAW_BASE;
      delete env.CODEBUDDY_HUD_VERSION;
      const output = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [standalone], {
          cwd: testRoot, env, windowsHide: true, timeout: 20000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let collected = '';
        child.stdout.on('data', chunk => { collected += chunk; });
        child.stderr.on('data', chunk => { collected += chunk; });
        child.once('error', reject);
        child.once('close', code => resolve({ code, collected }));
      });
      assert.equal(output.code, 0, output.collected);
      assert.ok(
        requests.includes(LATEST_PATH),
        `the mirror must receive the release-tag lookup; saw: ${JSON.stringify(requests.slice(0, 5))}`,
      );
      assert.ok(requests.some(u => u.startsWith(RAW_PREFIX)), 'runtime files must come from the mirror');
      assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).model, 'retained');
      assert.ok(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).statusLine.command);
    } finally {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });
});
