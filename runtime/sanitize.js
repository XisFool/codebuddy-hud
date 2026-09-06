'use strict';

/**
 * Strip ANSI escape sequences, OSC sequences, and control characters
 * from external strings to prevent terminal injection.
 *
 * Also stripped: C1 control bytes (U+0080-U+009F, incl. the single-byte 0x9B
 * CSI) and bidi/format controls (LRM/RLM/U+202A-E/isolates) — JSON.stringify
 * does not escape either range, so both used to slip through invisibly, and
 * U+202E can visually reorder the rendered line.
 */
function sanitizeTerminalText(value, maxLength) {
  if (maxLength === undefined) maxLength = 120;
  if (value === undefined || value === null) return '';
  const cleaned = String(value)
    .replace(/\x1b\][^\x07]*?(?:\x07|\x1b\\|$)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060\u061c\u2066-\u206f]/g, '');
  if (cleaned.length <= maxLength) return cleaned;
  let end = maxLength;
  if (end > 0 && cleaned.charCodeAt(end - 1) >= 0xD800 && cleaned.charCodeAt(end - 1) <= 0xDBFF) {
    end--;
  }
  return cleaned.slice(0, end);
}

module.exports = { sanitizeTerminalText };
