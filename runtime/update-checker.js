'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

const REPO_RAW_ROOT = 'https://raw.githubusercontent.com/XisFool/codebuddy-hud';
const RELEASES_LATEST_URL = 'https://github.com/XisFool/codebuddy-hud/releases/latest';
const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/XisFool/codebuddy-hud/releases/latest';
const FETCH_TIMEOUT_MS = 8000;

// Full semver decomposition used only for comparison. Accepts both `v`-prefixed
// and bare forms; keeps the numeric triple plus the prerelease identifiers
// (build metadata is ignored for precedence).
function parseSemverDetail(v) {
  if (typeof v !== 'string') return { numbers: [0, 0, 0], prerelease: [] };
  const clean = v.trim().replace(/^v/, '');
  const versionPart = clean.split('+')[0];
  const hyphenIdx = versionPart.indexOf('-');
  if (hyphenIdx === -1) {
    const nums = versionPart.split('.').map((p) => parseInt(p, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { numbers: nums.slice(0, 3), prerelease: [] };
  }
  const nums = versionPart.slice(0, hyphenIdx).split('.').map((p) => parseInt(p, 10) || 0);
  while (nums.length < 3) nums.push(0);
  const prerelease = versionPart.slice(hyphenIdx + 1).split('.');
  return { numbers: nums.slice(0, 3), prerelease };
}

function comparePrerelease(a, b) {
  // Semver precedence: no prerelease > has prerelease. Then identifier-by-identifier,
  // numeric identifiers sort below alphanumeric, numerics compare numerically, and a
  // shorter prerelease set ranks lower when all preceding identifiers are equal.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const aNum = /^\d+$/.test(a[i]);
    const bNum = /^\d+$/.test(b[i]);
    let cmp;
    if (aNum && bNum) {
      const diff = Number(a[i]) - Number(b[i]);
      cmp = diff === 0 ? 0 : diff > 0 ? 1 : -1;
    } else if (aNum) {
      cmp = -1;
    } else if (bNum) {
      cmp = 1;
    } else {
      cmp = a[i] < b[i] ? -1 : a[i] > b[i] ? 1 : 0;
    }
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function compareVersions(v1, v2) {
  const a = parseSemverDetail(v1);
  const b = parseSemverDetail(v2);
  const [maj1, min1, pat1] = a.numbers;
  const [maj2, min2, pat2] = b.numbers;

  if (maj1 !== maj2) return maj1 > maj2 ? 1 : -1;
  if (min1 !== min2) return min1 > min2 ? 1 : -1;
  if (pat1 !== pat2) return pat1 > pat2 ? 1 : -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

function getLocalVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg && typeof pkg.version === 'string') return pkg.version;
    }
  } catch {
    // ignore
  }
  return null;
}

function getReleaseVersion(release) {
  if (!release || typeof release !== 'object') return null;
  if (typeof release.tag_name === 'string' && release.tag_name.trim()) return release.tag_name.trim();
  // Keep the legacy package.json override working for tests and private mirrors.
  if (typeof release.version === 'string' && release.version.trim()) return release.version.trim();
  return null;
}

// `CODEBUDDY_HUD_MIRROR` (e.g. `https://your-mirror`) is prepended to every
// GitHub URL resolved here. Each URL keeps its un-mirrored form as a fallback,
// so a mirror that fails to proxy one of the hosts degrades to a direct
// request instead of failing the whole command.
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

function fetchText(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error(`Too many redirects fetching ${url}`));
    }
    const client = url.startsWith('https') ? https : http;
    const headers = { 'User-Agent': 'codebuddy-hud-update-checker', ...(options.headers || {}) };
    const req = client.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        // Never carry credentials across an origin boundary.
        const carried = new URL(nextUrl).origin === new URL(url).origin ? { headers } : {};
        res.resume();
        return resolve(fetchText(nextUrl, carried, redirectCount + 1));
      }
      res.resume();
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} when fetching ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
  });
}

// Strategy 1 for tag resolution: the releases/latest page 302-redirects to
// /releases/tag/<tag>, so a HEAD-less GET without redirect following yields
// the tag without touching the rate-limited REST API.
function fetchLatestTagVia302(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'codebuddy-hud-update-checker' },
    }, (res) => {
      res.resume();
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const match = res.headers.location.match(/\/releases\/tag\/([^/]+)$/);
        if (match) return resolve(decodeURIComponent(match[1]));
      }
      reject(new Error(`Failed to resolve latest tag via redirect (HTTP ${res.statusCode})`));
    });
    req.on('error', reject);
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error('Timeout resolving latest release tag'));
    });
  });
}

