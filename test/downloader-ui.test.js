// Downloader screen (src/tools/downloader.js): when "Analyze" (or a paste) starts over, and when it does not.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The screen script needs only a few globals to load; its decision logic is pure.
const ctx = { App: { fmt: {}, icons: {}, store: { get: () => null }, register() {} }, I18n: { t: (k) => k }, Tools: {}, window: { api: { dl: { onProgress() {} } } } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'tools', 'downloader.js'), 'utf8'), ctx);
const { nextStep } = ctx.Tools.download;
const A = 'https://www.youtube.com/watch?v=a', B = 'https://www.youtube.com/watch?v=b';

test('Analyze: a new link runs, the same link never starts over', () => {
  assert.strictEqual(nextStep(null, A), 'run', 'nothing analysed yet');
  assert.strictEqual(nextStep({ url: A, state: 'loading' }, A), 'busy', 'clicking again while it reads the link');
  assert.strictEqual(nextStep({ url: A, state: 'ready' }, A), 'done', 'clicking again once it is shown');
  assert.strictEqual(nextStep({ url: A, state: 'loading' }, B), 'run', 'a different link replaces the one being read');
  assert.strictEqual(nextStep({ url: A, state: 'ready' }, B), 'run', 'a different link replaces the one shown');
  assert.strictEqual(nextStep({ url: A, state: 'error' }, A), 'run', 'a failed link can be retried');
});
