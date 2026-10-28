'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE_MODE = 0o600;
const MAX_SYMLINK_DEPTH = 40;

function isSettingsObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      // Keep a separator so a comment can never join two JSON tokens.
      out += ' ';
      i++;
      while (i + 1 < text.length && text[i + 1] !== '\n' && text[i + 1] !== '\r') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) throw new SyntaxError('Unterminated block comment in settings.json');
      // Preserve line boundaries for useful JSON parse locations and keep the
      // surrounding values separated after removing the comment.
      out += ' ' + text.slice(i + 2, end).replace(/[^\r\n]/g, ' ') + ' ';
      i = end + 1;
      continue;
    }

    out += ch;
  }

  return out;
}

function stripTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ',') {
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] === '}' || text[next] === ']') continue;
    }
    out += ch;
  }

  return out;
}

function parseSettingsJson(raw) {
  let cleaned = String(raw);
  if (cleaned.charCodeAt(0) === 0xFEFF) cleaned = cleaned.slice(1);
  cleaned = stripTrailingCommas(stripJsonComments(cleaned)).trim();
  if (!cleaned) return {};
  return JSON.parse(cleaned);
}

// Locate direct object members without reserializing JSONC. Validation stays
// with the existing parser; tokens only retain offsets for surgical edits.
function settingsMembers(raw) {
  if (!isSettingsObject(parseSettingsJson(raw))) {
    throw new Error('settings.json root must be a JSON object');
  }
  const tokens = [];
  const pattern = /"(?:\\[\s\S]|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|[{}\[\]:,]|[^\s{}\[\]:,"/]+/g;
  for (const match of raw.matchAll(pattern)) {
    if (match[0].startsWith('//') || match[0].startsWith('/*')) continue;
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  const members = [];
  let i = 1;
  while (i < tokens.length && tokens[i].text !== '}') {
    const key = tokens[i];
    i += 2; // key and colon
    const valueStart = tokens[i].start;
    let depth = 0;
    do {
      const token = tokens[i++].text;
      if (token === '{' || token === '[') depth++;
      if (token === '}' || token === ']') depth--;
    } while (depth > 0);
    const valueEnd = tokens[i - 1].end;
    const comma = tokens[i].text === ',' ? tokens[i++].start : null;
    members.push({ key: JSON.parse(key.text), start: key.start, valueStart, valueEnd, comma });
  }
  return { members, close: tokens.length ? tokens[tokens.length - 1].start : null };
}

function getSettingsProperty(raw, key) {
  const matches = settingsMembers(raw).members.filter(member => member.key === key);
  const member = matches[matches.length - 1]; // JSON's last duplicate key wins.
  return member ? raw.slice(member.valueStart, member.valueEnd) : undefined;
}

// valueRaw is a validated JSON/JSONC value; undefined removes the property.
// The same small helper edits the statusLine object and its type/command keys.
function editSettingsProperty(raw, key, valueRaw) {
  const { members, close } = settingsMembers(raw);
  const matches = members.filter(member => member.key === key);
  const member = matches[matches.length - 1];
  if (member) {
    if (valueRaw !== undefined) {
      parseSettingsJson(valueRaw);
      return raw.slice(0, member.valueStart) + valueRaw + raw.slice(member.valueEnd);
    }
    // Remove all duplicates so deleting the effective value cannot expose an
    // older HUD command. Leave surrounding comments and whitespace untouched.
    let result = raw.slice(0, member.start) + raw.slice(member.valueEnd);
    if (member.comma !== null) {
      const comma = member.start + member.comma - member.valueEnd;
      result = result.slice(0, comma) + result.slice(comma + 1);
    } else {
      const previous = members[members.indexOf(member) - 1];
      if (previous && previous.comma !== null) {
        result = result.slice(0, previous.comma) + result.slice(previous.comma + 1);
      }
    }
    return matches.length > 1 ? editSettingsProperty(result, key, undefined) : result;
  }
  if (valueRaw === undefined) return raw;
  parseSettingsJson(valueRaw);
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const property = `${JSON.stringify(key)}: ${valueRaw}`;
  if (close === null) return raw + (raw && !/[\r\n]$/.test(raw) ? eol : '') + `{${eol}  ${property}${eol}}`;

  const last = members[members.length - 1];
  const commaAt = last && last.comma === null ? last.valueEnd : null;
  const lineStart = raw.lastIndexOf('\n', close - 1) + 1;
  const closingIndent = raw.slice(lineStart, close);
  let at = close;
  let insertion = ` ${property}`;
  if (/^[\t ]*$/.test(closingIndent)) {
    at = lineStart;
    const first = members[0];
    const firstIndent = first ? raw.slice(raw.lastIndexOf('\n', first.start - 1) + 1, first.start) : '';
    const indent = firstIndent && /^[\t ]+$/.test(firstIndent) ? firstIndent : closingIndent + '  ';
    insertion = `${indent}${property}${last && last.comma !== null ? ',' : ''}${eol}`;
  }
  let result = raw.slice(0, at) + insertion + raw.slice(at);
  if (commaAt !== null) result = result.slice(0, commaAt) + ',' + result.slice(commaAt);
  return result;
}