// Resolves the latest release ref as the raw GitHub tag (trimmed). The tag is
// used verbatim everywhere — raw download URLs, the CODEBUDDY_HUD_VERSION pin,
// comparison (compareVersions accepts both `v`-prefixed and bare forms) and
// user-facing messages — so the v-prefixed and bare forms can never be mixed up.
async function resolveLatestTag(options = {}) {
  const explicit = (options.latestReleaseUrl
    || process.env.CODEBUDDY_HUD_LATEST_RELEASE_URL
    || process.env.CODEBUDDY_HUD_REMOTE_PKG_URL
    || '').trim();
  if (explicit) {
    const body = await fetchText(explicit);
    const release = JSON.parse(body.toString('utf8'));
    const tag = getReleaseVersion(release);
    if (!tag) {
      throw new Error(`Latest release response from ${explicit} did not contain a valid tag_name`);
    }
    return tag;
  }

  const candidates302 = options.candidates302 || urlCandidates(RELEASES_LATEST_URL);
  for (const candidate of candidates302) {
    try {
      const tag = await fetchLatestTagVia302(candidate);
      if (tag && tag.trim()) return tag.trim();
    } catch {
      // Try the next candidate, then fall through to the API.
    }
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const apiCandidates = options.apiCandidates || urlCandidates(LATEST_RELEASE_API_URL);
  let lastErr;
  for (const candidate of apiCandidates) {
    // The token belongs to GitHub; a mirror host must never receive it.
    const headers = candidate === LATEST_RELEASE_API_URL && token
      ? { Authorization: `token ${token}` }
      : {};
    try {
      const body = await fetchText(candidate, { headers });
      const release = JSON.parse(body.toString('utf8'));
      const tag = getReleaseVersion(release);
      if (tag) return tag;
      lastErr = new Error(`Latest release response from ${candidate} did not contain a valid tag_name`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Could not resolve the latest release');
}

function rawBaseForTag(tag) {
  const normalized = typeof tag === 'string' ? tag.trim() : '';
  if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  return `${REPO_RAW_ROOT}/${encodeURIComponent(normalized)}`;
}

async function runUpdate(options = {}) {
  const localVersion = options.localVersion !== undefined ? options.localVersion : getLocalVersion();
  if (!localVersion) {
    return {
      ok: false,
      message: 'Could not determine the installed version; re-run the install script instead.',
    };
  }

  let latestTag;
  try {
    latestTag = await resolveLatestTag(options);
  } catch (err) {
    return {
      ok: false,
      message: `Could not check for the latest release: ${err && err.message ? err.message : err}. If GitHub is unreachable, set CODEBUDDY_HUD_MIRROR and retry.`,
    };
  }
  if (typeof latestTag !== 'string' || !latestTag) {
    return { ok: false, message: 'Could not resolve the latest release tag.' };
  }

  // Validate the raw ref before any comparison: a malformed tag must fail
  // loudly instead of falling through to a false "up to date".
  let downloadBase;
  try {
    downloadBase = rawBaseForTag(latestTag);
  } catch (err) {
    return { ok: false, message: err && err.message ? err.message : String(err) };
  }

  if (compareVersions(latestTag, localVersion) <= 0) {
    return { ok: true, message: `Already up to date (v${localVersion}).`, latest: latestTag, local: localVersion };
  }

  const override = (options.bootstrapUrl || process.env.CODEBUDDY_HUD_BOOTSTRAP_URL || '').trim();
  const candidates = override ? [override] : urlCandidates(`${downloadBase}/scripts/bootstrap.js`);

  let script = null;
  let lastErr;
  for (const candidate of candidates) {
    try {
      script = (await fetchText(candidate)).toString('utf8');
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!script) {
    return {
      ok: false,
      message: `Could not download the updater script: ${lastErr && lastErr.message ? lastErr.message : lastErr}.`,
    };
  }

  const tmpPath = path.join(os.tmpdir(), `codebuddy-hud-bootstrap-${process.pid}-${Date.now()}.js`);
  try {
    fs.writeFileSync(tmpPath, script, { mode: 0o600 });
  } catch (err) {
    return {
      ok: false,
      message: `Could not stage the updater script: ${err && err.message ? err.message : err}.`,
    };
  }

  // --delay-start lets the parent process fully exit before bootstrap rewrites
  // the runtime directory; on Windows the just-running binary would otherwise
  // hold file locks on the files being replaced.
  const child = spawn(process.execPath, [tmpPath, '--delay-start'], {
    detached: true,
    stdio: 'inherit',
    windowsHide: true,
    // Pin the raw `vX.Y.Z` ref: bootstrap reuses it verbatim in raw URLs.
    env: { ...process.env, CODEBUDDY_HUD_VERSION: latestTag },
  });
  child.on('error', () => {});
  child.unref();

  return {
    ok: true,
    message: `Update to ${latestTag} started in the background; it will finish in a few seconds. Start a new CodeBuddy session to load it.`,
    latest: latestTag,
    local: localVersion,
    bootstrapPath: tmpPath,
  };
}

module.exports = {
  compareVersions,
  parseSemverDetail,
  getLocalVersion,
  getReleaseVersion,
  resolveLatestTag,
  fetchLatestTagVia302,
  rawBaseForTag,
  runUpdate,
};
