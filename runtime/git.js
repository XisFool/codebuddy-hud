'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getGitCachePath } = require('./paths');

// Pure parser for `git status --porcelain -b` output. Exported for tests.
function parseGitStatusOutput(out) {
  if (!out) return { branch: '', dirty: false };
  let branch = '';
  let dirty = false;
  for (const line of String(out).split('\n')) {
    if (line.startsWith('## ')) {
      let head = line.slice(3).trim();
      // unborn branch in a repo with zero commits: `## No commits yet on master`
      const unborn = 'No commits yet on ';
      if (head.startsWith(unborn)) head = head.slice(unborn.length);
      // detached: `## HEAD (no branch)` / `## HEAD (no branch, rebasing ...)`
      if (head === 'HEAD' || head.startsWith('HEAD (')) {
        const paren = head.indexOf(' (');
        branch = paren === -1 ? head : head.slice(0, paren);
      } else {
        // refs may not contain `..`, so the three-dot upstream separator is
        // unambiguous even for branch names containing spaces
        const dots = head.indexOf('...');
        branch = dots === -1 ? head : head.slice(0, dots);
      }
    } else if (line.trim()) {
      dirty = true;
    }
  }
  return { branch, dirty };
}

/**
 * Locate git directory and work tree by walking up parent directories.
 * Safely handles standard .git directories as well as worktrees / submodules
 * where .git is a text file pointing to gitdir: <path>.
 * @param {string} cwd
 * @returns {{ gitDir: string, workTree: string } | null}
 */
const _nonGitDirs = new Map();

function findGitInfo(cwd) {
  try {
    let current = path.resolve(cwd);
    const now = Date.now();
    const cachedNeg = _nonGitDirs.get(current);
    if (cachedNeg && (now - cachedNeg < 5000)) return null;

    const root = path.parse(current).root;
    while (current) {
      const gitCandidate = path.join(current, '.git');
      if (fs.existsSync(gitCandidate)) {
        const stat = fs.statSync(gitCandidate);
        if (stat.isDirectory()) {
          return { gitDir: gitCandidate, workTree: current };
        }
        if (stat.isFile()) {
          const content = fs.readFileSync(gitCandidate, 'utf8').trim();
          const match = /^gitdir:\s*(.+)$/m.exec(content);
          if (match) {
            const target = match[1].trim();
            const resolvedGitDir = path.isAbsolute(target) ? target : path.resolve(current, target);
            return { gitDir: resolvedGitDir, workTree: current };
          }
        }
      }
      if (current === root) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    _nonGitDirs.set(path.resolve(cwd), now);
  } catch {
    return null;
  }
  return null;
}

/**
 * Zero-spawn branch resolution directly reading .git/HEAD (<0.1ms).
 * Handles regular branches, tags, and detached HEAD (commit hash).
 * @param {string} gitDir
 * @returns {string | null}
 */
function readDirectBranch(gitDir) {
  try {
    const headPath = path.join(gitDir, 'HEAD');
    if (!fs.existsSync(headPath)) return null;
    const content = fs.readFileSync(headPath, 'utf8').trim();
    if (!content) return null;
    if (content.startsWith('ref: ')) {
      const ref = content.slice(5).trim();
      if (ref.startsWith('refs/heads/')) {
        return ref.slice('refs/heads/'.length);
      }
      return ref;
    }
    // 40-char commit SHA in detached HEAD: return 7-char short hash
    if (/^[0-9a-f]{40}$/i.test(content)) {
      return content.slice(0, 7);
    }
    return content.slice(0, 7);
  } catch {
    return null;
  }
}

function getFileMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function readGitCache() {
  try {
    const cachePath = getGitCachePath();
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (data && typeof data === 'object') return data;
    }
  } catch {
    // ignore
  }
  return {};
}

function writeGitCache(cache) {
  const cachePath = getGitCachePath();
  const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(cache));
    fs.renameSync(tmpPath, cachePath);
  } catch {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

/**
 * Get current git branch and dirty status with zero-spawn optimization,
 * mtime invalidation cache, and child_process fallback.
 * @param {string} cwd Working directory
 * @param {number} timeoutMs Maximum time to wait in ms (default 200)
 * @returns {{ branch: string, dirty: boolean | null } | null}
 */
function getGitStatus(cwd, timeoutMs = 200) {
  if (!cwd || typeof cwd !== 'string' || cwd.includes('\0')) return null;

  const resolvedCwd = path.resolve(cwd);
  const gitInfo = findGitInfo(resolvedCwd);
  if (!gitInfo) return null;

  const { gitDir, workTree } = gitInfo;
  const headPath = path.join(gitDir, 'HEAD');
  const indexPath = path.join(gitDir, 'index');

  const headMtime = getFileMtime(headPath);
  const indexMtime = getFileMtime(indexPath);
  const directBranch = readDirectBranch(gitDir);

  const noCache = process.env.CODEBUDDY_HUD_NO_GIT_CACHE === '1';
  const now = Date.now();

  if (!noCache) {
    const cache = readGitCache();
    const entry = cache[workTree];
    if (
      entry &&
      typeof entry === 'object' &&
      typeof entry.branch === 'string' &&
      (entry.dirty === null || typeof entry.dirty === 'boolean') &&
      entry.headMtime === headMtime &&
      entry.indexMtime === indexMtime &&
      now - entry.timestamp < 10000
    ) {
      return {
        branch: directBranch || entry.branch,
        dirty: entry.dirty,
      };
    }
  }

  try {
    const execOpts = {
      cwd: resolvedCwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
      env: Object.assign({}, process.env, { GIT_OPTIONAL_LOCKS: '0' }),
    };

    let out;
    try {
      out = execSync('git status --porcelain -b', execOpts);
    } catch {
      if (directBranch) {
        if (!noCache) {
          try {
            const cache = readGitCache();
            cache[workTree] = {
              branch: directBranch,
              dirty: null,
              headMtime,
              indexMtime,
              timestamp: now,
            };
            writeGitCache(cache);
          } catch {}
        }
        return { branch: directBranch, dirty: null };
      }
      return null;
    }

    const { branch: parsedBranch, dirty } = parseGitStatusOutput(out);
    let branch = parsedBranch || directBranch;
    if (!branch) return null;

    if (branch === 'HEAD') {
      if (directBranch && directBranch !== 'HEAD') {
        branch = directBranch;
      } else {
        try {
          branch = execSync('git rev-parse --short HEAD', execOpts).trim();
        } catch {
          branch = 'detached';
        }
      }
    }

    const result = { branch, dirty };

    if (!noCache) {
      try {
        const cache = readGitCache();
        cache[workTree] = {
          branch,
          dirty,
          headMtime,
          indexMtime,
          timestamp: now,
        };
        writeGitCache(cache);
      } catch {
        // ignore
      }
    }

    return result;
  } catch {
    if (directBranch) return { branch: directBranch, dirty: null };
    return null;
  }
}

module.exports = {
  getGitStatus,
  parseGitStatusOutput,
  findGitInfo,
  readDirectBranch,
};
