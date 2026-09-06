'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getCacheStatePath } = require('./paths');

let _unicodeSupported = null;

// The host spawns a fresh process for every statusLine refresh (~300ms), so a
// module-level cache never pays off. chcp.com costs ~80ms per run on Windows —
// roughly a third of the whole budget — so the probe result is persisted to a
// state file instead: the first run pays the spawn, every later run reads a
// ~50-byte JSON file. The console code page effectively never changes mid-
// session; CODEBUDDY_HUD_FORCE_ASCII / FORCE_UNICODE always override, and
// `--uninstall` (or deleting the file) resets the cache.
function readUnicodeSupportCache() {
  try {
    const data = JSON.parse(fs.readFileSync(getCacheStatePath(), 'utf8'));
    if (data && typeof data.unicodeSupported === 'boolean') {
      const savedAt = typeof data.savedAt === 'number' ? data.savedAt : (data.savedAt ? Date.parse(data.savedAt) : 0);
      if (!savedAt || (Date.now() - savedAt < 3600000)) {
        return data.unicodeSupported;
      }
    }
  } catch {
    // no cache yet — caller probes
  }
  return null;
}

function writeUnicodeSupportCache(value) {
  const cachePath = getCacheStatePath();
  const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let existing = {};
    try {
      if (fs.existsSync(cachePath)) existing = JSON.parse(fs.readFileSync(cachePath, 'utf8')) || {};
    } catch {}
    existing.unicodeSupported = value;
    existing.savedAt = Date.now();
    fs.writeFileSync(tmpPath, JSON.stringify(existing));
    fs.renameSync(tmpPath, cachePath);
  } catch {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

/**
 * Pure Unicode-support detection. Reads only its arguments, never `process.*`,
 * and performs no caching — safe to call with arbitrary plain objects in tests.
 *
 * Non-win32 precedence:
 *   1. CODEBUDDY_HUD_FORCE_ASCII=1 -> false, CODEBUDDY_HUD_FORCE_UNICODE=1 -> true
 *   2. First non-empty of LC_ALL / LC_CTYPE / LANG -> whether it is a UTF-8 locale
 *   3. All three empty -> true, unless TERM is 'dumb' or 'linux'
 *
 * On win32 the FORCE vars still apply, then true; the authoritative answer there
 * comes from chcp.com inside supportsUnicode(), which is the only place allowed
 * to spawn a subprocess.
 *
 * @param {string} platform - process.platform-like value (e.g. 'linux', 'win32').
 * @param {Record<string, string|undefined>} env - process.env-like value.
 * @returns {boolean}
 */
function detectUnicodeSupport(platform, env) {
  if (env.CODEBUDDY_HUD_FORCE_ASCII === '1') return false;
  if (env.CODEBUDDY_HUD_FORCE_UNICODE === '1') return true;

  if (platform === 'win32') return true;

  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  if (locale !== '') return /utf-?8/i.test(locale);

  // No locale set (containers, SSH): UTF-8 is the de-facto default, except on
  // terminals known not to render it.
  const term = env.TERM || '';
  if (term === 'dumb' || term === 'linux') return false;

  return true;
}

function supportsUnicode() {
  if (_unicodeSupported !== null) return _unicodeSupported;

  // FORCE vars short-circuit everything, including the Windows probe below.
  // Mirrored in detectUnicodeSupport() so that function stays total/testable.
  if (process.env.CODEBUDDY_HUD_FORCE_ASCII === '1') {
    _unicodeSupported = false;
  } else if (process.env.CODEBUDDY_HUD_FORCE_UNICODE === '1') {
    _unicodeSupported = true;
  } else if (process.platform === 'win32') {
    const cached = readUnicodeSupportCache();
    if (cached !== null) {
      _unicodeSupported = cached;
    } else {
      try {
        // stdio pins stderr to ignore: execSync forwards child stderr to the
        // parent's stderr by default, and the HUD must never emit noise.
        const out = execSync('chcp.com', {
          encoding: 'utf8',
          timeout: 2000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const match = out.match(/(\d+)/);
        _unicodeSupported = match ? match[1] === '65001' : false;
        writeUnicodeSupportCache(_unicodeSupported);
      } catch {
        _unicodeSupported = false;
        writeUnicodeSupportCache(false);
      }
    }
  } else {
    _unicodeSupported = detectUnicodeSupport(process.platform, process.env);
  }

  return _unicodeSupported;
}

function selectGlyphs(useNerdFonts, unicodeSupported) {
  if (useNerdFonts) {
    return {
      bar: '\u2588', empty: '\u2591', vbar: '\u2502', hbar: '\u2500', ellipsis: '\u2026', dot: '\u00B7',
      agentIcon: '\uDB80\uDC8B ', taskIcon: '\uF00C ', diffIcon: '\uF440 ',
      tokenIcon: '\uDB82\uDEA9 ', ctxIcon: '\uDB83\uDD10 ', modelIcon: '',
      clockIcon: '\uDB81\uDD54 ', costIcon: '',
      activeIcon: '\u25D0 ', queueIcon: '\u25B8 ', doneIcon: '\uF00C ',
      effortIcons: {
        low: '\u25CB ',
        medium: '\u25D4 ',
        high: '\u25D1 ',
        xhigh: '\u25D5 ',
        max: '\u25CF ',
        ultracode: '\u26A1 ',
      },
    };
  }
  if (unicodeSupported) {
    return {
      bar: '\u2588', empty: '\u2591', vbar: '\u2502', hbar: '\u2500', ellipsis: '\u2026', dot: '\u00B7',
      agentIcon: '\u25D0 ', taskIcon: '\u2713 ', diffIcon: '\u0394 ',
      tokenIcon: '', ctxIcon: '', modelIcon: '',
      clockIcon: '\u23F1 ', costIcon: '',
      activeIcon: '\u25D0 ', queueIcon: '\u25B8 ', doneIcon: '\u2713 ',
      effortIcons: {
        low: '\u25CB ',
        medium: '\u25D4 ',
        high: '\u25D1 ',
        xhigh: '\u25D5 ',
        max: '\u25CF ',
        ultracode: '\u26A1 ',
      },
    };
  }
  return {
    bar: '#', empty: '-', vbar: '|', hbar: '-', ellipsis: '...', dot: '.',
    agentIcon: '[A] ', taskIcon: '[T] ', diffIcon: '[D] ',
    tokenIcon: '', ctxIcon: '', modelIcon: '',
    clockIcon: '[t] ', costIcon: '',
    activeIcon: '[A] ', queueIcon: '[Q] ', doneIcon: '[T] ',
    effortIcons: {
      low: '(low) ',
      medium: '(med) ',
      high: '(high) ',
      xhigh: '(xhigh) ',
      max: '(max) ',
      ultracode: '(ultra) ',
    },
  };
}

function resetCache() {
  _unicodeSupported = null;
}

module.exports = { supportsUnicode, detectUnicodeSupport, selectGlyphs, resetCache };
