import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  FOOTER_MODES,
  CLEAN_FOOTER_SEGMENTS,
  isFooterModeName,
  detectFooterMode,
  editTuiStatusLineProperty,
  saveFooterMode,
  getActiveFooterMode,
  restoreTuiStatusLineOnUninstall,
  renderFooterPreview,
  printFooterModesList,
  selectFooterInteractive,
} = require('../../runtime/footer-mode.js');
const { parseSettingsJson } = require('../../runtime/settings-file.js');

const FOOTER_MODULE_PATH = require.resolve('../../runtime/footer-mode.js');

let tmpDir;
let originalCodeBuddyHome;
let originalSettingsPath;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbhud-footer-test-'));
  originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  originalSettingsPath = process.env.CODEBUDDY_SETTINGS_PATH;
  process.env.CODEBUDDY_HOME = path.join(tmpDir, 'codebuddy-home');
  process.env.CODEBUDDY_SETTINGS_PATH = path.join(tmpDir, 'settings.json');
});

after(() => {
  if (originalCodeBuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
  if (originalSettingsPath === undefined) delete process.env.CODEBUDDY_SETTINGS_PATH;
  else process.env.CODEBUDDY_SETTINGS_PATH = originalSettingsPath;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('footer-mode constants and validation', () => {
  it('defines full, clean, and off modes and exact clean segments', () => {
    assert.deepEqual(Object.keys(FOOTER_MODES), ['full', 'clean', 'off']);
    assert.equal(FOOTER_MODES.full.segments, null);
    assert.deepEqual(CLEAN_FOOTER_SEGMENTS, [
      'agents',
      'shortcuts',
      'permission',
      'thinking',
      'shells',
      'context-remaining',
      'tokens',
    ]);
    assert.deepEqual(FOOTER_MODES.clean.segments, CLEAN_FOOTER_SEGMENTS);
    assert.deepEqual(FOOTER_MODES.off.segments, []);
  });

  it('isFooterModeName validates own mode keys and rejects prototype-chain names', () => {
    assert.equal(isFooterModeName('full'), true);
    assert.equal(isFooterModeName('clean'), true);
    assert.equal(isFooterModeName('off'), true);
    for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'custom', '', null, undefined, 123, {}]) {
      assert.equal(isFooterModeName(bad), false, `expected ${String(bad)} to be rejected`);
    }
  });

  it('detectFooterMode distinguishes full, clean, off, and custom', () => {
    assert.equal(detectFooterMode(null), 'full');
    assert.equal(detectFooterMode({}), 'full');
    assert.equal(detectFooterMode({ tui: {} }), 'full');
    assert.equal(detectFooterMode({ tui: { theme: 'dark' } }), 'full');
    assert.equal(detectFooterMode({ tui: { statusLine: [...CLEAN_FOOTER_SEGMENTS] } }), 'clean');
    assert.equal(detectFooterMode({ tui: { statusLine: [] } }), 'off');
    assert.equal(detectFooterMode({ tui: { statusLine: ['agents', 'tokens'] } }), 'custom');
    assert.equal(detectFooterMode({ tui: { statusLine: [...CLEAN_FOOTER_SEGMENTS].reverse() } }), 'custom');
    assert.equal(detectFooterMode({ tui: { statusLine: 'off' } }), 'custom');
    assert.equal(detectFooterMode({ tui: { statusLine: null } }), 'custom');
    assert.equal(detectFooterMode({ tui: 'invalid' }), 'custom');
    assert.equal(detectFooterMode({ tui: null }), 'custom');
  });
});

describe('editTuiStatusLineProperty', () => {
  it('returns rawSettings byte-unchanged for null segments when tui is absent', () => {
    for (const raw of [
      '',
      '{}',
      '{"model":"keep"}',
      '\ufeff{\r\n\t// comment\r\n\t"model": "keep",\r\n}\r\n',
    ]) {
      assert.equal(editTuiStatusLineProperty(raw, null), raw);
    }
  });

  it('inserts tui.statusLine cleanly matching BOM, CRLF, spaces, tabs, and inline styles', () => {
    const spaces2 = '{\n  "model": "keep"\n}\n';
    const out2 = editTuiStatusLineProperty(spaces2, []);
    assert.equal(out2, '{\n  "model": "keep",\n  "tui": {\n    "statusLine": []\n  }\n}\n');

    const spaces4 = '{\n    "model": "keep"\n}\n';
    const out4 = editTuiStatusLineProperty(spaces4, CLEAN_FOOTER_SEGMENTS);
    assert.equal(
      out4,
      `{\n    "model": "keep",\n    "tui": {\n        "statusLine": ${JSON.stringify(CLEAN_FOOTER_SEGMENTS)}\n    }\n}\n`,
    );

    const tabsCrlf = '\ufeff{\r\n\t// user note\r\n\t"model": "keep",\r\n}\r\n';
    const outTab = editTuiStatusLineProperty(tabsCrlf, []);
    assert.equal(
      outTab,
      '\ufeff{\r\n\t// user note\r\n\t"model": "keep",\r\n\t"tui": {\r\n\t\t"statusLine": []\r\n\t},\r\n}\r\n',
    );
    assert.ok(!/[^\r]\n/.test(outTab));

    const inline = '{"model":"keep"}';
    const outInline = editTuiStatusLineProperty(inline, []);
    assert.deepEqual(parseSettingsJson(outInline), { model: 'keep', tui: { statusLine: [] } });
    assert.ok(!outInline.includes('\n'));
  });

  it('surgically edits existing tui object while preserving comments and sibling keys', () => {
    const raw = '\ufeff{\r\n\t// root comment\r\n\t"tui": {\r\n\t\t// tui comment\r\n\t\t"theme": "dark",\r\n\t\t"statusLine": ["model", "tokens"], // keep note\r\n\t},\r\n}\r\n';
    const updated = editTuiStatusLineProperty(raw, CLEAN_FOOTER_SEGMENTS);
    assert.equal(updated, raw.replace('["model", "tokens"]', JSON.stringify(CLEAN_FOOTER_SEGMENTS)));
    assert.equal(editTuiStatusLineProperty(updated, CLEAN_FOOTER_SEGMENTS), updated, 'repeat edit must be byte-idempotent');

    const cleared = editTuiStatusLineProperty(updated, null);
    const parsedCleared = parseSettingsJson(cleared);
    assert.deepEqual(parsedCleared, { tui: { theme: 'dark' } });
    assert.ok(cleared.includes('// root comment'));
    assert.ok(cleared.includes('// tui comment'));
  });

  it('removes tui itself when removing statusLine leaves tui as empty {}, but preserves pre-existing empty tui', () => {
    const raw = '{\n  // keep\n  "model": "keep",\n  "tui": {\n    "statusLine": []\n  }\n}\n';
    const cleared = editTuiStatusLineProperty(raw, null);
    assert.deepEqual(parseSettingsJson(cleared), { model: 'keep' });
    assert.ok(cleared.includes('// keep'));
    assert.ok(!cleared.includes('"tui"'));

    const preExistingEmptyTui = '{\n  "model": "keep",\n  "tui": {}\n}\n';
    assert.equal(editTuiStatusLineProperty(preExistingEmptyTui, null), preExistingEmptyTui);
  });

  it('refuses invalid JSON, non-object root, and non-object tui', () => {
    for (const bad of ['[]', 'null', '123', '{ invalid', '{"tui":"str"}', '{"tui":[]}', '{"tui":null}', '{"tui":42}']) {
      assert.throws(() => editTuiStatusLineProperty(bad, []));
      assert.throws(() => editTuiStatusLineProperty(bad, null));
    }
  });
});

describe('saveFooterMode', () => {
  it('handles missing settings.json as no-op for full and creates file for clean/off', () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'save-missing-'));
    const settingsPath = path.join(dir, 'settings.json');
    assert.equal(saveFooterMode('full', { settingsPath }), settingsPath);
    assert.equal(fs.existsSync(settingsPath), false, 'full mode must not create missing settings.json');

    saveFooterMode('clean', { settingsPath });
    assert.equal(fs.existsSync(settingsPath), true);
    assert.deepEqual(parseSettingsJson(fs.readFileSync(settingsPath, 'utf8')), {
      tui: { statusLine: [...CLEAN_FOOTER_SEGMENTS] },
    });

    saveFooterMode('off', { settingsPath });
    assert.deepEqual(parseSettingsJson(fs.readFileSync(settingsPath, 'utf8')), {
      tui: { statusLine: [] },
    });

    saveFooterMode('full', { settingsPath });
    assert.deepEqual(parseSettingsJson(fs.readFileSync(settingsPath, 'utf8')), {});
  });

  it('aborts without overwriting invalid JSON, non-object root, non-object tui, or invalid mode', () => {
    const settingsPath = path.join(tmpDir, 'save-invalid.json');
    for (const raw of ['{"tui": 123}', '{"tui": []}', '{"tui": null}', '{ broken json', '[]', 'null']) {
      fs.writeFileSync(settingsPath, raw);
      assert.throws(() => saveFooterMode('clean', { settingsPath }));
      assert.equal(fs.readFileSync(settingsPath, 'utf8'), raw);
    }
    fs.writeFileSync(settingsPath, '{"model":"keep"}');
    for (const badMode of ['bogus', '__proto__', 'constructor', 'toString']) {
      assert.throws(() => saveFooterMode(badMode, { settingsPath }), /Invalid footer mode/);
    }
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{"model":"keep"}');
  });

  it('refuses writes through multiple hard links', () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'hardlink-'));
    const settingsPath = path.join(dir, 'settings.json');
    const linkPath = path.join(dir, 'link.json');
    fs.writeFileSync(settingsPath, '{"model":"keep"}');
    fs.linkSync(settingsPath, linkPath);
    assert.throws(() => saveFooterMode('clean', { settingsPath }), /multiple hard links/);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{"model":"keep"}');
  });

  it('preserves symlinks and POSIX permissions', { skip: process.platform === 'win32' }, () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'symlink-'));
    const target = path.join(dir, 'target.json');
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(target, '{"model":"keep"}', { mode: 0o640 });
    fs.chmodSync(target, 0o640);
    fs.symlinkSync(target, settingsPath);
    saveFooterMode('off', { settingsPath });
    assert.equal(fs.lstatSync(settingsPath).isSymbolicLink(), true);
    assert.equal(fs.statSync(target).mode & 0o777, 0o640);
    assert.deepEqual(parseSettingsJson(fs.readFileSync(target, 'utf8')), {
      model: 'keep',
      tui: { statusLine: [] },
    });
  });

  it('getActiveFooterMode reads current settings mode safely', () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'active-mode-'));
    const settingsPath = path.join(dir, 'settings.json');
    assert.equal(getActiveFooterMode({ settingsPath }), 'full');
    saveFooterMode('clean', { settingsPath });
    assert.equal(getActiveFooterMode({ settingsPath }), 'clean');
    saveFooterMode('off', { settingsPath });
    assert.equal(getActiveFooterMode({ settingsPath }), 'off');
    fs.writeFileSync(settingsPath, '{"tui":{"statusLine":["agents"]}}');
    assert.equal(getActiveFooterMode({ settingsPath }), 'custom');
    fs.writeFileSync(settingsPath, '{ broken');
    assert.equal(getActiveFooterMode({ settingsPath }), 'full');
  });
});

