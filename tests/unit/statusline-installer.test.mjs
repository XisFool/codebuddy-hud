import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { buildStatusLineCommand, buildCmdShimContent, setup } = require('../../runtime/statusline-installer.js');
const { uninstall } = require('../../runtime/uninstall.js');
const { getSessionStatsStateDir, getUpdateStatusPath } = require('../../runtime/paths.js');

// POSIX fixtures use forward slashes; win32 fixtures use C:\... style.
const POSIX_NODE = '/usr/bin/node';
const POSIX_HUD = '/opt/codebuddy-hud/runtime/bin/codebuddy-hud.js';

describe('buildStatusLineCommand', () => {
  test('is exported as a pure function without side effects', () => {
    assert.equal(typeof buildStatusLineCommand, 'function');
    const res1 = buildStatusLineCommand('linux', POSIX_HUD, POSIX_NODE);
    const res2 = buildStatusLineCommand('linux', POSIX_HUD, POSIX_NODE);
    assert.equal(res1, res2);
  });

  test('win32 -> quoted .cmd shim path, no .js left in the command', () => {
    const hudBin = 'C:\\Users\\me\\proj\\runtime\\bin\\codebuddy-hud.js';
    const command = buildStatusLineCommand('win32', hudBin, 'C:\\Program Files\\nodejs\\node.exe');

    assert.equal(command, '"C:\\Users\\me\\proj\\runtime\\bin\\codebuddy-hud.cmd"');
    assert.ok(!command.includes('.js'));
  });

  test('win32 does not add POSIX escaping', () => {
    const hudBin = 'C:\\my $weird`dir\\codebuddy-hud.js';
    const command = buildStatusLineCommand('win32', hudBin, 'C:\\node.exe');

    assert.equal(command, '"C:\\my $weird`dir\\codebuddy-hud.cmd"');
  });

  test('win32 preserves cmd metacharacters inside the quoted shim path', () => {
    const hudBin = 'C:\\dir&name^part(1)%pct\\codebuddy-hud.js';
    const command = buildStatusLineCommand('win32', hudBin, 'C:\\node.exe');

    assert.equal(command, '"C:\\dir&name^part(1)%pct\\codebuddy-hud.cmd"');
  });

  test('linux -> two double-quoted words separated by a space', () => {
    const command = buildStatusLineCommand('linux', POSIX_HUD, POSIX_NODE);

    assert.equal(command, '"/usr/bin/node" "/opt/codebuddy-hud/runtime/bin/codebuddy-hud.js"');
    assert.equal(command.split('" "').length, 2);
  });

  test('darwin -> same shape as linux', () => {
    const command = buildStatusLineCommand('darwin', POSIX_HUD, POSIX_NODE);

    assert.equal(command, '"/usr/bin/node" "/opt/codebuddy-hud/runtime/bin/codebuddy-hud.js"');
    assert.equal(command, buildStatusLineCommand('linux', POSIX_HUD, POSIX_NODE));
  });

  test('paths containing spaces stay quoted', () => {
    const node = '/opt/My Node/bin/node';
    const hud = '/opt/My Project/runtime/bin/codebuddy-hud.js';

    assert.equal(
      buildStatusLineCommand('linux', hud, node),
      '"/opt/My Node/bin/node" "/opt/My Project/runtime/bin/codebuddy-hud.js"'
    );
  });

  test('$ is escaped inside the quotes', () => {
    const hud = '/opt/my$dir/codebuddy-hud.js';

    assert.equal(
      buildStatusLineCommand('linux', hud, '/usr/$bin/node'),
      '"/usr/\\$bin/node" "/opt/my\\$dir/codebuddy-hud.js"'
    );
  });

  test('backtick is escaped inside the quotes', () => {
    const hud = '/opt/my`dir/codebuddy-hud.js';

    assert.equal(
      buildStatusLineCommand('linux', hud, POSIX_NODE),
      '"/usr/bin/node" "/opt/my\\`dir/codebuddy-hud.js"'
    );
  });

  test('double quote is escaped inside the quotes', () => {
    const hud = '/opt/my"dir/codebuddy-hud.js';

    assert.equal(
      buildStatusLineCommand('linux', hud, POSIX_NODE),
      '"/usr/bin/node" "/opt/my\\"dir/codebuddy-hud.js"'
    );
  });

  test('backslash is escaped inside the quotes', () => {
    const hud = 'C:\\Users\\me\\codebuddy-hud.js';

    assert.equal(
      buildStatusLineCommand('linux', hud, POSIX_NODE),
      '"/usr/bin/node" "C:\\\\Users\\\\me\\\\codebuddy-hud.js"'
    );
  });

  test('several special characters together are all escaped exactly once', () => {
    // real path: /opt/we ird$dir/`q"t\back/codebuddy-hud.js
    const hud = '/opt/we ird$dir/`q"t\\back/codebuddy-hud.js';

    assert.equal(
      buildStatusLineCommand('linux', hud, POSIX_NODE),
      '"/usr/bin/node" "/opt/we ird\\$dir/\\`q\\"t\\\\back/codebuddy-hud.js"'
    );
  });

  test('backslash added by escaping is not escaped again', () => {
    const hud = '/opt/a\\$b/codebuddy-hud.js';
    const command = buildStatusLineCommand('linux', hud, POSIX_NODE);

    assert.equal(command, '"/usr/bin/node" "/opt/a\\\\\\$b/codebuddy-hud.js"');
    assert.ok(!command.includes('\\\\\\\\'));
  });
});

