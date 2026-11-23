// Every language must have exactly the English keys, and every entry must render.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const load = (lang) => vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../src/i18n.js'), 'utf8')}\nI18n`,
  { document: { documentElement: {} }, localStorage: { getItem: () => lang } });

test('all languages have the same keys as English', () => {
  const { dict } = load('en');
  for (const [lang, d] of Object.entries(dict)) {
    assert.deepStrictEqual(Object.keys(d).sort(), Object.keys(dict.en).sort(), `${lang} keys differ`);
  }
});

test('every entry renders without leftover placeholders', () => {
  for (const lang of ['en', 'fr']) {
    const I = load(lang);
    assert.strictEqual(I.lang, lang);
    for (const key of Object.keys(I.dict.en)) {
      const out = I.t(key, { n: 2, ok: 2, ko: 1, i: 1, left: '0:10', name: 'a.mp4', time: '1 s', t: '0:05', title: 'x', bits: 16, cmd: 'winget', v: '1.2.3' });
      assert.ok(out && !/\{\w+\}/.test(out) && !out.includes('undefined'), `${lang} ${key}: ${out}`);
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