function resolveWriteTarget(targetPath) {
  let current = path.resolve(String(targetPath));
  for (let depth = 0; depth < MAX_SYMLINK_DEPTH; depth++) {
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (err) {
      if (err && err.code === 'ENOENT') return current;
      throw err;
    }

    if (!stat.isSymbolicLink()) return current;
    const link = fs.readlinkSync(current);
    current = path.resolve(path.dirname(current), link);
  }
  throw new Error(`Too many symbolic links while resolving settings file: ${targetPath}`);
}

function readExistingMetadata(targetPath) {
  try {
    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) throw new Error(`Settings target is not a regular file: ${targetPath}`);
    if (stat.nlink > 1) {
      throw new Error(`Refusing to atomically replace settings file with multiple hard links: ${targetPath}`);
    }
    return {
      mode: stat.mode & 0o7777,
      uid: stat.uid,
      gid: stat.gid,
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function createTempPath(targetPath) {
  return `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function preservePosixMetadata(tempPath, metadata) {
  if (process.platform === 'win32') return;

  let stat = fs.statSync(tempPath);
  if (metadata && (stat.uid !== metadata.uid || stat.gid !== metadata.gid)) {
    fs.chownSync(tempPath, metadata.uid, metadata.gid);
  }
  const mode = metadata ? metadata.mode : DEFAULT_FILE_MODE;
  fs.chmodSync(tempPath, mode);

  stat = fs.statSync(tempPath);
  if ((stat.mode & 0o7777) !== mode || (metadata && (stat.uid !== metadata.uid || stat.gid !== metadata.gid))) {
    throw new Error(`Could not preserve settings file ownership or mode: ${tempPath}`);
  }
}

function atomicWriteSettingsFile(targetPath, content) {
  const writeTarget = resolveWriteTarget(targetPath);
  const metadata = readExistingMetadata(writeTarget);
  const dir = path.dirname(writeTarget);
  fs.mkdirSync(dir, { recursive: true });

  const tempPath = createTempPath(writeTarget);
  let tempCreated = false;
  try {
    const fd = fs.openSync(tempPath, 'wx', metadata ? metadata.mode : DEFAULT_FILE_MODE);
    tempCreated = true;
    try {
      fs.writeFileSync(fd, content, 'utf8');
    } finally {
      fs.closeSync(fd);
    }

    preservePosixMetadata(tempPath, metadata);
    fs.renameSync(tempPath, writeTarget);
    tempCreated = false;
  } catch (err) {
    if (tempCreated) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
    throw err;
  }
}

function writePrivateFileIfAbsent(filePath, content) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'wx', DEFAULT_FILE_MODE);
  } catch (err) {
    if (err && err.code === 'EEXIST') return false;
    throw err;
  }

  try {
    fs.writeFileSync(fd, content, 'utf8');
    if (process.platform !== 'win32') fs.chmodSync(filePath, DEFAULT_FILE_MODE);
  } catch (err) {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(filePath); } catch {}
    throw err;
  }
  fs.closeSync(fd);
  return true;
}

module.exports = {
  atomicWriteSettingsFile,
  isSettingsObject,
  parseSettingsJson,
  getSettingsProperty,
  editSettingsProperty,
  resolveWriteTarget,
  writePrivateFileIfAbsent,
};
