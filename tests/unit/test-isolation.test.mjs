import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

test('installer tests preserve the checkout shim and inherited user state', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-isolation-'));
  const runtimeDir = path.join(tempRoot, 'runtime');
  const unitDir = path.join(tempRoot, 'tests', 'unit');
  const userHome = path.join(tempRoot, 'user-home');
  const shim = path.join(runtimeDir, 'bin', 'codebuddy-hud.cmd');
  const cache = path.join(userHome, 'codebuddy-hud-cache-state.json');
  const credits = path.join(userHome, 'codebuddy-hud-credit-state.json');
  try {
    // Reproduce a live installation in a disposable checkout, never the user's.
    fs.cpSync(path.join(repoRoot, 'runtime'), runtimeDir, { recursive: true });
    fs.mkdirSync(unitDir, { recursive: true });
    fs.mkdirSync(userHome);
    const testFile = path.join(unitDir, 'statusline-installer.test.mjs');
    fs.copyFileSync(path.join(repoRoot, 'tests', 'unit', 'statusline-installer.test.mjs'), testFile);
    const sentinels = new Map([[shim, '@echo live-installation\r\n'], [cache, '{"sentinel":"cache"}'], [credits, '{"sentinel":"credits"}']]);
    for (const [target, content] of sentinels) fs.writeFileSync(target, content);
    const env = { ...process.env, CODEBUDDY_HOME: userHome, CODEBUDDY_SETTINGS_PATH: path.join(userHome, 'settings.json'), CODEBUDDY_HUD_NO_UPDATE_CHECK: '1' };
    // Start an independent runner rather than inheriting the parent's IPC mode.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [
      '--test', '--test-name-pattern=uninstall preserves JSONC|uninstall aborts', testFile,
    ], {
      cwd: tempRoot,
      env,
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
    assert.match(result.stdout, /uninstall preserves JSONC/);
    assert.match(result.stdout, /uninstall aborts/);
    for (const [target, content] of sentinels) {
      assert.ok(fs.existsSync(target), `installer tests deleted ${path.relative(tempRoot, target)}`);
      assert.equal(fs.readFileSync(target, 'utf8'), content);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
