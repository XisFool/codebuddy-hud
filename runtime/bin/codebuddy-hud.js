#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { parseCodeBuddyInput } = require('../parser');
const { loadConfig } = require('../config');
const { renderHUD } = require('../renderer');
const { getErrorLogPath } = require('../paths');

// Leave headroom for Node startup and the final stdout flush. Waiting the full
// 1500ms for a host that never closes stdin would violate the end-to-end time
// budget before rendering even begins.
const TIMEOUT_MS = 800;
const LOG_MAX_BYTES = 1024 * 1024;


// A stdout pipe that the host closed early (killed statusLine, `head -c 1`, …)
// raises an async 'error' on process.stdout. Unhandled, it crashes the process
// with exit 1 and dumps a stack onto stderr — breaking the "always exit 0,
// never emit a broken state" contract. Swallowing it is the correct
// degradation: the write is lost, but the process still exits cleanly.
// Same guard for stderr (a closed stderr would crash a --setup/--uninstall
// console.error the same way).
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
process.on('uncaughtException', (err) => {
  logError(err);
  process.exitCode = 0;
});

function logError(err) {
  try {
    const logPath = getErrorLogPath();
    const ts = new Date().toISOString();
    const msg = `[${ts}] ${err && err.message ? err.message : String(err)}\n`;
    // Rotate: a repeating error at the host's ~300ms cadence would otherwise
    // grow the log without bound (~288k lines/day). Over the cap, restart the
    // log with just the current entry (recent errors matter most).
    try {
      if (fs.statSync(logPath).size > LOG_MAX_BYTES) {
        fs.writeFileSync(logPath, msg, { mode: 0o600 });
        return;
      }
    } catch {
      // missing file — fall through to append
    }
    fs.appendFileSync(logPath, msg, { mode: 0o600 });
  } catch {
    // silently fail — never block exit
  }
}

// Render, then exit with code 0 WITHOUT calling process.exit(): stdout is a
// pipe in statusLine mode, and pipe writes are asynchronous on POSIX, so an
// immediate process.exit() can truncate the dashboard the host reads. Letting
// the event loop drain flushes pending writes first. The 1500ms fallback timer
// is unref'd and stdin is destroyed before rendering, so nothing keeps the
// loop alive past the final write and the <1500ms contract still holds.
function handleRender(rawStdin) {
  try {
    const cbData = parseCodeBuddyInput(rawStdin);
    const cwd = cbData && (cbData.cwd || (cbData.workspace && cbData.workspace.current_dir)) || process.cwd();
    const config = loadConfig(cwd);
    const output = renderHUD(cbData, config);
    if (output) {
      process.stdout.write(output + '\n');
    }
  } catch (err) {
    logError(err);
  }
  process.exitCode = 0;
}

