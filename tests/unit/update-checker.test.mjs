import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  compareVersions,
  parseSemver,
  parseSemverDetail,
  getLocalVersion,
  getReleaseVersion,
  resolveLatestTag,
  fetchLatestTagVia302,
  rawBaseForTag,
  runUpdate,
} = require('../../runtime/update-checker.js');
const repoPkg = require('../../package.json');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function waitFor(filePath, timeoutMs = 10000) {
  const start = Date.now();
  for (;;) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error(`marker not found within ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

describe('update-checker', () => {
  test('parseSemver parses standard and prefixed versions', () => {
    assert.deepEqual(parseSemver('1.2.3'), [1, 2, 3]);
    assert.deepEqual(parseSemver('v2.0.4'), [2, 0, 4]);
    assert.deepEqual(parseSemver('0.1'), [0, 1, 0]);
    assert.deepEqual(parseSemver('invalid'), [0, 0, 0]);
  });

  test('compareVersions accurately compares semver strings', () => {
    assert.equal(compareVersions('0.2.0', '0.1.0'), 1);
    assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
    assert.equal(compareVersions('1.1.0', '1.0.9'), 1);
    assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
    assert.equal(compareVersions('1.2.0', '1.2.0-beta.2'), 1);
    assert.equal(compareVersions('1.2.0-beta.2', '1.2.0'), -1);
    assert.equal(compareVersions('1.2.0-alpha.1', '1.2.0-beta.1'), -1);
    assert.equal(compareVersions('1.2.0-beta.1', '1.2.0-beta.2'), -1);
    assert.equal(compareVersions('1.2.0-rc.1', '1.2.0-rc.1'), 0);
  });

  test('parseSemverDetail splits prerelease identifiers and drops build metadata', () => {
    assert.deepEqual(parseSemverDetail('v1.2.3-beta.1+build.7'), { numbers: [1, 2, 3], prerelease: ['beta', '1'] });
    assert.deepEqual(parseSemverDetail('1.2.3'), { numbers: [1, 2, 3], prerelease: [] });
  });

  test('getLocalVersion reads the runtime package.json version', () => {
    assert.equal(getLocalVersion(), repoPkg.version);
  });

  test('reads versions from GitHub release tags before legacy package overrides', () => {
    assert.equal(getReleaseVersion({ tag_name: 'v0.2.0', version: '9.9.9' }), 'v0.2.0');
    assert.equal(getReleaseVersion({ version: '0.1.1' }), '0.1.1');
    assert.equal(getReleaseVersion({}), null);
    assert.equal(getReleaseVersion({ tag_name: '   ' }), null);
  });

  test('rawBaseForTag validates the tag shape and encodes it into the raw URL', () => {
    assert.equal(rawBaseForTag('v0.3.9'), 'https://raw.githubusercontent.com/XisFool/codebuddy-hud/v0.3.9');
    assert.equal(rawBaseForTag('1.2.3-beta.1'), 'https://raw.githubusercontent.com/XisFool/codebuddy-hud/1.2.3-beta.1');
    assert.throws(() => rawBaseForTag('9.9.9:bad'), /Invalid release tag/);
    assert.throws(() => rawBaseForTag('../../etc'), /Invalid release tag/);
  });

  test('resolveLatestTag prefers an explicit latest release URL', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/release.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ tag_name: 'v9.9.9', version: '8.8.8' }));
      } else if (req.url === '/legacy.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ version: '7.7.7' }));
      } else {
        res.writeHead(404).end();
      }
    });
    const port = await listen(server);
    try {
      assert.equal(await resolveLatestTag({ latestReleaseUrl: `http://127.0.0.1:${port}/release.json` }), 'v9.9.9');
      assert.equal(await resolveLatestTag({ latestReleaseUrl: `http://127.0.0.1:${port}/legacy.json` }), '7.7.7');
      await assert.rejects(
        () => resolveLatestTag({ latestReleaseUrl: `http://127.0.0.1:${port}/missing.json` }),
        /HTTP 404/
      );
    } finally {
      server.close();
    }
  });

  test('resolveLatestTag resolves via the 302 strategy and falls back to the API', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/releases/latest') {
        res.writeHead(302, { Location: '/releases/tag/v9.9.9' });
        res.end();
      } else if (req.url === '/missing') {
        res.writeHead(404).end();
      } else if (req.url === '/api') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ tag_name: 'v9.8.8' }));
      } else {
        res.writeHead(500).end();
      }
    });
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;
    try {
      assert.equal(await resolveLatestTag({ candidates302: [`${base}/releases/latest`] }), 'v9.9.9');
      assert.equal(await fetchLatestTagVia302(`${base}/releases/latest`), 'v9.9.9');
      assert.equal(
        await resolveLatestTag({ candidates302: [`${base}/missing`], apiCandidates: [`${base}/api`] }),
        'v9.8.8'
      );
      await assert.rejects(
        () => resolveLatestTag({ candidates302: [`${base}/missing`], apiCandidates: [`${base}/missing`] })
      );
    } finally {
      server.close();
    }
  });

  test('runUpdate reports up to date when latest is not newer', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ tag_name: `v${repoPkg.version}` }));
    });
    const port = await listen(server);
    try {
      const result = await runUpdate({ latestReleaseUrl: `http://127.0.0.1:${port}/` });
      assert.equal(result.ok, true);
      assert.match(result.message, new RegExp(`Already up to date \\(v${repoPkg.version}\\)`));
    } finally {
      server.close();
    }
  });

  test('runUpdate reports a missing local version without touching the network', async () => {
    const result = await runUpdate({ localVersion: null });
    assert.equal(result.ok, false);
    assert.match(result.message, /Could not determine the installed version/);
  });

  test('runUpdate reports a resolve failure with a mirror hint', async () => {
    const result = await runUpdate({ latestReleaseUrl: 'http://127.0.0.1:9/release.json' });
    assert.equal(result.ok, false);
    assert.match(result.message, /Could not check for the latest release/);
    assert.match(result.message, /CODEBUDDY_HUD_MIRROR/);
  });

  test('runUpdate rejects an invalid latest tag before downloading', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ tag_name: 'v9.9.9:bad' }));
    });
    const port = await listen(server);
    try {
      const result = await runUpdate({ latestReleaseUrl: `http://127.0.0.1:${port}/`, localVersion: repoPkg.version });
      assert.equal(result.ok, false);
      assert.match(result.message, /Invalid release tag/);
    } finally {
      server.close();
    }
  });

  test('runUpdate stages and spawns the bootstrap for an older local version', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-update-run-'));
    const marker = path.join(tmpDir, 'marker.txt');
    const server = http.createServer((req, res) => {
      if (req.url === '/release.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ tag_name: 'v9.9.9' }));
      } else if (req.url === '/bootstrap.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end("require('fs').writeFileSync(process.env.UPDATE_TEST_MARKER, process.env.CODEBUDDY_HUD_VERSION || 'no-version');");
      } else {
        res.writeHead(404).end();
      }
    });
    const port = await listen(server);
    process.env.UPDATE_TEST_MARKER = marker;
    let result;
    try {
      result = await runUpdate({
        latestReleaseUrl: `http://127.0.0.1:${port}/release.json`,
        bootstrapUrl: `http://127.0.0.1:${port}/bootstrap.js`,
        localVersion: '0.0.1',
      });
      assert.equal(result.ok, true, result.message);
      assert.match(result.message, /Update to v9\.9\.9 started in the background/);
      assert.equal(typeof result.bootstrapPath, 'string');

      assert.equal(await waitFor(marker), 'v9.9.9');
      assert.ok(fs.existsSync(result.bootstrapPath));
    } finally {
      delete process.env.UPDATE_TEST_MARKER;
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (result && result.bootstrapPath) fs.rmSync(result.bootstrapPath, { force: true });
    }
  });

  test('runUpdate keeps the raw v-prefixed ref in the bootstrap download URL', async () => {
    // H1 regression: the download must address the immutable `vX.Y.Z` tag.
    // Normalizing the tag to `9.9.9` and building
    // `raw.githubusercontent.com/.../9.9.9/...` 404s. Drive the real
    // candidate-building path (no bootstrapUrl override) through a mirror
    // that captures the requested URL instead.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-update-ref-'));
    const marker = path.join(tmpDir, 'marker.txt');
    const requests = [];
    const server = http.createServer((req, res) => {
      if (req.url === '/release.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ tag_name: 'v9.9.9' }));
      } else if (req.url.includes('/scripts/bootstrap.js')) {
        requests.push(req.url);
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end("require('fs').writeFileSync(process.env.UPDATE_TEST_MARKER, process.env.CODEBUDDY_HUD_VERSION || 'no-version');");
      } else {
        res.writeHead(404).end();
      }
    });
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;
    const prevMirror = process.env.CODEBUDDY_HUD_MIRROR;
    process.env.UPDATE_TEST_MARKER = marker;
    process.env.CODEBUDDY_HUD_MIRROR = base;
    let result;
    try {
      result = await runUpdate({
        latestReleaseUrl: `${base}/release.json`,
        localVersion: '0.0.1',
      });
      assert.equal(result.ok, true, result.message);
      assert.ok(
        requests.some((u) => u.includes('/v9.9.9/scripts/bootstrap.js')),
        `expected the download to target the v-prefixed ref, got: ${requests.join(', ') || '(no request captured)'}`
      );
      assert.equal(await waitFor(marker), 'v9.9.9');
    } finally {
      delete process.env.UPDATE_TEST_MARKER;
      if (prevMirror === undefined) delete process.env.CODEBUDDY_HUD_MIRROR;
      else process.env.CODEBUDDY_HUD_MIRROR = prevMirror;
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (result && result.bootstrapPath) fs.rmSync(result.bootstrapPath, { force: true });
    }
  });

  test('runUpdate reports a bootstrap download failure', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/release.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ tag_name: 'v9.9.9' }));
      } else {
        res.writeHead(404).end();
      }
    });
    const port = await listen(server);
    try {
      const result = await runUpdate({
        latestReleaseUrl: `http://127.0.0.1:${port}/release.json`,
        bootstrapUrl: 'http://127.0.0.1:9/bootstrap.js',
        localVersion: '0.0.1',
      });
      assert.equal(result.ok, false);
      assert.match(result.message, /Could not download the updater script/);
    } finally {
      server.close();
    }
  });
});
