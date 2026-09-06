import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { getTargetDir, checkNodeVersion } = require('../../scripts/bootstrap.js');

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
});
