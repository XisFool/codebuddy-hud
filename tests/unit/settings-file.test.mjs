import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  atomicWriteSettingsFile,
  parseSettingsJson,
  writePrivateFileIfAbsent,
} = require('../../runtime/settings-file.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-settings-file-'));
}

test('JSONC parser preserves commas in strings while accepting trailing commas', () => {
  const raw = '{\n  "command": "echo ,}",\n  "items": ["x,]",],\n}';
  assert.deepEqual(parseSettingsJson(raw), {
    command: 'echo ,}',
    items: ['x,]'],
  });
});

test('JSONC comments cannot merge values and unterminated block comments fail', () => {
  assert.throws(
    () => parseSettingsJson('{"count": 1/* annotation */2}'),
    SyntaxError,
  );
  assert.throws(
    () => parseSettingsJson('{"count": 1 /* annotation'),
    /Unterminated block comment/,
  );
});

test('atomic settings writer refuses to replace a multiply-linked file', () => {
  const tempRoot = makeTempDir();
  const sourcePath = path.join(tempRoot, 'managed-settings.json');
  const settingsPath = path.join(tempRoot, 'settings.json');
  try {
    fs.writeFileSync(sourcePath, '{"before":true}');
    fs.linkSync(sourcePath, settingsPath);

    assert.throws(
      () => atomicWriteSettingsFile(settingsPath, '{"after":true}'),
      /multiple hard links/,
    );
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), '{"before":true}');
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{"before":true}');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('atomic settings writer follows symlinks and preserves POSIX metadata', {
  skip: process.platform === 'win32',
}, () => {
  const tempRoot = makeTempDir();
  const targetPath = path.join(tempRoot, 'managed-settings.json');
  const settingsPath = path.join(tempRoot, 'settings.json');
  try {
    fs.writeFileSync(targetPath, '{"before":true}', { mode: 0o600 });
    fs.chmodSync(targetPath, 0o600);
    const before = fs.statSync(targetPath);
    fs.symlinkSync(path.basename(targetPath), settingsPath, 'file');

    atomicWriteSettingsFile(settingsPath, '{"after":true}');

    const after = fs.statSync(targetPath);
    assert.equal(fs.lstatSync(settingsPath).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), '{"after":true}');
    assert.equal(after.mode & 0o7777, before.mode & 0o7777);
    assert.equal(after.uid, before.uid);
    assert.equal(after.gid, before.gid);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('new settings and backups are private by default', {
  skip: process.platform === 'win32',
}, () => {
  const tempRoot = makeTempDir();
  const settingsPath = path.join(tempRoot, 'settings.json');
  const backupPath = path.join(tempRoot, 'settings.json.bak.codebuddy-hud');
  try {
    atomicWriteSettingsFile(settingsPath, '{}');
    assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600);

    assert.equal(writePrivateFileIfAbsent(backupPath, '{}'), true);
    assert.equal(fs.statSync(backupPath).mode & 0o777, 0o600);
    assert.equal(writePrivateFileIfAbsent(backupPath, '{"changed":true}'), false);
    assert.equal(fs.readFileSync(backupPath, 'utf8'), '{}');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