describe('buildCmdShimContent', () => {
  test('bakes the absolute node path instead of relying on PATH', () => {
    const shim = buildCmdShimContent('C:\\Program Files\\nodejs\\node.exe');

    assert.equal(shim, '@echo off\r\n"C:\\Program Files\\nodejs\\node.exe" "%~dp0codebuddy-hud.js" %*\r\n');
    assert.ok(!/\r?\nnode /.test(shim), 'bare `node` must not appear');
  });

  test('handles a node path containing spaces via quoting', () => {
    const shim = buildCmdShimContent('D:\\My Tools\\node\\node.exe');

    assert.ok(shim.includes('"D:\\My Tools\\node\\node.exe"'));
  });

  test('uses CRLF line endings', () => {
    const shim = buildCmdShimContent('/usr/bin/node');

    assert.ok(shim.includes('\r\n'));
    assert.ok(!/[^\r]\n/.test(shim));
  });

  test('batch-escapes % in the node path so cmd.exe resolves it literally', () => {
    const shim = buildCmdShimContent('D:\\pct%var\\node.exe');

    assert.ok(shim.includes('"D:\\pct%%var\\node.exe"'), 'percent must be doubled in the shim');
    assert.ok(!shim.includes('pct%var'), 'single % would be eaten or expanded by cmd.exe');
  });
});

