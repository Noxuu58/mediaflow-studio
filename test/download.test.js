// Network tests against a short public video (the one yt-dlp's own test suite uses). Skipped without yt-dlp.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze, download, cancel, version, SAFE, OUTPUT } = require('../src/download');

const URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const LONG = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'; // Big Buck Bunny (CC-BY), only used to test cancel
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));

test('yt-dlp never reads a config file, and file names carry the video id', () => {
  assert.ok(SAFE.includes('--ignore-config'));
  assert.match(OUTPUT, /\[%\(id\)s\]\.%\(ext\)s$/);
});

test('yt-dlp downloads', async (t) => {
  if (!(await version())) return t.skip('yt-dlp absent');

  await t.test('analyze reads title, duration, heights', async () => {
    const info = await analyze(URL);
    assert.strictEqual(info.title, 'Me at the zoo');
    assert.ok(info.duration > 15 && info.hasVideo && info.heights.includes(240), JSON.stringify(info));
  });

  await t.test('analyze rejects garbage with a readable message', async () => {
    await assert.rejects(analyze('https://example.invalid/nothing'), (e) => e.message.length > 5 && !/^ERROR/.test(e.message));
  });

  for (const [fmt, quality] of [['mp4', '240'], ['mp3', 'best'], ['wav', 'best']]) {
    await t.test(`download ${fmt} ${quality}`, async () => {
      const seen = [];
      const file = await download(fmt, URL, { fmt, quality, outDir: out }, (p) => seen.push(p));
      assert.ok(file.endsWith(`.${fmt}`) && fs.statSync(file).size > 10000, file);
      assert.ok(seen.some((p) => p.stage === 'download' && p.p > 0.5), 'progress reported');
      assert.ok(seen.every((p) => p.p >= 0 && p.p <= 1));
    });
  }

  await t.test('download only a part of the video (2 s → 6 s)', async () => {
    const { probe } = require('../src/convert');
    const file = await download('part', URL, { fmt: 'mp4', quality: '240', outDir: out, section: { start: 2, end: 6 } });
    assert.match(path.basename(file), /\[jNQXAC9IVRw\] 0m02\.0s-0m06\.0s\.mp4$/);
    const d = (await probe(file, { thumb: false })).duration;
    assert.ok(Math.abs(d - 4) < 1.2, `duration ${d}`);
  });

  await t.test('cancel kills the job and cleans the temp folder', async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('mediaflow-') && !n.startsWith('mediaflow-ai-')) /* AI tests run in parallel */.length;
    const job = download('long', LONG, { fmt: 'mp4', quality: '1080', outDir: out });
    await new Promise((r) => setTimeout(r, 6000));
    cancel('long');
    await assert.rejects(job, /CANCELLED/);
    assert.strictEqual(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('mediaflow-') && !n.startsWith('mediaflow-ai-')) /* AI tests run in parallel */.length, before);
    assert.ok(!fs.readdirSync(out).some((n) => /Bunny/i.test(n)), 'no partial file in the output folder');
  });
});
