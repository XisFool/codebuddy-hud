import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { buildStatusLineCommand, buildCmdShimContent, setup, deploySkill, parseSettingsJson } = require('../../runtime/statusline-installer.js');
const { uninstall } = require('../../runtime/uninstall.js');
const { getSessionStatsStateDir, getUpdateStatusPath } = require('../../runtime/paths.js');

// POSIX fixtures use forward slashes; win32 fixtures use C:\... style.
const POSIX_NODE = '/usr/bin/node';
const POSIX_HUD = '/opt/codebuddy-hud/runtime/bin/codebuddy-hud.js';

function withInstallerFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-installer-boundary-'));
  const saved = { CODEBUDDY_HOME: process.env.CODEBUDDY_HOME, CODEBUDDY_SETTINGS_PATH: process.env.CODEBUDDY_SETTINGS_PATH };
  const options = {
    settingsPath: path.join(root, 'settings.json'),
    runtimeDir: path.join(root, 'runtime'),
    sourceSkillDir: path.join(root, 'source-skill'),
    targetSkillDir: path.join(root, 'home', 'skills', 'hud-config'),
    platform: process.platform,
  };
  options.hudBin = path.join(options.runtimeDir, 'bin', 'codebuddy-hud.js');
  fs.mkdirSync(path.dirname(options.hudBin), { recursive: true });
  fs.writeFileSync(options.hudBin, '#!/usr/bin/env node\n');
  fs.mkdirSync(options.sourceSkillDir);
  fs.writeFileSync(path.join(options.sourceSkillDir, 'SKILL.md'), '# hud-config');
  process.env.CODEBUDDY_HOME = path.join(root, 'home');
  process.env.CODEBUDDY_SETTINGS_PATH = options.settingsPath;
  try {
    return run(options, root);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('setup edits only statusLine command/type and uninstall restores exact JSONC', () => {
  withInstallerFixture(options => {
    const raw = '\ufeff{\r\n\t// user note\r\n\t"model": "original",\r\n'
      + '\t"statusLine": {\r\n\t\t"type": "command", /* keep */\r\n'
      + '\t\t"command": "old-command", // command note\r\n\t\t"padding": 7,\r\n'
      + '\t\t"extra": {"text": "\\\"}, //"},\r\n\t},\r\n}\r\n';
    fs.writeFileSync(options.settingsPath, raw);
    setup(options);
    const installed = fs.readFileSync(options.settingsPath, 'utf8');
    const command = buildStatusLineCommand(options.platform, options.hudBin, process.execPath);
    assert.equal(installed, raw.replace('"old-command"', JSON.stringify(command)));
    const parsed = parseSettingsJson(installed);
    assert.equal(parsed.statusLine.padding, 7);
    assert.deepEqual(parsed.statusLine.extra, { text: '\"}, //' });
    setup(options);
    assert.equal(fs.readFileSync(options.settingsPath, 'utf8'), installed, 'repeat setup must be byte-idempotent');
    uninstall(options);
    assert.equal(fs.readFileSync(options.settingsPath, 'utf8'), raw);
    assert.equal(fs.existsSync(options.settingsPath + '.bak.codebuddy-hud'), false);
  });
});

test('uninstall preserves post-install edits and archives original text before retiring backup', () => {
  withInstallerFixture((options, root) => {
    const raw = '{\n // original comment\n "model":"before",\n "statusLine":{"command":"old-command","padding":2}\n}\n';
    fs.writeFileSync(options.settingsPath, raw);
    setup(options);
    const installed = fs.readFileSync(options.settingsPath, 'utf8');
    fs.writeFileSync(options.settingsPath, installed.replace('"before"', '"after"'));
    uninstall(options);
    assert.equal(fs.readFileSync(options.settingsPath, 'utf8'), raw.replace('"before"', '"after"'));
    const retained = fs.readdirSync(root).filter(name => name.startsWith('settings.json.bak.codebuddy-hud.retained-'));
    assert.equal(retained.length, 1);
    assert.equal(fs.readFileSync(path.join(root, retained[0]), 'utf8'), raw);
    assert.equal(fs.existsSync(options.settingsPath + '.bak.codebuddy-hud'), false);

    // The retained original must never become the active snapshot for a new install.
    setup(options);
    assert.equal(fs.readFileSync(options.settingsPath + '.bak.codebuddy-hud', 'utf8'), raw.replace('"before"', '"after"'));
  });
});

test('uninstall restores an explicitly disabled or non-object original statusLine', () => {
  withInstallerFixture(options => {
    for (const value of ['null', 'false', '"disabled"', '[]']) {
      const raw = `{\n // original\n "statusLine": ${value},\n "model":"keep"\n}\n`;
      fs.writeFileSync(options.settingsPath, raw);
      setup(options);
      uninstall(options);
      assert.equal(fs.readFileSync(options.settingsPath, 'utf8'), raw);
    }
  });
});

test('setup and uninstall round-trip exact JSONC when statusLine was absent', () => {
  withInstallerFixture(options => {
    for (const raw of ['{}', '{"model":"keep"}', '\ufeff{\r\n // keep\r\n "model":"keep",\r\n}\r\n', '// comment only']) {
      fs.writeFileSync(options.settingsPath, raw);
      setup(options);
      uninstall(options);
      assert.equal(fs.readFileSync(options.settingsPath, 'utf8'), raw);
    }
  });
});

test('legacy settings that already lost comments keep the original recovery text', () => {
  withInstallerFixture((options, root) => {
    const original = '{\n // original note\n "model":"before",\n "statusLine":{"command":"old-command"}\n}\n';
    fs.writeFileSync(options.settingsPath + '.bak.codebuddy-hud', original);
    // Simulate a legacy setup that reserialized settings, then a later user edit.
    fs.writeFileSync(options.settingsPath, '{"model":"after","statusLine":{"command":"codebuddy-hud"}}');
    uninstall(options);
    assert.equal(fs.readFileSync(options.settingsPath, 'utf8'), '{"model":"after","statusLine":{"command":"old-command"}}');
    const retained = fs.readdirSync(root).find(name => name.includes('.retained-'));
    assert.ok(retained);
    assert.equal(fs.readFileSync(path.join(root, retained), 'utf8'), original);
  });
});

test('uninstall retains original backup when a recovery copy cannot be written', () => {
  withInstallerFixture(options => {
    const raw = '{"model":"before","statusLine":{"command":"old-command"}}';
    fs.writeFileSync(options.settingsPath, raw);
    setup(options);
    fs.writeFileSync(options.settingsPath, fs.readFileSync(options.settingsPath, 'utf8').replace('"before"', '"after"'));
    const openSync = fs.openSync;
    try {
      fs.openSync = function (file, ...args) {
        if (String(file).includes('.retained-')) throw new Error('recovery copy write failed');
        return openSync.call(this, file, ...args);
      };
      uninstall(options);
      assert.equal(fs.readFileSync(options.settingsPath + '.bak.codebuddy-hud', 'utf8'), raw);
      assert.equal(parseSettingsJson(fs.readFileSync(options.settingsPath, 'utf8')).statusLine.command, 'old-command');
    } finally {
      fs.openSync = openSync;
    }
  });
});

test('setup with an invalid theme config aborts without changing settings or creating a shim', () => {
  withInstallerFixture(options => {
    const raw = '{"model":"keep"}';
    fs.writeFileSync(options.settingsPath, raw);
    fs.mkdirSync(process.env.CODEBUDDY_HOME, { recursive: true });
    const configPath = path.join(process.env.CODEBUDDY_HOME, 'codebuddy-hud.config.json');
    fs.writeFileSync(configPath, '{"display":{"showCost":false},}');
    assert.throws(() => setup({ ...options, theme: 'amber' }));
    assert.equal(fs.readFileSync(options.settingsPath, 'utf8'), raw);
    assert.equal(fs.readFileSync(configPath, 'utf8'), '{"display":{"showCost":false},}');
    assert.equal(fs.existsSync(options.hudBin.replace(/\.js$/, '.cmd')), false);
  });
});

test('setup and uninstall never delete an unmarked user skill directory', () => {
  withInstallerFixture(options => {
    fs.mkdirSync(options.targetSkillDir, { recursive: true });
    const note = path.join(options.targetSkillDir, 'MY-NOTES.md');
    fs.writeFileSync(note, 'user data');
    const userSkill = path.join(options.targetSkillDir, 'SKILL.md');
    fs.writeFileSync(userSkill, '# user skill');
    uninstall(options); // Even when HUD was never installed.
    assert.equal(fs.readFileSync(note, 'utf8'), 'user data');
    setup(options);
    setup(options);
    assert.equal(fs.readFileSync(note, 'utf8'), 'user data');
    assert.equal(fs.readFileSync(userSkill, 'utf8'), '# user skill');
    uninstall(options);
    assert.equal(fs.readFileSync(note, 'utf8'), 'user data');
  });
});

test('setup and uninstall leave foreign skill links and their targets untouched', () => {
  withInstallerFixture((options, root) => {
    const other = path.join(root, 'user-source');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'MY-NOTES.md'), 'user data');
    fs.mkdirSync(path.dirname(options.targetSkillDir), { recursive: true });
    fs.symlinkSync(other, options.targetSkillDir, process.platform === 'win32' ? 'junction' : 'dir');
    setup(options);
    uninstall(options);
    assert.equal(fs.lstatSync(options.targetSkillDir).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(other, 'MY-NOTES.md'), 'utf8'), 'user data');
  });
});