// CLI subcommands. The statusLine contract is "always exit 0, never emit a
// broken state", so setup/uninstall failures are logged instead of crashing
// with a non-zero exit (a bare throw here used to escape as exit code 1).
const args = process.argv.slice(2);
if (args.includes('--setup')) {
  (async () => {
    try {
      let selectedTheme = null;
      const themeIdx = args.indexOf('--theme');
      if (themeIdx !== -1 && args[themeIdx + 1] && !args[themeIdx + 1].startsWith('--')) {
        selectedTheme = args[themeIdx + 1];
      } else if (process.stdin.isTTY && process.stdout.isTTY) {
        const { selectThemeInteractive } = require('../theme-selector');
        selectedTheme = await selectThemeInteractive();
      }
      require('../statusline-installer').setup(selectedTheme ? { theme: selectedTheme } : undefined);
    } catch (err) {
      logError(err);
      console.error('setup failed (see codebuddy-hud-error.log)');
    }
    process.exitCode = 0;
  })();
} else if (args.includes('--theme')) {
  (async () => {
    try {
      const { THEME_PRESETS, isPresetName } = require('../config');
      const { saveUserTheme, printThemesList, selectThemeInteractive } = require('../theme-selector');
      const themeIdx = args.indexOf('--theme');
      const themeArg = (themeIdx !== -1 && args[themeIdx + 1] && !args[themeIdx + 1].startsWith('--')) ? args[themeIdx + 1] : null;

      if (themeArg === 'list' || themeArg === '--help' || themeArg === '-h') {
        printThemesList();
      } else if (themeArg) {
        if (isPresetName(themeArg)) {
          const savedPath = saveUserTheme(themeArg);
          console.log(`\x1b[32m✔\x1b[0m HUD theme set to '\x1b[1m${themeArg}\x1b[0m' (saved to ${savedPath})`);
        } else {
          console.error(`Unknown theme: "${themeArg}". Available themes: ${Object.keys(THEME_PRESETS).join(', ')}`);
        }
      } else if (process.stdin.isTTY && process.stdout.isTTY) {
        const selected = await selectThemeInteractive();
        if (selected) {
          const savedPath = saveUserTheme(selected);
          console.log(`\x1b[32m✔\x1b[0m HUD theme set to '\x1b[1m${selected}\x1b[0m' (saved to ${savedPath})\n`);
        }
      } else {
        printThemesList();
      }
    } catch (err) {
      logError(err);
      console.error('theme configuration failed (see codebuddy-hud-error.log)');
    }
    process.exitCode = 0;
  })();
} else if (args.includes('--uninstall')) {
  try {
    require('../uninstall').uninstall();
  } catch (err) {
    logError(err);
    console.error('uninstall failed (see codebuddy-hud-error.log)');
  }
  process.exitCode = 0;
} else if (args.includes('--doctor') || args.includes('-d')) {
  try {
    const isJson = args.includes('--json');
    const { runDoctor, printDoctorReport } = require('../doctor');
    const report = runDoctor({ cwd: process.cwd(), json: isJson });
    printDoctorReport(report, isJson);
  } catch (err) {
    logError(err);
    console.error('doctor check failed (see codebuddy-hud-error.log)');
  }
  process.exitCode = 0;
} else if (args.includes('--status')) {
  let statusCwd = '';
  try { statusCwd = process.cwd(); } catch { statusCwd = ''; }
  const samplePayload = JSON.stringify({
    model: { id: 'deepseek-v4-flash', display_name: 'DeepSeek V4 Flash' },
    reasoning_effort: 'max',
    permission_mode: 'default',
    cwd: statusCwd,
    version: '0.1.0',
    cost: { credits: 82.04, total_cost_usd: 0, total_duration_ms: 10020000, total_api_duration_ms: 4980000, total_lines_added: 1700, total_lines_removed: 161 },
    context_window: { total_input_tokens: 249000, total_output_tokens: 1100, context_window_size: 1000000, used_percentage: 25, current_usage: { input_tokens: 249000, output_tokens: 1100, cache_read_input_tokens: 241032, cache_creation_input_tokens: 0 } },
  });
  handleRender(samplePayload);
} else {
  try {
    if (process.env.CODEBUDDY_HUD_NO_UPDATE_CHECK !== '1') {
      const { spawnBackgroundUpdateCheck } = require('../update-checker');
      spawnBackgroundUpdateCheck();
    }
  } catch {}
  // Normal statusLine mode: read stdin
  const MAX_STDIN_SIZE = 1024 * 1024;
  let stdinChunks = [];
  let totalStdinSize = 0;
  let handled = false;

  const timer = setTimeout(() => {
    if (!handled) {
      handled = true;
      // stdin may never close (host keeps the pipe open) — it is the only
      // handle keeping the loop alive, so release it before rendering
      process.stdin.destroy();
      handleRender(Buffer.concat(stdinChunks).toString('utf8'));
    }
  }, TIMEOUT_MS);
  timer.unref();

  process.stdin.on('data', (chunk) => {
    if (handled) return;
    totalStdinSize += chunk.length;
    if (totalStdinSize > MAX_STDIN_SIZE) {
      handled = true;
      clearTimeout(timer);
      handleRender('');
      process.stdin.destroy();
      return;
    }
    stdinChunks.push(chunk);
  });

  process.stdin.on('end', () => {
    if (!handled) {
      handled = true;
      clearTimeout(timer);
      handleRender(Buffer.concat(stdinChunks).toString('utf8'));
    }
  });

  process.stdin.on('error', () => {
    if (!handled) {
      handled = true;
      clearTimeout(timer);
      handleRender('');
    }
    // Same release as the timeout/oversize paths: a broken stream must not be
    // the handle that keeps the loop alive.
    process.stdin.destroy();
  });

  process.stdin.resume();
}