test('setup preserves the first backup, refreshes the Windows shim, and uninstall restores it', () => {
  const originalSettingsPath = process.env.CODEBUDDY_SETTINGS_PATH;
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-installer-'));
  const settingsPath = path.join(tempRoot, 'nested', 'settings.json');
  const runtimeDir = path.join(tempRoot, 'isolated runtime');
  const hudBin = path.join(runtimeDir, 'bin', 'codebuddy-hud.js');
  const originalSettings = {
    theme: 'custom',
    statusLine: { type: 'command', command: 'custom-statusline', padding: 2 },
    nested: { enabled: true },
  };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.mkdirSync(path.dirname(hudBin), { recursive: true });
  fs.writeFileSync(hudBin, '#!/usr/bin/env node\n');
  fs.writeFileSync(settingsPath, JSON.stringify(originalSettings, null, 2));
  process.env.CODEBUDDY_SETTINGS_PATH = settingsPath;
  process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');

  const backupPath = settingsPath + '.bak.codebuddy-hud';
  const cmdShim = hudBin.replace(/\.js$/, '.cmd');
  try {
    setup({ runtimeDir, platform: 'win32', nodeExe: 'C:\\old node\\node.exe' });
    const firstBackup = fs.readFileSync(backupPath, 'utf8');
    assert.deepEqual(JSON.parse(firstBackup), originalSettings);
    assert.match(fs.readFileSync(cmdShim, 'utf8'), /C:\\old node\\node\.exe/);

    setup({ runtimeDir, platform: 'win32', nodeExe: 'D:\\new node\\node.exe' });
    assert.equal(fs.readFileSync(backupPath, 'utf8'), firstBackup, 'second setup must not overwrite the original backup');
    assert.match(fs.readFileSync(cmdShim, 'utf8'), /D:\\new node\\node\.exe/, 're-setup must refresh a changed Node path');
    const installed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(installed.statusLine.type, 'command');
    assert.equal(installed.statusLine.command, `"${cmdShim}"`);
    fs.mkdirSync(getSessionStatsStateDir(), { recursive: true });
    fs.writeFileSync(path.join(getSessionStatsStateDir(), 'state.json'), '{}');
    fs.writeFileSync(getUpdateStatusPath(), '{}');

    uninstall({ runtimeDir, platform: 'win32' });
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), originalSettings);
    assert.equal(fs.existsSync(backupPath), false);
    assert.equal(fs.existsSync(cmdShim), false, 'uninstall should remove the generated Windows shim');
    assert.equal(fs.existsSync(getSessionStatsStateDir()), false, 'uninstall should remove the session statistics state');
    assert.equal(fs.existsSync(getUpdateStatusPath()), false, 'uninstall should remove the update status state');
  } finally {
    if (originalSettingsPath === undefined) delete process.env.CODEBUDDY_SETTINGS_PATH;
    else process.env.CODEBUDDY_SETTINGS_PATH = originalSettingsPath;
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('POSIX setup does not create or remove a Windows shim', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-posix-'));
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const settingsPath = path.join(tempRoot, 'settings.json');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const hudBin = path.join(runtimeDir, 'bin', 'codebuddy-hud.js');
  const cmdShim = hudBin.replace(/\.js$/, '.cmd');
  fs.mkdirSync(path.dirname(hudBin), { recursive: true });
  fs.writeFileSync(hudBin, '#!/usr/bin/env node\n');
  fs.writeFileSync(cmdShim, 'pre-existing Windows shim');
  process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');
  try {
    setup({ settingsPath, runtimeDir, platform: 'linux', nodeExe: '/usr/bin/node' });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.statusLine.command, buildStatusLineCommand('linux', hudBin, '/usr/bin/node'));
    assert.equal(fs.readFileSync(cmdShim, 'utf8'), 'pre-existing Windows shim');

    uninstall({ settingsPath, runtimeDir, platform: 'linux' });
    assert.equal(fs.readFileSync(cmdShim, 'utf8'), 'pre-existing Windows shim');
  } finally {
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated Windows shim runs through cmd.exe from a special-character path', {
  skip: process.platform !== 'win32',
}, () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-&-'));
  const shimPath = path.join(tempRoot, 'codebuddy-hud.cmd');
  const hudPath = path.join(tempRoot, 'codebuddy-hud.js');
  try {
    fs.writeFileSync(hudPath, "process.stdout.write(process.argv.slice(2).join('|'));\n");
    fs.writeFileSync(shimPath, buildCmdShimContent(process.execPath));
    // Invoke the shim with the fully-quoted absolute .cmd path, exactly as the
    // host does (buildStatusLineCommand for win32). A bare cwd-relative batch
    // name is NOT how the host launches it, and cmd.exe /s /c does not reliably
    // run a bare relative batch name carrying a quoted argument, so the test
    // used to fail here with empty output. The '/'&-containing directory is
    // still exercised because buildStatusLineCommand quotes the path, which is
    // precisely how the ampersand stays safe in production.
    const stdout = execSync(
      buildStatusLineCommand('win32', hudPath, process.execPath) + ' "two words"',
      { cwd: os.tmpdir(), shell: process.env.ComSpec || 'cmd.exe', encoding: 'utf8', windowsHide: true },
    );
    assert.equal(stdout, 'two words');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
