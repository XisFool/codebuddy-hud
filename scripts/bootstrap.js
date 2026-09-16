'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const REPO_RAW_ROOT = 'https://raw.githubusercontent.com/XisFool/codebuddy-hud';
const RELEASES_LATEST_URL = 'https://github.com/XisFool/codebuddy-hud/releases/latest';
const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/XisFool/codebuddy-hud/releases/latest';

// `CODEBUDDY_HUD_MIRROR` (e.g. `https://your-mirror`) is prepended to every
// GitHub URL this script resolves itself — the release-tag lookup included,
// since it does not share a host with the raw downloads. Each URL keeps its
// un-mirrored form as a fallback, so a mirror that fails to proxy one of the
// hosts degrades to a direct request instead of failing the whole install.
function mirrorPrefix() {
  const raw = (process.env.CODEBUDDY_HUD_MIRROR || '').trim();
  if (!raw) return '';
  const withoutHash = raw.split('#')[0].trim();
  return withoutHash.replace(/\/+$/, '');
}

function urlCandidates(url) {
  const mirror = mirrorPrefix();
  return mirror ? [`${mirror}/${url}`, url] : [url];
}

const RUNTIME_FILES = [
  'package.json',
  '.codebuddy-plugin/plugin.json',
  'runtime/codebuddy-hud.config.json',
  'runtime/config.js',
  'runtime/doctor.js',
  'runtime/encoding.js',
  'runtime/git.js',
  'runtime/lang.js',
  'runtime/model-info.js',
  'runtime/parser.js',
  'runtime/paths.js',
  'runtime/renderer.js',
  'runtime/renderer/agents-render.js',
  'runtime/renderer/diff-render.js',
  'runtime/renderer/format.js',
  'runtime/sanitize.js',
  'runtime/session-stats.js',
  'runtime/settings-file.js',
  'runtime/statusline-installer.js',
  'runtime/theme-selector.js',
  'runtime/transcript.js',
  'runtime/uninstall.js',
  'runtime/update-checker.js',
  'runtime/bin/codebuddy-hud.js',
  'skills/hud-config/SKILL.md',
];

function getTargetDir() {
  if (process.env.CODEBUDDY_HUD_DIR) {
    return path.resolve(process.env.CODEBUDDY_HUD_DIR);
  }
  const home = process.env.CODEBUDDY_HOME || path.join(os.homedir(), '.codebuddy');
  return path.join(home, 'codebuddy-hud-runtime');
}

function checkNodeVersion() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    console.error(`\x1b[31m✖ Node.js version v${process.versions.node} is too old. codebuddy-hud requires Node.js >= 18.0.0.\x1b[0m`);
    process.exit(1);
  }
}

function fetchUrl(url, redirectCount = 0, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error(`Too many redirects fetching ${url}`));
    }
    const client = url.startsWith('https') ? https : http;
    const headers = { 'User-Agent': 'codebuddy-hud-bootstrap', ...extraHeaders };
    const req = client.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        // Never carry credentials across an origin boundary.
        const carried = new URL(nextUrl).origin === new URL(url).origin ? extraHeaders : {};
        return resolve(fetchUrl(nextUrl, redirectCount + 1, carried));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} when fetching ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
  });
}

async function fetchUrlWithRetry(url, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchUrl(url);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delaySec = Math.pow(2, attempt - 1);
        process.stderr.write(`  \u26a0 Attempt ${attempt} failed (${err.message}), retrying in ${delaySec}s...\n`);
        await new Promise(r => setTimeout(r, delaySec * 1000));
      }
    }
  }
  throw lastErr;
}

function fetchLatestTagVia302(url) {
  const target = url || urlCandidates(RELEASES_LATEST_URL)[0];
  return new Promise((resolve, reject) => {
    const client = target.startsWith('https') ? https : http;
    const req = client.get(target, {
      headers: { 'User-Agent': 'codebuddy-hud-bootstrap' },
    }, (res) => {
      res.resume();
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const match = res.headers.location.match(/\/releases\/tag\/([^/]+)$/);
        if (match) return resolve(decodeURIComponent(match[1]));
      }
      reject(new Error(`Failed to resolve latest tag via redirect (HTTP ${res.statusCode})`));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Timeout resolving latest release tag'));
    });
  });
}

function rawBaseForTag(tag) {
  const normalized = typeof tag === 'string' ? tag.trim() : '';
  if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  return `${REPO_RAW_ROOT}/${encodeURIComponent(normalized)}`;
}

async function fetchLatestRelease(options = {}) {
  // Strategy 1: 302 redirect (no API rate limit)
  const candidates302 = options.candidates302 || urlCandidates(RELEASES_LATEST_URL);
  for (const candidate of candidates302) {
    try {
      return { tag_name: await fetchLatestTagVia302(candidate) };
    } catch {
      // Try the next candidate, then fall through to the API.
    }
  }
  // Strategy 2: GitHub REST API (with optional token for higher rate limit).
  // An explicit CODEBUDDY_HUD_LATEST_RELEASE_URL wins outright and is used
  // verbatim; otherwise the API URL is mirrored like every other GitHub URL.
  const explicitApiUrl = process.env.CODEBUDDY_HUD_LATEST_RELEASE_URL;
  const apiCandidates = options.apiCandidates || (explicitApiUrl ? [explicitApiUrl] : urlCandidates(LATEST_RELEASE_API_URL));
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  let lastErr;
  for (const candidate of apiCandidates) {
    // The token belongs to GitHub; a mirror host must never receive it.
    const headers = candidate === LATEST_RELEASE_API_URL && token
      ? { Authorization: `token ${token}` }
      : {};
    let body;
    try {
      body = await fetchUrl(candidate, 0, headers);
    } catch (err) {
      lastErr = err;
      continue;
    }
    try {
      const parsed = JSON.parse(body.toString('utf8'));
      if (parsed && typeof parsed.tag_name === 'string' && parsed.tag_name.trim()) {
        return parsed;
      }
      lastErr = new Error(`Latest release response from ${candidate} did not contain a valid tag_name`);
      continue;
    } catch {
      lastErr = new Error(`Latest release response from ${candidate} was not valid JSON`);
      continue;
    }
  }
  throw lastErr || new Error('Could not resolve the latest release');
}

