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
  resolveWriteTarget,
  writePrivateFileIfAbsent,
};
