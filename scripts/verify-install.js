#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SOURCE_RUNTIME = path.join(__dirname, '..', 'runtime');
const isWin = process.platform === 'win32';

function runProcess(exe, args = [], options = {}, stdinData = null) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(exe, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.stdin.on('error', () => {});

    child.on('close', (code) => {
      resolve({ code, stdout, stderr, elapsed: Date.now() - started });
    });

    if (stdinData !== null) {
      child.stdin.write(stdinData);
    }
    child.stdin.end();
  });
}

function runShellCommand(commandStr, stdinData = null, env = process.env) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(commandStr, {
      shell: isWin ? (process.env.ComSpec || 'cmd.exe') : true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.stdin.on('error', () => {});

    child.on('close', (code) => {
      resolve({ code, stdout, stderr, elapsed: Date.now() - started });
    });

    if (stdinData !== null) {
      child.stdin.write(stdinData);
    }
    child.stdin.end();
  });
}

async function main() {
  console.log('=== codebuddy-cli-hud Isolated Installation Verification ===\n');

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-verify-install-'));
  const runtimeDir = path.join(tmpHome, 'runtime');
  const HUD_BIN = path.join(runtimeDir, 'bin', 'codebuddy-hud.js');
  const cmdShim = HUD_BIN.replace(/\.js$/, '.cmd');
  const settingsPath = path.join(tmpHome, 'settings.json');
  const isolatedEnv = {
    ...process.env,
    CODEBUDDY_HOME: tmpHome,
    CODEBUDDY_HUD_FORCE_ASCII: '1',
    CODEBUDDY_HUD_NO_UPDATE_CHECK: '1',
  };
  delete isolatedEnv.CODEBUDDY_SETTINGS_PATH;

  let passed = 0;
  let failed = 0;

  function record(label, ok, errDetail) {
    if (ok) {
      console.log(`  PASS  ${label}`);
      passed++;
    } else {
      console.log(`  FAIL  ${label}: ${errDetail}`);
      failed++;
    }
  }

  try {
    // CODEBUDDY_HOME isolates state; a runtime copy also isolates shim removal.
    fs.cpSync(SOURCE_RUNTIME, runtimeDir, {
      recursive: true,
      filter: (source) => source !== path.join(SOURCE_RUNTIME, 'bin', 'codebuddy-hud.cmd'),
    });
    // 0. Seed user settings to verify preservation
    fs.writeFileSync(settingsPath, JSON.stringify({ userCustomSetting: 'preserved' }, null, 2));

    // 1. Run --setup in isolated environment
    const setupRes = await runProcess(process.execPath, [HUD_BIN, '--setup'], { env: isolatedEnv });
    record('setup-exit-0', setupRes.code === 0, `code ${setupRes.code} (stderr: ${setupRes.stderr})`);

    // 2. Verify settings.json configuration
    let settings = null;
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      settings = null;
    }
    const settingsValid = settings
      && settings.userCustomSetting === 'preserved'
      && settings.statusLine
      && settings.statusLine.type === 'command'
      && typeof settings.statusLine.command === 'string'
      && settings.statusLine.command.length > 0;
    record('settings-written-and-preserved', !!settingsValid, 'statusLine missing or settings not preserved');

    // 3. Platform artifact validation
    if (isWin) {
      const shimCreated = fs.existsSync(cmdShim);
      const shimContent = shimCreated ? fs.readFileSync(cmdShim, 'utf8') : '';
      const shimValid = shimCreated && shimContent.includes('codebuddy-hud.js');
      record('win-cmd-shim-created', shimValid, 'shim file not created or does not reference codebuddy-hud.js');
    } else {
      let isExecutable = false;
      try {
        const stat = fs.statSync(HUD_BIN);
        isExecutable = (stat.mode & 0o111) !== 0;
      } catch {}
      record('posix-script-executable', isExecutable, 'hud bin chmod 0755 failed');
    }

    // 4. Directly execute the configured statusLine command with a sample payload
    if (settings && settings.statusLine && settings.statusLine.command) {
      const samplePayload = JSON.stringify({
        model: { id: 'deepseek-v4-flash', display_name: 'DeepSeek V4 Flash' },
        reasoning_effort: 'medium',
        permission_mode: 'default',
        cwd: process.cwd(),
        version: '0.1.0',
        context_window: {
          total_input_tokens: 1500,
          total_output_tokens: 200,
          context_window_size: 128000,
          used_percentage: 1,
          current_usage: { input_tokens: 1500, output_tokens: 200 },
        },
      });

      const execRes = await runShellCommand(settings.statusLine.command, samplePayload, isolatedEnv);
      const cleanOut = execRes.stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
      const lines = cleanOut ? cleanOut.split('\n') : [];
      const execOk = execRes.code === 0 && lines.length > 0 && lines.length <= 4 && !/\n\s*at \S+ \(/.test(execRes.stderr);
      record('configured-command-direct-execution', execOk, `code ${execRes.code}, ${lines.length} lines, stderr: ${execRes.stderr.slice(0, 100)}`);

      // On POSIX, also verify direct execution of the hudBin script
      if (!isWin) {
        const directRes = await runProcess(HUD_BIN, [], { env: isolatedEnv }, samplePayload);
        const directClean = directRes.stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
        const directOk = directRes.code === 0 && directClean.split('\n').length <= 4 && !/\n\s*at \S+ \(/.test(directRes.stderr);
        record('posix-direct-script-invocation', directOk, `code ${directRes.code}, stderr: ${directRes.stderr.slice(0, 100)}`);
      }
    }

    // 5. Seed state files and run --uninstall to verify full cleanup
    fs.writeFileSync(path.join(tmpHome, 'codebuddy-hud-update-status.json'), '{}');
    const uninstRes = await runProcess(process.execPath, [HUD_BIN, '--uninstall'], { env: isolatedEnv });
    record('uninstall-exit-0', uninstRes.code === 0, `code ${uninstRes.code} (stderr: ${uninstRes.stderr})`);

    // 6. Verify settings.json restored and statusLine deleted
    let afterSettings = null;
    try {
      afterSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {}
    const uninstallSettingsOk = afterSettings
      && afterSettings.statusLine === undefined
      && afterSettings.userCustomSetting === 'preserved';
    record('settings-restored-cleanly', !!uninstallSettingsOk, 'statusLine not removed or original setting lost');

    // 7. Verify Windows .cmd shim deleted on win32
    if (isWin) {
      const shimDeleted = !fs.existsSync(cmdShim);
      record('win-cmd-shim-removed', shimDeleted, 'cmd shim was not deleted by uninstall');
    }

    // 8. Verify state and cache files in isolated CODEBUDDY_HOME cleaned up
    const potentialStateFiles = [
      'codebuddy-hud-usage-state',
      'codebuddy-hud-session-state',
      'codebuddy-hud-cache-state.json',
      'codebuddy-hud-git-cache.json',
      'codebuddy-hud-credit-state.json',
      'codebuddy-hud-update-status.json',
      'codebuddy-hud.config.json',
    ];
    let remainingStateFiles = [];
    for (const f of potentialStateFiles) {
      if (fs.existsSync(path.join(tmpHome, f))) {
        remainingStateFiles.push(f);
      }
    }
    record('isolated-state-files-cleaned', remainingStateFiles.length === 0, `lingering files: ${remainingStateFiles.join(', ')}`);

  } finally {
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {}
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
