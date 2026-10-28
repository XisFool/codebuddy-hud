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
  getSettingsProperty,
  editSettingsProperty,
} = require('../../runtime/settings-file.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hud-settings-file-'));
}

test('JSONC field edits preserve BOM, CRLF, comments, escaped strings and unrelated bytes', () => {
  const raw = '\ufeff{\r\n\t// user comment\r\n\t"nested": [{"statusLine": "fake,} // /*"}],\r\n'
    + '\t"statusLine": {\r\n\t\t"type": "command", /* inline */\r\n'
    + '\t\t"command": "old\\\"cmd", // keep this\r\n\t\t"padding": 7,\r\n\t},\r\n}\r\n';
  const statusLine = getSettingsProperty(raw, 'statusLine');
  const updated = editSettingsProperty(statusLine, 'command', '"new"');
  const result = editSettingsProperty(raw, 'statusLine', updated);
  assert.equal(result, raw.replace('"old\\\"cmd"', '"new"'));
  assert.equal(parseSettingsJson(result).statusLine.padding, 7);
});

test('JSONC field insertion accepts empty, inline, multiline and trailing-comma objects', () => {
  for (const raw of ['', '\ufeff', '// original comment', '{ /* empty */ }', '{}', '{\r\n}',
    '{"a":1}', '{"a":1,}', '{\n  "a":1 // last comment\n}', '{\n  "a":1,\n}']) {
    const result = editSettingsProperty(raw, 'statusLine', '{"command":"codebuddy-hud"}');
    assert.deepEqual(parseSettingsJson(result), { ...parseSettingsJson(raw), statusLine: { command: 'codebuddy-hud' } });
    if (raw.includes('comment')) assert.ok(result.includes(raw.includes('original') ? '// original comment' : '// last comment'));
    if (raw.startsWith('\ufeff')) assert.ok(result.startsWith('\ufeff'));
    if (raw.includes('\r\n')) assert.ok(!/[^\r]\n/.test(result));
  }
});

test('JSONC field removal preserves surrounding text and valid comma placement', () => {
  const cases = [
    ['{"statusLine":1, /* keep */ "a":2}', '{ /* keep */ "a":2}'],
    ['{"a":2, "statusLine":1, "b":3}', '{"a":2,  "b":3}'],
    ['{"a":2, /* keep */ "statusLine":1}', '{"a":2 /* keep */ }'],
    ['{"a":2, "statusLine":1, /* keep */}', '{"a":2,  /* keep */}'],
    ['{\n // keep\n "statusLine":1\n}', '{\n // keep\n \n}'],
  ];
  for (const [raw, expected] of cases) {
    const result = editSettingsProperty(raw, 'statusLine', undefined);
    assert.equal(result, expected);
    assert.equal(parseSettingsJson(result).statusLine, undefined);
  }
});

test('JSONC field edits respect duplicate and escaped keys without exposing an older value', () => {
  const raw = '{"statusLine":{"command":"older"},"sta\\u0074usLine":{"command":"newer"},"keep":true}';
  assert.equal(getSettingsProperty(raw, 'statusLine'), '{"command":"newer"}');
  const updated = editSettingsProperty(raw, 'statusLine', '{"command":"replacement"}');
  assert.equal(parseSettingsJson(updated).statusLine.command, 'replacement');
  const removed = editSettingsProperty(updated, 'statusLine', undefined);
  assert.deepEqual(parseSettingsJson(removed), { keep: true });
  assert.equal(getSettingsProperty(removed, 'statusLine'), undefined);
});

test('JSONC field edits reject invalid input instead of constructing replacement settings', () => {
  for (const raw of ['[]', 'null', '1', '{ invalid', '{"a":1 /* unfinished']) {
    assert.throws(() => editSettingsProperty(raw, 'statusLine', '{}'));
  }
});

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