describe('restoreTuiStatusLineOnUninstall', () => {
  it('leaves tui untouched when current mode is custom or full', () => {
    const customRaw = '{"tui":{"statusLine":["model"]}}';
    assert.equal(restoreTuiStatusLineOnUninstall(customRaw, parseSettingsJson(customRaw), '{"model":"x"}', { model: 'x' }), customRaw);
    assert.equal(restoreTuiStatusLineOnUninstall(customRaw, parseSettingsJson(customRaw), null, null), customRaw);

    const fullRaw = '{"tui":{"theme":"dark"}}';
    assert.equal(restoreTuiStatusLineOnUninstall(fullRaw, parseSettingsJson(fullRaw), null, null), fullRaw);
  });

  it('leaves tui untouched when backup already had the same clean or off mode', () => {
    const offRaw = '{"tui":{"statusLine":[]}}';
    assert.equal(restoreTuiStatusLineOnUninstall(offRaw, parseSettingsJson(offRaw), offRaw, parseSettingsJson(offRaw)), offRaw);

    const cleanRaw = JSON.stringify({ tui: { statusLine: [...CLEAN_FOOTER_SEGMENTS] } });
    assert.equal(restoreTuiStatusLineOnUninstall(cleanRaw, parseSettingsJson(cleanRaw), cleanRaw, parseSettingsJson(cleanRaw)), cleanRaw);
  });

  it('restores backup tui.statusLine while preserving post-install sibling keys inside tui', () => {
    const backupRaw = '{\n  "tui": {\n    "statusLine": ["model", "tokens"]\n  }\n}';
    const currentRaw = `{\n  "tui": {\n    "theme": "dark",\n    "statusLine": ${JSON.stringify(CLEAN_FOOTER_SEGMENTS)}\n  }\n}`;
    const restored = restoreTuiStatusLineOnUninstall(currentRaw, parseSettingsJson(currentRaw), backupRaw, parseSettingsJson(backupRaw));
    assert.deepEqual(parseSettingsJson(restored), {
      tui: {
        theme: 'dark',
        statusLine: ['model', 'tokens'],
      },
    });
  });

  it('removes statusLine and removes tui only if empty and backup had no tui', () => {
    const backupNoTui = '{"model":"keep"}';
    const currentOnlyStatusLine = '{"model":"keep","tui":{"statusLine":[]}}';
    const restored1 = restoreTuiStatusLineOnUninstall(currentOnlyStatusLine, parseSettingsJson(currentOnlyStatusLine), backupNoTui, parseSettingsJson(backupNoTui));
    assert.deepEqual(parseSettingsJson(restored1), { model: 'keep' });

    const currentWithSibling = '{"model":"keep","tui":{"theme":"dark","statusLine":[]}}';
    const restored2 = restoreTuiStatusLineOnUninstall(currentWithSibling, parseSettingsJson(currentWithSibling), backupNoTui, parseSettingsJson(backupNoTui));
    assert.deepEqual(parseSettingsJson(restored2), { model: 'keep', tui: { theme: 'dark' } });

    const backupEmptyTui = '{"model":"keep","tui":{}}';
    const restored3 = restoreTuiStatusLineOnUninstall(currentOnlyStatusLine, parseSettingsJson(currentOnlyStatusLine), backupEmptyTui, parseSettingsJson(backupEmptyTui));
    assert.deepEqual(parseSettingsJson(restored3), { model: 'keep', tui: {} });
  });

  it('removes HUD-managed tui.statusLine when no backup exists', () => {
    const current = '{"model":"keep","tui":{"statusLine":[]}}';
    assert.deepEqual(parseSettingsJson(restoreTuiStatusLineOnUninstall(current, parseSettingsJson(current), null, null)), { model: 'keep' });

    const withSibling = '{"model":"keep","tui":{"theme":"dark","statusLine":[]}}';
    assert.deepEqual(parseSettingsJson(restoreTuiStatusLineOnUninstall(withSibling, parseSettingsJson(withSibling), null, null)), { model: 'keep', tui: { theme: 'dark' } });
  });
});

