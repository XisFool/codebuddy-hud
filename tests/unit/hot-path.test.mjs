import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function runChild(script, env) {
  return spawnSync(process.execPath, ['-e', script], {
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, env || {}),
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
}

test('loading the render hot path does not require child_process', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-hot-path-'));
  try {
    const script = `
      const Module = require('module');
      const originalLoad = Module._load;
      let loaded = false;
      Module._load = function (request) {
        if (request === 'child_process' || request === 'node:child_process') loaded = true;
        return originalLoad.apply(this, arguments);
      };
      require('./runtime/renderer');
      const { supportsUnicode } = require('./runtime/encoding');
      supportsUnicode();
      process.stdout.write(JSON.stringify({ loaded }));
    `;
    const res = runChild(script, {
      CODEBUDDY_HOME: home,
      CODEBUDDY_HUD_FORCE_UNICODE: '1',
    });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { loaded: false });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('git status spawn bypasses the shell on win32', { skip: process.platform !== 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-hot-path-'));
  try {
    const script = `
      const { getGitStatus } = require('./runtime/git');
      process.stdout.write(JSON.stringify(getGitStatus(process.cwd(), 5000)));
    `;
    const res = runChild(script, {
      CODEBUDDY_HOME: home,
      CODEBUDDY_HUD_NO_GIT_CACHE: '1',
      // execSync resolves through ComSpec; execFileSync must not touch it.
      ComSpec: 'Z:/codebuddy-hud-no-such-shell.exe',
    });
    assert.equal(res.status, 0, res.stderr);
    const status = JSON.parse(res.stdout);
    assert.ok(status && typeof status.branch === 'string' && status.branch.length > 0, res.stdout);
    assert.equal(typeof status.dirty, 'boolean', 'git status must not fall back to directBranch-only');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