async function resolveRemoteRawBase(options = {}) {
  if (process.env.CODEBUDDY_HUD_RAW_BASE) {
    return process.env.CODEBUDDY_HUD_RAW_BASE.replace(/\/+$/, '');
  }
  const mirror = mirrorPrefix();
  if (process.env.CODEBUDDY_HUD_VERSION) {
    const base = rawBaseForTag(process.env.CODEBUDDY_HUD_VERSION);
    return mirror ? `${mirror}/${base}` : base;
  }
  const release = await (options.fetchLatestRelease || fetchLatestRelease)();
  const base = rawBaseForTag(release?.tag_name);
  return mirror ? `${mirror}/${base}` : base;
}

function copyDirRecursiveSync(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function install() {
  checkNodeVersion();
  const targetDir = getTargetDir();
  const targetParent = path.dirname(targetDir);
  if (!fs.existsSync(targetParent)) {
    fs.mkdirSync(targetParent, { recursive: true });
  }

  const tmpDir = `${targetDir}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`\x1b[36m🚀 Installing codebuddy-hud to:\x1b[0m ${targetDir}`);

  // Check if we are running from a local checkout containing the runtime directory
  const localRepoRoot = path.resolve(__dirname, '..');
  const isLocalCheckout = fs.existsSync(path.join(localRepoRoot, 'runtime', 'bin', 'codebuddy-hud.js'));

  try {
    if (isLocalCheckout) {
      console.log('  Mode: Local repository copy');
      const filesToCopy = ['package.json', 'README.md'];
      for (const f of filesToCopy) {
        const src = path.join(localRepoRoot, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(tmpDir, f));
        }
      }
      copyDirRecursiveSync(path.join(localRepoRoot, 'runtime'), path.join(tmpDir, 'runtime'));
      const extraDirs = ['.codebuddy-plugin', 'skills'];
      for (const d of extraDirs) {
        const src = path.join(localRepoRoot, d);
        if (fs.existsSync(src)) {
          copyDirRecursiveSync(src, path.join(tmpDir, d));
        }
      }
    } else {
      const remoteRawBase = await resolveRemoteRawBase();
      console.log(`  Mode: Remote download from GitHub (${remoteRawBase})`);
      for (const relPath of RUNTIME_FILES) {
        const fileUrl = `${remoteRawBase}/${relPath}`;
        process.stdout.write(`  ↓ Fetching ${relPath}...`);
        const content = await fetchUrlWithRetry(fileUrl);
        const destPath = path.join(tmpDir, relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, content);
        process.stdout.write(` \x1b[32mOK\x1b[0m\n`);
      }
    }

    // Verify key runtime files in tmpDir
    const mainBin = path.join(tmpDir, 'runtime', 'bin', 'codebuddy-hud.js');
    if (!fs.existsSync(mainBin)) {
      throw new Error(`Validation failed: ${mainBin} missing after download/copy`);
    }

    // Atomic replace target directory
    const oldBackupDir = `${targetDir}.old-${process.pid}-${Date.now()}`;
    if (fs.existsSync(targetDir)) {
      try {
        fs.renameSync(targetDir, oldBackupDir);
      } catch (err) {
        // Fallback on systems where renameSync might fail due to open locks
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    }

    try {
      fs.renameSync(tmpDir, targetDir);
    } catch (renameErr) {
      // If rename fails, copy recursively and remove tmp
      copyDirRecursiveSync(tmpDir, targetDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    if (fs.existsSync(oldBackupDir)) {
      try {
        fs.rmSync(oldBackupDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failure for old backup
      }
    }

    // Configure statusLine in settings.json
    const installerPath = path.join(targetDir, 'runtime', 'statusline-installer.js');
    const installer = require(installerPath);
    installer.setup({
      runtimeDir: path.join(targetDir, 'runtime'),
      hudBin: path.join(targetDir, 'runtime', 'bin', 'codebuddy-hud.js'),
    });

    console.log('\n\x1b[32m✔ codebuddy-hud successfully installed and configured!\x1b[0m');
    console.log('  Restart CodeBuddy or start a new session to see your new HUD.');
  } catch (err) {
    console.error(`\n\x1b[31m✖ Installation failed: ${err.message}\x1b[0m`);
    if (fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
    process.exit(1);
  }
}

if (require.main === module) {
  install();
}

module.exports = {
  install,
  getTargetDir,
  checkNodeVersion,
  rawBaseForTag,
  resolveRemoteRawBase,
  fetchLatestTagVia302,
  fetchLatestRelease,
  mirrorPrefix,
};