describe('preview, list, and interactive selector', () => {
  it('renderFooterPreview returns 4 ANSI lines for each mode', () => {
    for (const mode of ['full', 'clean', 'off']) {
      const lines = renderFooterPreview(mode, { language: 'en', theme: 'ocean', themeMode: 'dark' });
      assert.equal(lines.length, 4);
      assert.ok(lines[0].includes('Deepseek-V4.1-Flash'));
      assert.ok(lines[1].includes('Context Token'));
      assert.ok(lines[2].includes('credits'));
      if (mode === 'full') {
        assert.ok(lines[3].includes('Deepseek-V4.1-Flash'));
        assert.ok(lines[3].includes('shortcuts'));
      } else if (mode === 'clean') {
        assert.ok(!lines[3].includes('Deepseek-V4.1-Flash'));
        assert.ok(lines[3].includes('shortcuts'));
      } else {
        assert.ok(lines[3].includes('hidden'));
      }
    }
    const zhOff = renderFooterPreview('off', { language: 'zh' });
    assert.ok(zhOff[3].includes('已隐藏'));
    assert.equal(renderFooterPreview('clean', { theme: { primary: 'cyan', name: 'toString', mode: 'dark' } }).length, 4);
  });

  it('printFooterModesList localizes output and notes custom state', () => {
    const settingsPath = path.join(tmpDir, 'list-settings.json');
    fs.writeFileSync(settingsPath, '{"tui":{"statusLine":["agents"]}}');
    const lines = [];
    const originalLog = console.log;
    console.log = (line) => lines.push(String(line));
    try {
      printFooterModesList({ language: 'zh' }, { settingsPath });
      printFooterModesList({ language: 'en' }, { settingsPath });
    } finally {
      console.log = originalLog;
    }
    assert.ok(lines.some(l => l.includes('可用底栏模式')));
    assert.ok(lines.some(l => l.includes('Available footer modes')));
    assert.ok(lines.some(l => l.includes('custom')));
  });

  it('selectFooterInteractive resolves initial mode immediately when not a TTY', async () => {
    const selected = await selectFooterInteractive({ initialMode: 'clean' });
    assert.equal(selected, 'clean');
  });

  it('selectFooterInteractive supports TTY navigation, numeric keys, Enter, and Esc cancellation', async () => {
    function runTtyScript(keypresses, extra = {}) {
      const script = `
        Object.defineProperty(process.stdin, 'isTTY', { value: true });
        Object.defineProperty(process.stdout, 'isTTY', { value: true });
        process.stdin.setRawMode = () => {};
        let paused = false;
        const origPause = process.stdin.pause.bind(process.stdin);
        process.stdin.pause = () => { paused = true; return origPause(); };
        const { selectFooterInteractive } = require(${JSON.stringify(FOOTER_MODULE_PATH)});
        (async () => {
          const p = selectFooterInteractive(${JSON.stringify(extra)});
          const events = ${JSON.stringify(keypresses)};
          for (const [str, key] of events) {
            process.stdin.emit('keypress', str, key);
          }
          const result = await p;
          process.stdout.write('\\n__RESULT__=' + JSON.stringify({ result, paused }));
        })();
      `;
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', script], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
          env: { ...process.env, CODEBUDDY_HOME: process.env.CODEBUDDY_HOME, CODEBUDDY_SETTINGS_PATH: process.env.CODEBUDDY_SETTINGS_PATH },
        });
        let out = '';
        let err = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { err += d; });
        child.once('error', reject);
        child.once('close', code => resolve({ code, out, err }));
      });
    }

    // Start on full -> 'j' moves to clean -> Enter confirms 'clean'
    const res1 = await runTtyScript([
      ['j', { name: 'j' }],
      ['\r', { name: 'return' }],
    ], { initialMode: 'full' });
    assert.equal(res1.code, 0, res1.err);
    assert.match(res1.out, /__RESULT__=\{"result":"clean","paused":true\}/);
    assert.ok(res1.out.includes('\x1b[?25h'), 'cursor must be restored on exit');

    // Numeric key '3' selects 'off' -> Enter confirms 'off'
    const res2 = await runTtyScript([
      ['3', { name: '3' }],
      ['\r', { name: 'return' }],
    ], { initialMode: 'full', config: { language: 'zh' } });
    assert.equal(res2.code, 0, res2.err);
    assert.match(res2.out, /__RESULT__=\{"result":"off","paused":true\}/);
    // Top border and bottom border should both align to 92 visual columns for CJK title.
    const plain = res2.out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    const topLine = plain.split('\n').find(l => l.startsWith('┌─'));
    const bottomLine = plain.split('\n').find(l => l.startsWith('└'));
    assert.ok(topLine && bottomLine);
    const visualWidth = s => [...s].reduce((acc, ch) => acc + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);
    assert.equal(visualWidth(topLine), visualWidth(bottomLine));

    // Esc cancels with null
    const res3 = await runTtyScript([
      ['', { name: 'escape' }],
    ], { initialMode: 'full' });
    assert.equal(res3.code, 0, res3.err);
    assert.match(res3.out, /__RESULT__=\{"result":null,"paused":true\}/);
    assert.ok(res3.out.includes('\x1b[?25h'), 'cursor must be restored on cancel');

    // up/k wrap from full -> off -> clean, and q/Ctrl+C cancel cleanly
    const resUp = await runTtyScript([
      ['', { name: 'up' }],
      ['k', { name: 'k' }],
      ['\r', { name: 'return' }],
    ], { initialMode: 'full' });
    assert.equal(resUp.code, 0, resUp.err);
    assert.match(resUp.out, /__RESULT__=\{"result":"clean","paused":true\}/);

    const resQ = await runTtyScript([
      ['q', { name: 'q' }],
    ], { initialMode: 'clean' });
    assert.equal(resQ.code, 0, resQ.err);
    assert.match(resQ.out, /__RESULT__=\{"result":null,"paused":true\}/);

    const resCtrlC = await runTtyScript([
      ['\x03', { ctrl: true, name: 'c' }],
    ], { initialMode: 'clean' });
    assert.equal(resCtrlC.code, 0, resCtrlC.err);
    assert.match(resCtrlC.out, /__RESULT__=\{"result":null,"paused":true\}/);

    // Raw-mode setup error must still invoke cleanup and resolve null
    const errScript = `
      Object.defineProperty(process.stdin, 'isTTY', { value: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true });
      let rawCalls = 0;
      process.stdin.setRawMode = (flag) => { rawCalls++; if (flag) throw new Error('EBADF'); };
      let paused = false;
      const origPause = process.stdin.pause.bind(process.stdin);
      process.stdin.pause = () => { paused = true; return origPause(); };
      const { selectFooterInteractive } = require(${JSON.stringify(FOOTER_MODULE_PATH)});
      (async () => {
        const result = await selectFooterInteractive({ initialMode: 'full' });
        process.stdout.write('__ERR_RESULT__=' + JSON.stringify({ result, paused, rawCalls }));
      })();
    `;
    const errRes = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', errScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
        env: { ...process.env, CODEBUDDY_HOME: process.env.CODEBUDDY_HOME, CODEBUDDY_SETTINGS_PATH: process.env.CODEBUDDY_SETTINGS_PATH },
      });
      let out = '', err = '';
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.once('error', reject);
      child.once('close', code => resolve({ code, out, err }));
    });
    assert.equal(errRes.code, 0, errRes.err);
    assert.match(errRes.out, /__ERR_RESULT__=\{"result":null,"paused":true,"rawCalls":2\}/);
    assert.ok(errRes.out.includes('\x1b[?25h'), 'cursor must be restored when setRawMode throws');
  });
});
