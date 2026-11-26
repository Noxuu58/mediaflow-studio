// Readable errors (src/errors.js) and the main-process log file (src/log.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readable } = require('../src/errors');
const { createLog } = require('../src/log');

globalThis.MF_LOCALES = {};
require('../src/locales/en.js');
const en = globalThis.MF_LOCALES.en.strings;

test('raw FFmpeg / yt-dlp failures become codes the UI can explain', () => {
  const cases = [
    ['av_interleaved_write_frame(): No space left on device', 'NO_SPACE'],
    ['C:\\Program Files\\out.mp4: Permission denied', 'ACCESS_DENIED'],
    ['clip.mp4: Invalid data found when processing input', 'CORRUPT'],
    ['[mov,mp4] moov atom not found', 'CORRUPT'],
    ['Private video. Sign in if you\'ve been granted access to this video', 'YT_UNAVAILABLE'],
    ['Sign in to confirm your age. This video may be inappropriate for some users.', 'YT_AGE'],
    ['Sign in to confirm you’re not a bot', 'YT_BOT'],
    ['HTTP Error 429: Too Many Requests', 'YT_RATE'],
    ['Unsupported URL: https://example.com/', 'YT_UNSUPPORTED'],
    ['Requested format is not available. Use --list-formats', 'YT_FORMAT'],
    ['Join this channel to get access to members-only content', 'YT_MEMBERS'],
    ['The uploader has not made this video available in your country', 'YT_GEO'],
    ['Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>', 'NETWORK'],
    ['clip.mp4: No such file or directory', 'NOT_FOUND'],
  ];
  for (const [raw, code] of cases) {
    const e = readable(Object.assign(new Error('Conversion failed!'), { log: raw }));
    assert.strictEqual(e.message, code, raw);
    assert.ok(en[`err.${code}`], `err.${code} has a message`);
  }
});

test('codes pass through, unknown messages are kept as they are', () => {
  for (const code of ['CANCELLED', 'DISK_FULL:12', 'AI_VRAM', 'PLAYLIST:3']) assert.strictEqual(readable(new Error(code)).message, code);
  assert.strictEqual(readable(new Error('Something odd happened')).message, 'Something odd happened');
  assert.strictEqual(readable('plain text').message, 'plain text');
});

test('the log file records errors with the tool output, and rotates past 2 MB', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-'));
  const file = path.join(dir, 'logs', 'main.log');
  const log = createLog(() => file);
  log('error', 'convert a.mp4', Object.assign(new Error('Conversion failed!'), { log: 'line 1\nNo space left on device' }));
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /ERROR convert a\.mp4 Error: Conversion failed!/);
  assert.match(text, /┊ No space left on device/);
  fs.appendFileSync(file, 'x'.repeat(2 * 2 ** 20 + 1));
  log('info', 'after');
  assert.ok(fs.existsSync(path.join(dir, 'logs', 'main.old.log')));
  assert.match(fs.readFileSync(file, 'utf8'), /^\S+ INFO  after\n$/);
});
