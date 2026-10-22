import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeTerminalText } = require('../../runtime/sanitize.js');

describe('sanitizeTerminalText', () => {
  it('returns empty string for null/undefined', () => {
    assert.equal(sanitizeTerminalText(null), '');
    assert.equal(sanitizeTerminalText(undefined), '');
  });

  it('passes through clean strings', () => {
    assert.equal(sanitizeTerminalText('hello world'), 'hello world');
  });

  it('strips ANSI CSI sequences', () => {
    assert.equal(sanitizeTerminalText('\x1b[31mred\x1b[0m'), 'red');
    assert.equal(sanitizeTerminalText('\x1b[1;32mbold green\x1b[0m'), 'bold green');
  });

  it('strips OSC sequences', () => {
    assert.equal(sanitizeTerminalText('\x1b]0;title\x07text'), 'text');
    assert.equal(sanitizeTerminalText('\x1b]8;;url\x1b\\link'), 'link');
  });

  it('strips control characters', () => {
    assert.equal(sanitizeTerminalText('a\x00b\x1fc'), 'abc');
    assert.equal(sanitizeTerminalText('line1\r\nline2'), 'line1line2');
  });

  it('truncates to maxLength', () => {
    assert.equal(sanitizeTerminalText('abcdefghij', 5), 'abcde');
  });

  it('converts non-string values', () => {
    assert.equal(sanitizeTerminalText(42), '42');
    assert.equal(sanitizeTerminalText(true), 'true');
  });

  it('strips C1 control bytes including the single-byte CSI 0x9B', () => {
    const out = sanitizeTerminalText('x\u009B2yy');
    assert.ok(!out.includes('\u009B'), 'C1 CSI survived');
    // 0x90 is the C1 DCS introducer and 0x9C its ST terminator: the string
    // sequence is removed whole — payload included — not just the two bytes.
    assert.equal(sanitizeTerminalText('a\u0090b\u009cc'), 'ac');
  });

  it('strips DCS/APC/PM/SOS control strings without leaking their payload', () => {
    assert.equal(sanitizeTerminalText('main\x1bP+q544e\x1b\\'), 'main');
    assert.equal(sanitizeTerminalText('file\x1b_Gimage-data\x1b\\'), 'file');
    assert.equal(sanitizeTerminalText('a\x1b^private\x1b\\b'), 'ab');
    assert.equal(sanitizeTerminalText('a\x1bXsos-payload\x1b\\b'), 'ab');
    // Unterminated string sequence: swallowed through end of input.
    assert.equal(sanitizeTerminalText('a\x1bPunterminated'), 'a');
    // Single-byte C1 forms: CSI params and OSC payload must not surface as text.
    assert.equal(sanitizeTerminalText('x\x9b31mred\x9b0m'), 'xred');
    assert.equal(sanitizeTerminalText('\x9d0;title\x07text'), 'text');
  });

  it('strips bidi and invisible formatting controls', () => {
    assert.ok(!sanitizeTerminalText('evil\u202Emore').includes('\u202E'), 'RTL override survived');
    assert.equal(sanitizeTerminalText('a\u200eb\u200fc'), 'abc');
    assert.ok(!sanitizeTerminalText('x\u2066y\u2069').includes('\u2066'));
  });

  it('still passes legitimate non-ASCII text through', () => {
    assert.equal(sanitizeTerminalText('分支/中文/naïve'), '分支/中文/naïve');
  });

  it('strips U+2028 and U+2029 line/paragraph separators to prevent newline injection', () => {
    assert.equal(sanitizeTerminalText('line\u2028break\u2029paragraph'), 'linebreakparagraph');
  });

  it('strips zero-width characters (U+200B..U+200D, U+2060, U+061C)', () => {
    assert.equal(sanitizeTerminalText('zero\u200Bwidth\u200Cnon\u200Djoiner\u2060word\u061Cmark'), 'zerowidthnonjoinerwordmark');
  });

  it('preserves multi-byte unicode emojis correctly', () => {
    assert.equal(sanitizeTerminalText('🚀 rocket ⚙ gear ◂ queue'), '🚀 rocket ⚙ gear ◂ queue');
  });

  it('leaves no executable escape prefix after truncation or malformed sequences', () => {
    const value = 'ok\x1b[31\x1b]8;;https://example.invalid\x1b\\link\x9b2J\u202eevil';
    const clean = sanitizeTerminalText(value);
    assert.ok(!clean.includes('\x1b'));
    assert.ok(!clean.includes('\x9b'));
    assert.ok(!/[\u202a-\u202e\u2066-\u2069]/.test(clean));
  });

  it('bounds an untrusted oversized string', () => {
    assert.equal(sanitizeTerminalText('x'.repeat(10000), 17).length, 17);
  });
});
