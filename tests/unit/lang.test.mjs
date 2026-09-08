import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DICTIONARY, detectLanguage, getI18n } = require('../../runtime/lang.js');

describe('i18n lang module', () => {
  test('defines both zh and en dictionaries', () => {
    assert.ok(DICTIONARY.zh);
    assert.ok(DICTIONARY.en);
    assert.ok(DICTIONARY.zh.themeSelectTitle);
    assert.ok(DICTIONARY.en.themeSelectTitle);
  });

  test('runtime/lang.js exports expected helpers and dictionary', () => {
    const rootLang = require('../../runtime/lang.js');
    assert.equal(typeof rootLang.getI18n, 'function');
    assert.equal(typeof rootLang.detectLanguage, 'function');
    assert.ok(rootLang.DICTIONARY);
  });

  test('detectLanguage respects explicit configuration', () => {
    assert.equal(detectLanguage({ language: 'zh' }), 'zh');
    assert.equal(detectLanguage({ language: 'en' }), 'en');
  });

  test('detectLanguage detects zh from environment variables', () => {
    const savedEnv = {
      LC_ALL: process.env.LC_ALL,
      LC_MESSAGES: process.env.LC_MESSAGES,
      LANG: process.env.LANG,
      LANGUAGE: process.env.LANGUAGE,
    };
    try {
      delete process.env.LC_ALL;
      delete process.env.LC_MESSAGES;
      delete process.env.LANGUAGE;
      process.env.LANG = 'zh_CN.UTF-8';
      assert.equal(detectLanguage({ language: 'auto' }), 'zh');
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test('getI18n returns helper with t() translation method', () => {
    const i18n = getI18n({ language: 'zh' });
    assert.equal(i18n.lang, 'zh');
    assert.equal(typeof i18n.t, 'function');
    assert.equal(i18n.t('themeSelectTitle'), DICTIONARY.zh.themeSelectTitle);
    assert.equal(i18n.t('non_existent_key', 'fallback_text'), 'fallback_text');
  });
});
