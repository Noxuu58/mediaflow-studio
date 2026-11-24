// Every language must have exactly the English keys, and every entry must render.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Same load order as index.html: every locale file, then the core.
const LOCALES = path.join(__dirname, '../src/locales');
const files = [...fs.readdirSync(LOCALES).map((f) => path.join(LOCALES, f)), path.join(__dirname, '../src/i18n.js')];
const source = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const load = (lang) => vm.runInNewContext(`${source}\nI18n`, { document: { documentElement: {} }, localStorage: { getItem: () => lang } });

test('all languages have the same keys as English', () => {
  const { dict } = load('en');
  for (const [lang, d] of Object.entries(dict)) {
    assert.deepStrictEqual(Object.keys(d).sort(), Object.keys(dict.en).sort(), `${lang} keys differ`);
  }
});

test('every entry renders without leftover placeholders', () => {
  for (const lang of Object.keys(load('en').LANGS)) {
    const I = load(lang);
    assert.strictEqual(I.lang, lang);
    for (const key of Object.keys(I.dict.en)) {
      for (const n of [1, 2]) {
        const out = I.t(key, { n, ok: n, ko: n - 1, i: 1, left: '0:10', name: 'a.mp4', time: '1 s', t: '0:05', title: 'x', bits: 16, cmd: 'winget', v: '1.2.3' });
        assert.ok(out && !/\{\w+\}/.test(out) && !out.includes('undefined'), `${lang} ${key}: ${out}`);
      }
    }
  }
});

test('backend error codes are translated, other messages pass through', () => {
  const I = load('fr');
  assert.strictEqual(I.error(new Error("Error invoking remote method 'convert': Error: CANCELLED")), 'Annulé');
  assert.match(I.error('PLAYLIST:12'), /12 éléments/);
  assert.strictEqual(I.error('HTTP Error 403: Forbidden'), 'HTTP Error 403: Forbidden');
  assert.strictEqual(load('xx').lang, 'en'); // unknown stored language falls back to English
});

test('every language file is listed in I18n and loaded by index.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const { LANGS } = load('en');
  for (const f of fs.readdirSync(LOCALES)) {
    assert.ok(LANGS[path.basename(f, '.js')], `${f} is missing from the ORDER list in i18n.js`);
    assert.ok(html.includes(`<script src="locales/${f}"></script>`), `${f} is not loaded by index.html`);
  }
});

test('Chinese uses the zh-CN page language (Simplified glyphs)', () => {
  const ctx = { document: { documentElement: {} }, localStorage: { getItem: () => 'zh' } };
  vm.runInNewContext(`${source}\nI18n`, ctx);
  assert.strictEqual(ctx.document.documentElement.lang, 'zh-CN');
});
