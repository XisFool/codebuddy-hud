'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const REPO_RAW_BASE = process.env.CODEBUDDY_HUD_RAW_BASE || 'https://raw.githubusercontent.com/XisFool/codebuddy-hud/master';

const RUNTIME_FILES = [
  'package.json',
  '.codebuddy-plugin/plugin.json',
  'runtime/codebuddy-hud.config.json',
  'runtime/config.js',
  'runtime/doctor.js',
  'runtime/encoding.js',
  'runtime/git.js',
  'runtime/lang.js',
  'runtime/model-info.js',
  'runtime/parser.js',
  'runtime/paths.js',
  'runtime/renderer.js',
  'runtime/renderer/agents-render.js',
  'runtime/renderer/diff-render.js',
  'runtime/renderer/format.js',
  'runtime/renderer/lang.js',
  'runtime/sanitize.js',
  'runtime/session-stats.js',
  'runtime/settings-file.js',
  'runtime/statusline-installer.js',
  'runtime/theme-selector.js',
  'runtime/transcript.js',
  'runtime/uninstall.js',
  'runtime/update-checker.js',
  'runtime/bin/codebuddy-hud.js',
  'skills/hud-config/SKILL.md',
];

function getTargetDir() {
  if (process.env.CODEBUDDY_HUD_DIR) {
    return path.resolve(process.env.CODEBUDDY_HUD_DIR);
  }
  const home = process.env.CODEBUDDY_HOME || path.join(os.homedir(), '.codebuddy');
  return path.join(home, 'codebuddy-hud-runtime');
}

function checkNodeVersion() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    console.error(`\x1b[31m✖ Node.js version v${process.versions.node} is too old. codebuddy-hud requires Node.js >= 18.0.0.\x1b[0m`);
    process.exit(1);
  }
}

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error(`Too many redirects fetching ${url}`));
    }
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'codebuddy-hud-bootstrap' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        return resolve(fetchUrl(nextUrl, redirectCount + 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} when fetching ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
  });
}

function copyDirRecursiveSync(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function install() {
  checkNodeVersion();
  const targetDir = getTargetDir();
  const targetParent = path.dirname(targetDir);
  if (!fs.existsSync(targetParent)) {
    fs.mkdirSync(targetParent, { recursive: true });
  }

  const tmpDir = `${targetDir}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`\x1b[36m🚀 Installing codebuddy-hud to:\x1b[0m ${targetDir}`);

  // Check if we are running from a local checkout containing the runtime directory
  const localRepoRoot = path.resolve(__dirname, '..');
  const isLocalCheckout = fs.existsSync(path.join(localRepoRoot, 'runtime', 'bin', 'codebuddy-hud.js'));

  try {
    if (isLocalCheckout) {
      console.log('  Mode: Local repository copy');
      const filesToCopy = ['package.json', 'README.md'];
      for (const f of filesToCopy) {
        const src = path.join(localRepoRoot, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(tmpDir, f));
        }
      }
      copyDirRecursiveSync(path.join(localRepoRoot, 'runtime'), path.join(tmpDir, 'runtime'));
      const extraDirs = ['.codebuddy-plugin', 'skills'];
      for (const d of extraDirs) {
        const src = path.join(localRepoRoot, d);
        if (fs.existsSync(src)) {
          copyDirRecursiveSync(src, path.join(tmpDir, d));
        }
      }
    } else {
      console.log('  Mode: Remote download from GitHub');
      for (const relPath of RUNTIME_FILES) {
        const fileUrl = `${REPO_RAW_BASE}/${relPath}`;
        process.stdout.write(`  ↓ Fetching ${relPath}...`);
        const content = await fetchUrl(fileUrl);
        const destPath = path.join(tmpDir, relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, content);
        process.stdout.write(` \x1b[32mOK\x1b[0m\n`);
      }
    }

    // Verify key runtime files in tmpDir
    const mainBin = path.join(tmpDir, 'runtime', 'bin', 'codebuddy-hud.js');
    if (!fs.existsSync(mainBin)) {
      throw new Error(`Validation failed: ${mainBin} missing after download/copy`);
    }

    // Atomic replace target directory
    const oldBackupDir = `${targetDir}.old-${process.pid}-${Date.now()}`;
    if (fs.existsSync(targetDir)) {
      try {
        fs.renameSync(targetDir, oldBackupDir);
      } catch (err) {
        // Fallback on systems where renameSync might fail due to open locks
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    }

    try {
      fs.renameSync(tmpDir, targetDir);
    } catch (renameErr) {
      // If rename fails, copy recursively and remove tmp
      copyDirRecursiveSync(tmpDir, targetDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    if (fs.existsSync(oldBackupDir)) {
      try {
        fs.rmSync(oldBackupDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failure for old backup
      }
    }

    // Configure statusLine in settings.json
    const installerPath = path.join(targetDir, 'runtime', 'statusline-installer.js');
    const installer = require(installerPath);
    installer.setup({
      runtimeDir: path.join(targetDir, 'runtime'),
      hudBin: path.join(targetDir, 'runtime', 'bin', 'codebuddy-hud.js'),
    });

    console.log('\n\x1b[32m✔ codebuddy-hud successfully installed and configured!\x1b[0m');
    console.log('  Restart CodeBuddy or start a new session to see your new HUD.');
  } catch (err) {
    console.error(`\n\x1b[31m✖ Installation failed: ${err.message}\x1b[0m`);
    if (fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
    process.exit(1);
  }
}

if (require.main === module) {
  install();
}

module.exports = { install, getTargetDir, checkNodeVersion };
