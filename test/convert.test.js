const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { convert, trim, extract, strip, probe, cancel, killAll, kindOf, TARGETS, FFMPEG } = require('../src/convert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-'));
const out = path.join(dir, 'out');
fs.mkdirSync(out);
const ff = (...a) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...a]);

// Samples: fully transparent PNG, JPG, WebP, WAV, H.264/AAC MP4, VP9/Vorbis MKV (forces re-encode to MP4).
const s = (n) => path.join(dir, n);
ff('-f', 'lavfi', '-i', 'color=c=red@0:s=64x64,format=rgba', '-frames:v', '1', s('alpha.png'));
ff('-f', 'lavfi', '-i', 'testsrc=s=64x64', '-frames:v', '1', s('photo.jpg'));
ff('-f', 'lavfi', '-i', 'testsrc=s=64x64', '-frames:v', '1', s('pic.webp'));
ff('-f', 'lavfi', '-i', 'sine=d=2', s('tone.wav'));
ff('-f', 'lavfi', '-i', 'testsrc=d=2:s=160x120', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', s('clip.mp4'));
ff('-f', 'lavfi', '-i', 'testsrc=d=2:s=160x120', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libvpx-vp9', '-c:a', 'libvorbis', '-shortest', s('clip.mkv'));

for (const src of ['alpha.png', 'photo.jpg', 'pic.webp', 'tone.wav', 'clip.mp4', 'clip.mkv']) {
  for (const t of TARGETS[kindOf(src)]) {
    test(`${src} → ${t}`, async () => {
      const seen = [];
      const res = await convert(s(src), t, out, (p) => seen.push(p));
      assert.ok(fs.statSync(res).size > 0);
      assert.strictEqual(seen.at(-1), 1);
      execFileSync(FFMPEG, ['-v', 'error', '-i', res, '-f', 'null', '-']); // output must decode
    });
  }
}

test('transparent PNG flattens to white JPG', async () => {
  const res = await convert(s('alpha.png'), 'jpg', out);
  const px = execFileSync(FFMPEG, ['-v', 'error', '-i', res, '-vf', 'crop=1:1:0:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  assert.ok([...px].every((c) => c > 245), `pixel ${[...px]}`);
});

test('never overwrites: second run gets a new name', async () => {
  const a = await convert(s('tone.wav'), 'flac', out);
  const b = await convert(s('tone.wav'), 'flac', out);
  assert.notStrictEqual(a, b);
});

test('mp4 → mkv is a lossless remux (stream copy)', async () => {
  const res = await convert(s('clip.mp4'), 'mkv', out);
  const info = execFileSync(FFMPEG, ['-hide_banner', '-i', res, '-f', 'null', '-'], { stdio: 'pipe' }).toString();
  assert.ok(fs.existsSync(res) && !/Stream.*vp9/.test(info));
});

test('probe reads video stream, duration and thumbnail', async () => {
  const info = await probe(s('clip.mp4'));
  assert.ok(Math.abs(info.duration - 2) < 0.2, `duration ${info.duration}`);
  assert.deepStrictEqual([info.video.codec, info.video.width, info.video.height], ['h264', 160, 120]);
  assert.strictEqual(info.audio.codec, 'aac');
  assert.match(info.thumb, /^data:image\/jpeg;base64,\/9j/);
});

test('probe reads audio-only files', async () => {
  const info = await probe(s('tone.wav'));
  assert.deepStrictEqual([info.audio.codec, info.audio.rate, info.video, info.thumb], ['pcm_s16le', 44100, null, null]);
});

test('cancel stops the job, reports CANCELLED and leaves no partial file', async () => {
  ff('-f', 'lavfi', '-i', 'testsrc2=d=60:s=1280x720', '-c:v', 'libx264', '-preset', 'ultrafast', s('long.mp4'));
  const job = convert(s('long.mp4'), 'webm', out);
  await new Promise((r) => setTimeout(r, 1500));
  killAll();
  await assert.rejects(job, /CANCELLED/);
  assert.ok(!fs.existsSync(path.join(out, 'long.webm')));
});

// 10 s clip with a keyframe every second, so fast (stream copy) cuts land close to the request.
ff('-f', 'lavfi', '-i', 'testsrc2=d=10:s=320x240:r=25', '-f', 'lavfi', '-i', 'sine=d=10', '-c:v', 'libx264', '-g', '25', '-c:a', 'aac', '-shortest', s('ten.mp4'));
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('trim fast: stream copy, keeps codec, ~requested length', async () => {
  const res = await trim(s('ten.mp4'), { start: 2, end: 5, precise: false }, out);
  const info = await probe(res);
  assert.strictEqual(info.video.codec, 'h264');
  near(info.duration, 3, 1.1);
  assert.match(path.basename(res), /^ten 0m02\.0s-0m05\.0s\.mp4$/);
});

test('trim precise: frame-accurate length', async () => {
  const res = await trim(s('ten.mp4'), { start: 2.4, end: 5.6, precise: true }, out);
  near((await probe(res)).duration, 3.2, 0.1);
});

test('trim audio and bad ranges', async () => {
  near((await probe(await trim(s('tone.wav'), { start: 0.5, end: 1.5 }, out))).duration, 1, 0.05);
  await assert.rejects(trim(s('ten.mp4'), { start: 5, end: 2 }, out), /BAD_RANGE/);
  await assert.rejects(trim(s('photo.jpg'), { start: 0, end: 1 }, out), /UNSUPPORTED/);
});

test('extract normalizes loudness to the requested LUFS', async () => {
  ff('-f', 'lavfi', '-i', 'sine=f=440:d=6,volume=-32dB', s('quiet.wav'));
  const res = await extract(s('quiet.wav'), { format: 'wav', loudness: '-14', denoise: true, lowcut: true }, out);
  // ebur128 prints its integrated-loudness summary on stderr
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', res, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const lufs = +/I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.split('Summary:').pop())[1];
  near(lufs, -14, 1.5);
  assert.strictEqual((await probe(res)).audio.rate, 48000);
});

test('extract from video, and video without audio fails clearly', async () => {
  assert.ok((await extract(s('clip.mp4'), { format: 'mp3' }, out)).endsWith('.mp3'));
  ff('-f', 'lavfi', '-i', 'testsrc=d=1', '-c:v', 'libx264', s('mute.mp4'));
  await assert.rejects(extract(s('mute.mp4'), { format: 'wav' }, out), /NO_AUDIO/);
  await assert.rejects(extract(s('clip.mp4'), { format: 'mp3', loudness: '-99' }, out), /UNSUPPORTED/);
});

test('strip renders a filmstrip for video and a waveform for audio', async () => {
  assert.match(await strip(s('ten.mp4'), 10), /^data:image\/jpeg;base64,\/9j/);
  assert.match(await strip(s('tone.wav'), 2), /^data:image\/png;base64,iVBOR/);
});

test('cancel(id) stops only that job', async () => {
  const a = convert(s('long.mp4'), 'webm', out, () => {}, 'a');
  const b = trim(s('ten.mp4'), { start: 1, end: 4, precise: true }, out, () => {}, 'b');
  await new Promise((r) => setTimeout(r, 300));
  cancel('a');
  await assert.rejects(a, /CANCELLED/);
  assert.ok(fs.existsSync(await b), 'the other job finished');
});

test('cancel works from the first instant, even while the file is still being probed', async () => {
  const here = fs.mkdtempSync(path.join(dir, 'early-'));
  const job = extract(s('clip.mp4'), { format: 'wav' }, here, () => {}, 'early');
  cancel('early');
  await assert.rejects(job, /CANCELLED/);
  assert.deepStrictEqual(fs.readdirSync(here), []);
});

test('jobs started together never pick the same output name', async () => {
  const here = fs.mkdtempSync(path.join(dir, 'same-'));
  const files = await Promise.all([1, 2, 3].map(() => convert(s('tone.wav'), 'mp3', here)));
  assert.strictEqual(new Set(files).size, 3, files.join(' | '));
  for (const f of files) assert.ok(fs.statSync(f).size > 1000, f);
});

test('unsupported pair rejected', async () => {
  await assert.rejects(convert(s('tone.wav'), 'png', out));
});
