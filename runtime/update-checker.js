'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { getUpdateStatusPath } = require('./paths');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LATEST_RELEASE_URL = process.env.CODEBUDDY_HUD_LATEST_RELEASE_URL ||
  process.env.CODEBUDDY_HUD_REMOTE_PKG_URL ||
  'https://api.github.com/repos/XisFool/codebuddy-hud/releases/latest';

function parseSemver(v) {
  if (typeof v !== 'string') return [0, 0, 0];
  const clean = v.trim().replace(/^v/, '');
  const parts = clean.split('.').map(p => parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

// Full semver decomposition used only for comparison. Keeps the numeric triple
// plus the prerelease identifiers (build metadata is ignored for precedence).
// parseSemver above stays as the public 3-tuple (numeric-only) contract.
function parseSemverDetail(v) {
  if (typeof v !== 'string') return { numbers: [0, 0, 0], prerelease: [] };
  const clean = v.trim().replace(/^v/, '');
  const versionPart = clean.split('+')[0]; // drop build metadata
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
      cmp = -1; // numeric < alphanumeric
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
  return '0.2.0';
}

let _cachedStatusPath = null;
let _cachedStatus = undefined;

function resetUpdateStatusCache() {
  _cachedStatusPath = null;
  _cachedStatus = undefined;
}

function readUpdateStatus(options = {}) {
  const filePath = getUpdateStatusPath();
  if (!options.forceReload && _cachedStatusPath === filePath && _cachedStatus !== undefined) {
    return _cachedStatus;
  }
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && typeof data === 'object') {
        _cachedStatusPath = filePath;
        _cachedStatus = data;
        return data;
      }
    }
  } catch {
    // ignore
  }
  _cachedStatusPath = filePath;
  _cachedStatus = null;
  return null;
}

function writeUpdateStatus(status) {
  const filePath = getUpdateStatusPath();
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2));
    fs.renameSync(tmpPath, filePath);
    _cachedStatusPath = filePath;
    _cachedStatus = status;
  } catch {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'codebuddy-hud-update-checker' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        if (timer) clearTimeout(timer);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (timer) clearTimeout(timer);
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    timer = setTimeout(() => {
      req.destroy(new Error('Request timeout'));
    }, 8000);
    if (timer.unref) timer.unref();
  });
}

function getReleaseVersion(release) {
  if (!release || typeof release !== 'object') return null;
  if (typeof release.tag_name === 'string') return release.tag_name;
  // Keep the old package.json override working for test and private mirrors.
  if (typeof release.version === 'string') return release.version;
  return null;
}

async function checkForUpdates(options) {
  const opts = options || {};
  const force = !!opts.force;
  const currentStatus = readUpdateStatus();
  const now = Date.now();

  if (!force && currentStatus && currentStatus.lastCheck && (now - currentStatus.lastCheck < CHECK_INTERVAL_MS)) {
    return currentStatus;
  }

  const localVersion = opts.localVersion || getLocalVersion();
  let latestVersion = localVersion;
  let updateAvailable = false;

  try {
    const release = await fetchJson(opts.url || LATEST_RELEASE_URL);
    const releaseVersion = getReleaseVersion(release);
    if (releaseVersion) {
      latestVersion = releaseVersion;
      updateAvailable = compareVersions(latestVersion, localVersion) > 0;
    }
  } catch {
    // A transient failure must not erase a previously confirmed update notice.
    // Keep the same 24h throttle while preserving only a status usable by the UI.
    if (currentStatus
        && typeof currentStatus.updateAvailable === 'boolean'
        && typeof currentStatus.latestVersion === 'string'
        && currentStatus.latestVersion) {
      const retainedStatus = { ...currentStatus, lastCheck: now };
      writeUpdateStatus(retainedStatus);
      return retainedStatus;
    }
  }

  const newStatus = {
    lastCheck: now,
    latestVersion,
    currentVersion: localVersion,
    updateAvailable,
  };

  writeUpdateStatus(newStatus);
  return newStatus;
}

function spawnBackgroundUpdateCheck() {
  try {
    if (process.env.CODEBUDDY_HUD_NO_UPDATE_CHECK === '1') return;
    const currentStatus = readUpdateStatus();
    const now = Date.now();
    if (currentStatus && currentStatus.lastCheck && (now - currentStatus.lastCheck < CHECK_INTERVAL_MS)) {
      return; // Not due for check yet
    }

    // Persist placeholder lock before spawning to avoid stampede across high-frequency HUD refreshes
    writeUpdateStatus({
      ...(currentStatus || {}),
      lastCheck: now,
    });

    const scriptPath = __filename;
    const child = spawn(process.execPath, [scriptPath, '--run-check'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Fail silently, never crash main process
  }
}

if (require.main === module) {
  const exitTimer = setTimeout(() => process.exit(0), 15000);
  if (exitTimer.unref) exitTimer.unref();
  if (process.argv.includes('--run-check')) {
    checkForUpdates({ force: true })
      .then(() => process.exit(0))
      .catch(() => process.exit(0));
  } else {
    checkForUpdates({ force: true }).then((res) => {
      console.log('Update check result:', res);
    });
  }
}

module.exports = {
  compareVersions,
  parseSemver,
  getLocalVersion,
  readUpdateStatus,
  writeUpdateStatus,
  resetUpdateStatusCache,
  getReleaseVersion,
  checkForUpdates,
  spawnBackgroundUpdateCheck,
  CHECK_INTERVAL_MS,
};
