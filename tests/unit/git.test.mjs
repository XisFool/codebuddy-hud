import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';

import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { getGitStatus, parseGitStatusOutput, findGitInfo, readDirectBranch } = require('../../runtime/git.js');

describe('parseGitStatusOutput', () => {
  test('clean repo: branch only, not dirty', () => {
    const r = parseGitStatusOutput('## main...origin/main\n');
    assert.deepEqual(r, { branch: 'main', dirty: false });
  });

  test('dirty repo: changed files make dirty=true', () => {
    const r = parseGitStatusOutput('## main\n M a.js\n?? b.txt\n');
    assert.deepEqual(r, { branch: 'main', dirty: true });
  });

  test('branch without upstream', () => {
    const r = parseGitStatusOutput('## feature/x\n');
    assert.equal(r.branch, 'feature/x');
  });

  test('branch with ahead/behind markers', () => {
    const r = parseGitStatusOutput('## main...origin/main [ahead 1, behind 2]\n');
    assert.equal(r.branch, 'main');
  });

  test('detached HEAD (no branch)', () => {
    const r = parseGitStatusOutput('## HEAD (no branch)\n');
    assert.equal(r.branch, 'HEAD');
  });

  test('detached HEAD mid-rebase', () => {
    const r = parseGitStatusOutput('## HEAD (no branch, rebasing branch-x)\n M f.js\n');
    assert.deepEqual(r, { branch: 'HEAD', dirty: true });
  });

  test('branch names containing spaces survive upstream stripping', () => {
    const r = parseGitStatusOutput('## my branch...origin/my branch\n');
    assert.equal(r.branch, 'my branch');
  });

  test('empty header line yields empty branch', () => {
    const r = parseGitStatusOutput('\n\n');
    assert.equal(r.branch, '');
  });

  test('unborn branch in a repo with zero commits', () => {
    const r = parseGitStatusOutput('## No commits yet on master\n');
    assert.equal(r.branch, 'master');
    assert.equal(r.dirty, false);
  });

  test('null/undefined input degrades to empty result instead of a phantom dirty line', () => {
    assert.deepEqual(parseGitStatusOutput(null), { branch: '', dirty: false });
    assert.deepEqual(parseGitStatusOutput(undefined), { branch: '', dirty: false });
    assert.deepEqual(parseGitStatusOutput(''), { branch: '', dirty: false });
  });
});

describe('getGitStatus', () => {
  test('returns null for null or empty cwd', () => {
    assert.equal(getGitStatus(null), null);
    assert.equal(getGitStatus(''), null);
    assert.equal(getGitStatus(undefined), null);
  });

  test('returns null for non-git directory', () => {
    const tmpDir = os.tmpdir();
    // tmpdir might or might not be a git repo, but a random subfolder definitely is not
    const randomDir = `${tmpDir}/codebuddy-test-non-git-${Date.now()}`;
    assert.equal(getGitStatus(randomDir), null);
  });

  test('returns branch info for git repository', () => {
    const result = getGitStatus(REPO_ROOT, 1000);
    assert.ok(result !== null, 'git status must not be null in a git repository');
    assert.equal(typeof result.branch, 'string');
    assert.ok(result.branch.length > 0);
    assert.ok(typeof result.dirty === 'boolean' || result.dirty === null);
  });

  test('respects small timeout without crashing', () => {
    const result = getGitStatus(REPO_ROOT, 1); // 1ms might timeout or succeed
    if (result !== null) {
      assert.equal(typeof result, 'object');
      assert.equal(typeof result.branch, 'string');
      assert.ok(result.dirty === null || typeof result.dirty === 'boolean');
    } else {
      assert.equal(result, null);
    }
  });

  test('findGitInfo locates .git directory in current and parent dirs', () => {
    const info = findGitInfo(REPO_ROOT);
    assert.ok(info !== null);
    assert.ok(typeof info.gitDir === 'string');
    assert.ok(typeof info.workTree === 'string');
  });

  test('findGitInfo handles git worktree file format', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-worktree-test-'));
    try {
      const fakeGitDir = path.join(tmp, 'actual-git-dir');
      fs.mkdirSync(fakeGitDir, { recursive: true });
      fs.writeFileSync(path.join(fakeGitDir, 'HEAD'), 'ref: refs/heads/feature-wt\n');

      const fakeWorkTree = path.join(tmp, 'wt');
      fs.mkdirSync(fakeWorkTree, { recursive: true });
      fs.writeFileSync(path.join(fakeWorkTree, '.git'), `gitdir: ${fakeGitDir}\n`);

      const info = findGitInfo(fakeWorkTree);
      assert.ok(info !== null);
      assert.equal(path.resolve(info.gitDir), path.resolve(fakeGitDir));
      assert.equal(path.resolve(info.workTree), path.resolve(fakeWorkTree));

      const branch = readDirectBranch(info.gitDir);
      assert.equal(branch, 'feature-wt');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('readDirectBranch handles detached commit hash', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-head-test-'));
    try {
      fs.writeFileSync(path.join(tmp, 'HEAD'), 'abcdef1234567890abcdef1234567890abcdef12\n');
      const branch = readDirectBranch(tmp);
      assert.equal(branch, 'abcdef1');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('getGitStatus uses cache for consecutive calls within TTL', () => {
    const res1 = getGitStatus(REPO_ROOT, 1000);
    assert.ok(res1 !== null);
    const start = Date.now();
    const res2 = getGitStatus(REPO_ROOT, 1000);
    const duration = Date.now() - start;
    assert.deepEqual(res2, res1);
    assert.ok(duration < 50, `cached lookup took ${duration}ms, expected < 50ms`);
  });

  test('CODEBUDDY_HUD_NO_GIT_CACHE bypasses cache', () => {
    const orig = process.env.CODEBUDDY_HUD_NO_GIT_CACHE;
    process.env.CODEBUDDY_HUD_NO_GIT_CACHE = '1';
    try {
      const res = getGitStatus(REPO_ROOT, 1000);
      assert.ok(res !== null);
    } finally {
      if (orig === undefined) delete process.env.CODEBUDDY_HUD_NO_GIT_CACHE;
      else process.env.CODEBUDDY_HUD_NO_GIT_CACHE = orig;
    }
  });
});