test('copy fallback marks only its copy and can update and uninstall it', () => {
  withInstallerFixture(options => {
    const symlinkSync = fs.symlinkSync;
    try {
      fs.symlinkSync = () => { throw new Error('links unavailable'); };
      deploySkill(options, options.hudBin, options.platform);
      assert.equal(fs.lstatSync(options.targetSkillDir).isSymbolicLink(), false);
      assert.equal(fs.readFileSync(path.join(options.targetSkillDir, '.codebuddy-hud-managed'), 'utf8'), 'codebuddy-hud\n');
      assert.equal(fs.existsSync(path.join(options.sourceSkillDir, '.codebuddy-hud-managed')), false);
      fs.writeFileSync(path.join(options.sourceSkillDir, 'SKILL.md'), '# updated');
      deploySkill(options, options.hudBin, options.platform);
      assert.equal(fs.readFileSync(path.join(options.targetSkillDir, 'SKILL.md'), 'utf8'), '# updated');
    } finally {
      fs.symlinkSync = symlinkSync;
    }
    uninstall(options);
    assert.equal(fs.existsSync(options.targetSkillDir), false);
    assert.equal(fs.readFileSync(path.join(options.sourceSkillDir, 'SKILL.md'), 'utf8'), '# updated');
  });
});

test('failed link removal never falls back to deleting or copying over the target', () => {
  withInstallerFixture(options => {
    deploySkill(options, options.hudBin, options.platform);
    assert.equal(fs.lstatSync(options.targetSkillDir).isSymbolicLink(), true);
    const unlinkSync = fs.unlinkSync;
    const cpSync = fs.cpSync;
    let copyAttempted = false;
    try {
      fs.unlinkSync = function (file, ...args) {
        if (file === options.targetSkillDir) throw new Error('link is locked');
        return unlinkSync.call(this, file, ...args);
      };
      fs.cpSync = () => { copyAttempted = true; throw new Error('must not copy over a locked link'); };
      deploySkill(options, options.hudBin, options.platform);
      uninstall(options);
      assert.equal(copyAttempted, false);
      assert.equal(fs.lstatSync(options.targetSkillDir).isSymbolicLink(), true);
      assert.equal(fs.readFileSync(path.join(options.sourceSkillDir, 'SKILL.md'), 'utf8'), '# hud-config');
      assert.equal(fs.existsSync(path.join(options.sourceSkillDir, '.codebuddy-hud-managed')), false);
    } finally {
      fs.unlinkSync = unlinkSync;
      fs.cpSync = cpSync;
    }
  });
});

