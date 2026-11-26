// Personal presets (src/presets.js) and the offline parts of the downloader: playlists and "only a part".
const test = require('node:test');
const assert = require('node:assert');
const presets = require('../src/presets');
const { toInfo, sectionArgs, OUTPUT } = require('../src/download');

test('presets: a saved pack reads back exactly', () => {
  const list = [{ name: 'Résolve proxy', options: { codec: 'dnxhr_lb', container: 'mov', height: '1080' } }, { name: 'Web', options: { audio: 'aac192' } }];
  const text = presets.serialize(list);
  assert.match(text, /"type": "presets"/);
  assert.deepStrictEqual(presets.parse(text), list);
  assert.deepStrictEqual(presets.parse(JSON.stringify(list[0])), [list[0]], 'a single preset file is accepted');
});

test('presets: unknown or unsafe values are refused', () => {
  for (const bad of ['not json', '{}', '{"presets":[]}', JSON.stringify({ name: 'x', options: { codec: 'rm -rf' } }),
    JSON.stringify({ name: 'x', options: { evil: '1' } }), JSON.stringify({ name: '', options: {} }), JSON.stringify({ name: 'x', options: [] }),
    JSON.stringify({ presets: Array.from({ length: 101 }, (_, i) => ({ name: `p${i}`, options: {} })) })]) {
    assert.throws(() => presets.parse(bad), /PRESET_INVALID/, bad.slice(0, 60));
  }
  assert.strictEqual(presets.parse(JSON.stringify({ name: `  ${'n'.repeat(80)} `, options: {} }))[0].name.length, 60);
});

test('downloader: a playlist lists its videos, links only', () => {
  const info = toInfo({ _type: 'playlist', title: 'Course', extractor_key: 'YoutubeTab', entries: [
    { url: 'https://www.youtube.com/watch?v=a', title: 'One', duration: 60, thumbnails: [{ url: 'https://i.ytimg.com/a.jpg' }] },
    { id: 'no-link' },
    { url: 'https://www.youtube.com/watch?v=b', title: 'Two', duration: 30 },
  ] }, 'https://www.youtube.com/playlist?list=x');
  assert.strictEqual(info.playlist, true);
  assert.deepStrictEqual(info.entries.map((e) => e.title), ['One', 'Two']);
  assert.strictEqual(info.duration, 90);
  assert.strictEqual(info.thumbnail, 'https://i.ytimg.com/a.jpg');
  assert.throws(() => toInfo({ _type: 'playlist', entries: [] }, 'u'), /UNREADABLE/);
});

test('downloader: "only a part" passes the range to yt-dlp and names the file after it', () => {
  const v = sectionArgs('mp4', { start: 65, end: 90.5 });
  assert.deepStrictEqual(v.args, ['--download-sections', '*65-90.5', '--force-keyframes-at-cuts']);
  assert.strictEqual(v.output, '%(title).140B [%(id)s] 1m05.0s-1m30.5s.%(ext)s');
  assert.deepStrictEqual(sectionArgs('mp3', { start: 0, end: 5 }).args, ['--download-sections', '*0-5'], 'audio needs no keyframes');
  assert.deepStrictEqual(sectionArgs('mp4', undefined), { args: [], output: OUTPUT });
  for (const bad of [{ start: 5, end: 5 }, { start: -1, end: 4 }, { start: 'a', end: 4 }, { start: 0, end: Infinity }]) assert.throws(() => sectionArgs('mp4', bad), /BAD_RANGE/);
});
