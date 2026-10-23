import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stripBinDirFromUserPath } = require('../../runtime/uninstall.js');

test('removes the HUD bin dir and keeps the other entries', () => {
  const result = stripBinDirFromUserPath(
    ['C:\\Windows', 'D:\\Tools\\hud\\bin', '%JAVA_HOME%\\bin', ''].join(';'),
    'D:\\Tools\\hud\\bin',
  );
  assert.equal(result.changed, true);
  assert.equal(result.value, 'C:\\Windows;%JAVA_HOME%\\bin');
});

test('leaves %VAR% entries untouched', () => {
  const result = stripBinDirFromUserPath('%USERPROFILE%\\bin;C:\\Windows', 'C:\\Windows');
  assert.equal(result.changed, true);
  assert.equal(result.value, '%USERPROFILE%\\bin');
});

test('removes a quoted entry', () => {
  const result = stripBinDirFromUserPath('"D:\\Tools\\hud\\bin";C:\\Windows', 'D:\\Tools\\hud\\bin');
  assert.equal(result.changed, true);
  assert.equal(result.value, 'C:\\Windows');
});

test('reports no change when the entry is absent', () => {
  const result = stripBinDirFromUserPath('C:\\Windows;D:\\Tools', 'E:\\Hud\\bin');
  assert.equal(result.changed, false);
});

test('matches case-insensitively on win32', { skip: process.platform !== 'win32' }, () => {
  const result = stripBinDirFromUserPath('d:\\tools\\HUD\\bin;C:\\Windows', 'D:\\Tools\\hud\\bin');
  assert.equal(result.changed, true);
  assert.equal(result.value, 'C:\\Windows');
});

test('handles an empty user Path', () => {
  const result = stripBinDirFromUserPath('', 'D:\\Tools\\hud\\bin');
  assert.deepEqual(result, { changed: false, value: '' });
});