describe('buildStatusLineCommand', () => {
  test('is exported as a pure function without side effects', () => {
    assert.equal(typeof buildStatusLineCommand, 'function');
    const res1 = buildStatusLineCommand('linux', POSIX_HUD, POSIX_NODE);
    const res2 = buildStatusLineCommand('linux', POSIX_HUD, POSIX_NODE);
    assert.equal(res1, res2);
  });

  test('win32 -> unquoted safe .cmd path for the containment launcher', () => {
    const hudBin = 'C:\\Users\\me\\proj\\runtime\\bin\\codebuddy-hud.js';
    const command = buildStatusLineCommand('win32', hudBin, 'C:\\Program Files\\nodejs\\node.exe');

    assert.equal(command, 'C:\\Users\\me\\proj\\runtime\\bin\\codebuddy-hud.cmd');
    assert.ok(!command.includes('.js'));
  });

  test('win32 retains quotes for paths containing spaces', () => {
    assert.equal(
      buildStatusLineCommand('win32', 'C:\\My Project\\codebuddy-hud.js', 'C:\\node.exe'),
      '"C:\\My Project\\codebuddy-hud.cmd"',
    );
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

test('uninstall keeps the Windows shim when settings.json cannot be cleaned', () => {
  const originalSettingsPath = process.env.CODEBUDDY_SETTINGS_PATH;
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-shim-keep-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const settingsLink = path.join(tempRoot, 'settings-hardlink.json');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const hudBin = path.join(runtimeDir, 'bin', 'codebuddy-hud.js');
  const cmdShim = hudBin.replace(/\.js$/, '.cmd');
  fs.mkdirSync(path.dirname(hudBin), { recursive: true });
  fs.writeFileSync(hudBin, '#!/usr/bin/env node\n');
  fs.writeFileSync(cmdShim, '@echo off\r\n');
  const installedSettings = { statusLine: { type: 'command', command: `"${cmdShim}"` } };
  fs.writeFileSync(settingsPath, JSON.stringify(installedSettings, null, 2));
  fs.linkSync(settingsPath, settingsLink); // nlink > 1 → atomic replace refused
  process.env.CODEBUDDY_SETTINGS_PATH = settingsPath;
  process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');

  const logs = [];
  const originalLog = console.log;
  try {
    console.log = (...args) => { logs.push(args.join(' ')); };
    uninstall({ settingsPath, runtimeDir, platform: 'win32' });

    assert.equal(fs.existsSync(cmdShim), true,
      `shim must survive a failed settings cleanup:\n${logs.join('\n')}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), installedSettings,
      'settings.json must be left untouched');
    assert.ok(logs.join('\n').includes('kept Windows shim'), logs.join('\n'));
    assert.ok(!logs.join('\n').includes('Removed statusLine from settings.json'),
      'failed write must not claim statusLine was removed');
  } finally {
    console.log = originalLog;
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

test('setup keeps commas followed by closing delimiters inside settings strings', () => {
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-jsonc-string-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const hudBin = path.join(runtimeDir, 'bin', 'codebuddy-hud.js');
  try {
    fs.mkdirSync(path.dirname(hudBin), { recursive: true });
    fs.writeFileSync(hudBin, '#!/usr/bin/env node\n');
    fs.writeFileSync(settingsPath, '{"command":"echo ,}","items":["x,]",]}');
    process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');

    setup({ settingsPath, runtimeDir, platform: 'linux', nodeExe: '/usr/bin/node' });

    const installed = parseSettingsJson(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(installed.command, 'echo ,}');
    assert.deepEqual(installed.items, ['x,]']);
  } finally {
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('uninstall retains a backup when the settings write fails', () => {
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-backup-retain-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const linkedSettingsPath = path.join(tempRoot, 'linked-settings.json');
  const backupPath = settingsPath + '.bak.codebuddy-hud';
  const runtimeDir = path.join(tempRoot, 'runtime');
  const installedSettings = JSON.stringify({
    statusLine: { type: 'command', command: 'node codebuddy-hud.js' },
  });
  const backupSettings = JSON.stringify({
    statusLine: { type: 'command', command: 'custom-statusline' },
  });
  try {
    fs.writeFileSync(settingsPath, installedSettings);
    fs.linkSync(settingsPath, linkedSettingsPath);
    fs.writeFileSync(backupPath, backupSettings);
    process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');

    uninstall({ settingsPath, runtimeDir, platform: 'linux' });

    assert.equal(fs.readFileSync(settingsPath, 'utf8'), installedSettings);
    assert.equal(fs.readFileSync(linkedSettingsPath, 'utf8'), installedSettings);
    assert.equal(fs.readFileSync(backupPath, 'utf8'), backupSettings);
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

test('buildCmdShimContent includes @chcp 65001 when hudBin contains non-ASCII characters', () => {
  const shim = buildCmdShimContent('C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\谢文灿\\codebuddy-hud.js');
  if (process.platform === 'win32') {
    assert.ok(shim.startsWith('@chcp 65001 >nul\r\n@echo off\r\n'));
  }
  assert.ok(shim.includes('%~dp0codebuddy-hud.js'));
});

test('uninstall preserves settings and backup when reading settings fails', () => {
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const originalReadFile = fs.readFileSync;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-uninst-unreadable-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const backupPath = settingsPath + '.bak.codebuddy-hud';
  const settings = '{"model":"keep","statusLine":{"command":"codebuddy-hud"}}';
  const backup = '{"statusLine":{"command":"previous-command"}}';
  fs.writeFileSync(settingsPath, settings);
  fs.writeFileSync(backupPath, backup);
  try {
    process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');
    fs.readFileSync = function (file, ...args) {
      if (file === settingsPath) {
        const error = new Error('simulated read failure');
        error.code = 'EACCES';
        throw error;
      }
      return originalReadFile.call(this, file, ...args);
    };
    uninstall({ settingsPath, runtimeDir: path.join(tempRoot, 'runtime'), platform: 'win32' });
    assert.equal(originalReadFile(settingsPath, 'utf8'), settings);
    assert.equal(originalReadFile(backupPath, 'utf8'), backup);
  } finally {
    fs.readFileSync = originalReadFile;
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('uninstall preserves JSONC settings with comments and trailing commas without wiping', () => {
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-uninst-jsonc-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const jsoncContent = '\ufeff{\n  // User comments\n  "model": "deepseek-v4",\n  "statusLine": {\n    "command": "node runtime/bin/codebuddy-hud.js"\n  },\n  /* trailing comma */\n}\n';
  fs.writeFileSync(settingsPath, jsoncContent, 'utf8');

  try {
    process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');
    uninstall({ settingsPath, runtimeDir, platform: 'win32' });
    const contentAfter = fs.readFileSync(settingsPath, 'utf8');
    assert.equal(contentAfter, jsoncContent.replace('"statusLine": {\n    "command": "node runtime/bin/codebuddy-hud.js"\n  },', ''));
    const parsed = parseSettingsJson(contentAfter);
    assert.equal(parsed.model, 'deepseek-v4');
    assert.equal(parsed.statusLine, undefined);
  } finally {
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('uninstall aborts and preserves original file if settings.json is corrupt syntax', () => {
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-uninst-corrupt-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const corruptContent = '{ not valid json at all ...';
  fs.writeFileSync(settingsPath, corruptContent, 'utf8');

  try {
    process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');
    uninstall({ settingsPath, runtimeDir, platform: 'win32' });
    const contentAfter = fs.readFileSync(settingsPath, 'utf8');
    assert.equal(contentAfter, corruptContent, 'corrupted file must not be overwritten or wiped to {}');
  } finally {
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// A backup may itself have been taken over an earlier HUD install (another
// checkout, or the `npm link` global shim). Uninstall must remove the HUD
// rather than reinstating whichever copy the backup happens to record.
test('uninstall does not reinstate a codebuddy-hud statusLine recorded in the backup', () => {
  const originalSettingsPath = process.env.CODEBUDDY_SETTINGS_PATH;
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-stale-backup-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const hudBin = path.join(runtimeDir, 'bin', 'codebuddy-hud.js');
  const cmdShim = hudBin.replace(/\.js$/, '.cmd');
  const backupPath = settingsPath + '.bak.codebuddy-hud';
  fs.mkdirSync(path.dirname(hudBin), { recursive: true });
  fs.writeFileSync(hudBin, '#!/usr/bin/env node\n');
  fs.writeFileSync(cmdShim, '@echo off\r\n');
  fs.writeFileSync(backupPath, JSON.stringify({
    theme: 'dark',
    statusLine: { type: 'command', command: '"D:\\npm-global\\codebuddy-hud.cmd"', padding: 0 },
  }, null, 2));
  fs.writeFileSync(settingsPath, JSON.stringify({
    statusLine: { type: 'command', command: `"${cmdShim}"`, padding: 0 },
  }, null, 2));
  process.env.CODEBUDDY_SETTINGS_PATH = settingsPath;
  process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');

  try {
    uninstall({ settingsPath, runtimeDir, platform: 'win32' });
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(after.statusLine, undefined, 'a HUD statusLine must not survive uninstall');
    assert.equal(after.theme, undefined, 'only statusLine may be written back from the backup');
    assert.equal(fs.existsSync(backupPath), false, 'the backup must still be consumed');
  } finally {
    if (originalSettingsPath === undefined) delete process.env.CODEBUDDY_SETTINGS_PATH;
    else process.env.CODEBUDDY_SETTINGS_PATH = originalSettingsPath;
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('uninstall treats a bare codebuddy-hud command in the backup as HUD', () => {
  const originalSettingsPath = process.env.CODEBUDDY_SETTINGS_PATH;
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-path-backup-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const hudBin = path.join(runtimeDir, 'bin', 'codebuddy-hud.js');
  const cmdShim = hudBin.replace(/\.js$/, '.cmd');
  const backupPath = settingsPath + '.bak.codebuddy-hud';
  fs.mkdirSync(path.dirname(hudBin), { recursive: true });
  fs.writeFileSync(hudBin, '#!/usr/bin/env node\n');
  fs.writeFileSync(cmdShim, '@echo off\r\n');
  // The `npm link` global shim is invoked by bare name, so no directory ever
  // appears in the recorded command.
  fs.writeFileSync(backupPath, JSON.stringify({
    statusLine: { type: 'command', command: 'codebuddy-hud', padding: 0 },
  }, null, 2));
  fs.writeFileSync(settingsPath, JSON.stringify({
    statusLine: { type: 'command', command: `"${cmdShim}"`, padding: 0 },
  }, null, 2));
  process.env.CODEBUDDY_SETTINGS_PATH = settingsPath;
  process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');

  try {
    uninstall({ settingsPath, runtimeDir, platform: 'win32' });
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(after.statusLine, undefined, 'a bare codebuddy-hud command must not be restored');
    assert.equal(fs.existsSync(backupPath), false, 'the backup must still be consumed');
  } finally {
    if (originalSettingsPath === undefined) delete process.env.CODEBUDDY_SETTINGS_PATH;
    else process.env.CODEBUDDY_SETTINGS_PATH = originalSettingsPath;
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('uninstall leaves a user statusLine that replaced the HUD', () => {
  const originalSettingsPath = process.env.CODEBUDDY_SETTINGS_PATH;
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-userline-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const backupPath = settingsPath + '.bak.codebuddy-hud';
  const userStatusLine = { type: 'command', command: 'my-own-statusline', padding: 1 };
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify({
    statusLine: { type: 'command', command: '"D:\\old\\runtime\\bin\\codebuddy-hud.cmd"', padding: 0 },
  }, null, 2));
  fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: userStatusLine }, null, 2));
  process.env.CODEBUDDY_SETTINGS_PATH = settingsPath;
  process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');

  try {
    uninstall({ settingsPath, runtimeDir, platform: 'linux' });
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(after.statusLine, userStatusLine, 'a user statusLine must not be destroyed');
    assert.equal(fs.existsSync(backupPath), false, 'the backup must still be consumed');
  } finally {
    if (originalSettingsPath === undefined) delete process.env.CODEBUDDY_SETTINGS_PATH;
    else process.env.CODEBUDDY_SETTINGS_PATH = originalSettingsPath;
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('uninstall keeps a statusLine set after install instead of restoring an older user command', () => {
  const originalSettingsPath = process.env.CODEBUDDY_SETTINGS_PATH;
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-laterline-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const backupPath = settingsPath + '.bak.codebuddy-hud';
  const beforeInstall = { type: 'command', command: 'before-install-statusline', padding: 0 };
  const afterInstall = { type: 'command', command: 'after-install-statusline', padding: 1 };
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify({ statusLine: beforeInstall }, null, 2));
  fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: afterInstall }, null, 2));
  process.env.CODEBUDDY_SETTINGS_PATH = settingsPath;
  process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');
  try {
    uninstall({ settingsPath, runtimeDir, platform: 'linux' });
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(after.statusLine, afterInstall, 'the later user statusLine must win over the backup');
    assert.equal(fs.existsSync(backupPath), false, 'the backup must still be consumed');
  } finally {
    if (originalSettingsPath === undefined) delete process.env.CODEBUDDY_SETTINGS_PATH;
    else process.env.CODEBUDDY_SETTINGS_PATH = originalSettingsPath;
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('setup and uninstall manage skill directory correctly', () => {
  const originalSettingsPath = process.env.CODEBUDDY_SETTINGS_PATH;
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-skill-test-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const hudBin = path.join(runtimeDir, 'bin', 'codebuddy-hud.js');
  const sourceSkillDir = path.join(tempRoot, 'source-skills', 'hud-config');
  const targetSkillDir = path.join(tempRoot, 'home', 'skills', 'hud-config');
  const targetSkillFile = path.join(targetSkillDir, 'SKILL.md');

  fs.mkdirSync(path.dirname(hudBin), { recursive: true });
  fs.writeFileSync(hudBin, '#!/usr/bin/env node\n');
  fs.mkdirSync(sourceSkillDir, { recursive: true });
  fs.writeFileSync(path.join(sourceSkillDir, 'SKILL.md'), '# Skill Definition\nname: hud-config\n');

  process.env.CODEBUDDY_SETTINGS_PATH = settingsPath;
  process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');

  try {
    // 1. Initial setup creates skill link/copy
    setup({ settingsPath, runtimeDir, sourceSkillDir, targetSkillDir, platform: process.platform });
    assert.equal(fs.existsSync(targetSkillFile), true, 'target SKILL.md should exist after setup');
    assert.ok(fs.readFileSync(targetSkillFile, 'utf8').includes('name: hud-config'));

    // 2. Re-setup replaces cleanly without error (idempotency)
    fs.writeFileSync(path.join(sourceSkillDir, 'SKILL.md'), '# Skill Definition v2\nname: hud-config\n');
    setup({ settingsPath, runtimeDir, sourceSkillDir, targetSkillDir, platform: process.platform });
    assert.equal(fs.existsSync(targetSkillFile), true, 'target SKILL.md should exist after second setup');
    assert.ok(fs.readFileSync(targetSkillFile, 'utf8').includes('v2'));

    // 3. Uninstall removes target skill without touching source
    uninstall({ settingsPath, runtimeDir, sourceSkillDir, targetSkillDir, platform: process.platform });
    assert.equal(fs.existsSync(targetSkillDir), false, 'target skill directory should be removed on uninstall');
    assert.equal(fs.existsSync(path.join(sourceSkillDir, 'SKILL.md')), true, 'source skill directory should remain intact');
  } finally {
    if (originalSettingsPath === undefined) delete process.env.CODEBUDDY_SETTINGS_PATH;
    else process.env.CODEBUDDY_SETTINGS_PATH = originalSettingsPath;
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('setup safely skips skill deployment when sourceSkillDir has no SKILL.md', () => {
  const originalSettingsPath = process.env.CODEBUDDY_SETTINGS_PATH;
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-skill-skip-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const hudBin = path.join(runtimeDir, 'bin', 'codebuddy-hud.js');
  const emptySourceDir = path.join(tempRoot, 'empty-skills', 'hud-config');
  const targetSkillDir = path.join(tempRoot, 'home', 'skills', 'hud-config');

  fs.mkdirSync(path.dirname(hudBin), { recursive: true });
  fs.writeFileSync(hudBin, '#!/usr/bin/env node\n');
  fs.mkdirSync(emptySourceDir, { recursive: true });

  process.env.CODEBUDDY_SETTINGS_PATH = settingsPath;
  process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');

  try {
    setup({ settingsPath, runtimeDir, sourceSkillDir: emptySourceDir, targetSkillDir, platform: process.platform });
    assert.equal(fs.existsSync(targetSkillDir), false, 'target skill directory should not be created');
  } finally {
    if (originalSettingsPath === undefined) delete process.env.CODEBUDDY_SETTINGS_PATH;
    else process.env.CODEBUDDY_SETTINGS_PATH = originalSettingsPath;
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('setup ignores deployment when sourceDir and targetDir resolve to the same path', () => {
  const originalSettingsPath = process.env.CODEBUDDY_SETTINGS_PATH;
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-skill-self-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const hudBin = path.join(runtimeDir, 'bin', 'codebuddy-hud.js');
  const sameSkillDir = path.join(tempRoot, 'skills', 'hud-config');

  fs.mkdirSync(path.dirname(hudBin), { recursive: true });
  fs.writeFileSync(hudBin, '#!/usr/bin/env node\n');
  fs.mkdirSync(sameSkillDir, { recursive: true });
  fs.writeFileSync(path.join(sameSkillDir, 'SKILL.md'), '# Original');

  process.env.CODEBUDDY_SETTINGS_PATH = settingsPath;
  process.env.CODEBUDDY_HOME = path.join(tempRoot, 'home');

  try {
    setup({ settingsPath, runtimeDir, sourceSkillDir: sameSkillDir, targetSkillDir: sameSkillDir, platform: process.platform });
    assert.equal(fs.existsSync(path.join(sameSkillDir, 'SKILL.md')), true, 'file should remain untouched');
    assert.equal(fs.readFileSync(path.join(sameSkillDir, 'SKILL.md'), 'utf8'), '# Original');
  } finally {
    if (originalSettingsPath === undefined) delete process.env.CODEBUDDY_SETTINGS_PATH;
    else process.env.CODEBUDDY_SETTINGS_PATH = originalSettingsPath;
    if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
