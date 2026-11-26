// v1.1 pro features: ffprobe inspection, presets + advanced overrides, VFR fix, HDR/10-bit, tracks, GPU fallback.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { encode, extract, probe, detectGpu, settingsFor, buildArgs, cancel, FFMPEG } = require('../src/convert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-'));
const out = path.join(dir, 'out');
fs.mkdirSync(out);
const s = (n) => path.join(dir, n);
const ff = (...a) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...a]);

ff('-f', 'lavfi', '-i', 'testsrc2=d=4:s=320x240:r=30', '-f', 'lavfi', '-i', 'sine=d=4', '-c:v', 'libx264', '-g', '30', '-c:a', 'aac', '-shortest', s('cfr.mp4'));
// 30 fps for 1 s, then 10 fps: a typical variable-frame-rate file
ff('-f', 'lavfi', '-i', 'testsrc2=d=4:s=320x240:r=30', '-f', 'lavfi', '-i', 'sine=d=4', '-vf', "select='lt(t\\,1)+not(mod(n\\,3))'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', s('vfr.mp4'));
ff('-f', 'lavfi', '-i', 'testsrc2=d=2:s=320x240:r=25', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le',
  '-x265-params', 'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:log-level=error', '-tag:v', 'hvc1', s('hdr10.mp4'));
ff('-f', 'lavfi', '-i', 'testsrc2=d=2:s=320x240:r=25', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-f', 'lavfi', '-i', 'sine=f=880:d=2',
  '-map', '0', '-map', '1', '-map', '2', '-c:v', 'libx264', '-c:a', 'aac', '-timecode', '01:00:00:00', '-shortest', s('tracks.mov'));
ff('-filter_complex', 'sine=f=440:d=2[a];sine=f=880:d=2[b];[a][b]join=inputs=2:channel_layout=stereo', s('lr.wav'));

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} not within ${tol} of ${b}`);

test('probe: CFR, VFR, 10-bit HDR, tracks and timecode', async () => {
  const cfr = await probe(s('cfr.mp4'));
  assert.deepStrictEqual([cfr.video.vfr, cfr.video.fps, cfr.video.depth, cfr.video.hdr, cfr.audios.length], [false, 30, 8, false, 1]);
  assert.match(cfr.thumb, /^data:image\/jpeg/);
  assert.strictEqual((await probe(s('vfr.mp4'))).video.vfr, true);
  const hdr = await probe(s('hdr10.mp4'));
  assert.deepStrictEqual([hdr.video.codec, hdr.video.depth, hdr.video.hdr, hdr.video.color.transfer], ['hevc', 10, true, 'smpte2084']);
  const tr = await probe(s('tracks.mov'));
  assert.deepStrictEqual([tr.audios.length, tr.timecode], [2, '01:00:00:00']);
});

test('settings: overrides are validated and combinations kept playable', () => {
  assert.strictEqual(settingsFor('youtube', { codec: 'prores_hq' }).container, 'mov'); // ProRes can't go in MP4
  assert.strictEqual(settingsFor('youtube', { audio: 'pcm24' }).audio, 'aac320'); // no PCM in MP4
  assert.strictEqual(settingsFor('proxy', { container: 'mxf', audio: 'aac320' }).audio, 'pcm24');
  assert.strictEqual(settingsFor('audio', { codec: 'hevc', audio: 'pcm16' }).codec, 'none'); // video keys ignored
  assert.throws(() => settingsFor('youtube', { codec: 'x264 -evil' }), /UNSUPPORTED/);
  assert.throws(() => settingsFor('nope'), /UNSUPPORTED/);
});

test('YouTube preset fixes variable frame rate', async () => {
  const p = await probe(await encode(s('vfr.mp4'), 'youtube', { gpu: 'off' }, out));
  assert.strictEqual(p.video.vfr, false);
  assert.strictEqual(p.video.codec, 'h264');
  assert.strictEqual(p.video.fps, 30); // the clip's nominal rate, not its 17.5 fps average
});

test('Proxy preset: ProRes Proxy 10-bit 4:2:2, HDR colour kept, PCM audio, all tracks, timecode', async () => {
  const hdr = await probe(await encode(s('hdr10.mp4'), 'proxy', {}, out));
  assert.deepStrictEqual([hdr.video.codec, hdr.video.pixFmt, hdr.video.color.transfer], ['prores', 'yuv422p10le', 'smpte2084']);
  const file = await encode(s('tracks.mov'), 'proxy', {}, out);
  assert.match(file, / Proxy\.mov$/);
  const tr = await probe(file);
  assert.deepStrictEqual([tr.audios.length, tr.audios[0].codec, tr.timecode], [2, 'pcm_s16le', '01:00:00:00']);
});

test('8-bit delivery of an HDR source is tone-mapped to BT.709', async () => {
  const p = await probe(await encode(s('hdr10.mp4'), 'youtube', { gpu: 'off' }, out));
  assert.deepStrictEqual([p.video.depth, p.video.hdr, p.video.color.transfer], [8, false, 'bt709']);
});

test('HEVC keeps 10-bit sources in 10-bit', async () => {
  const p = await probe(await encode(s('hdr10.mp4'), 'youtube', { codec: 'hevc', gpu: 'off' }, out));
  assert.deepStrictEqual([p.video.codec, p.video.depth, p.video.hdr], ['hevc', 10, true]);
});

test('TikTok preset: vertical 1080×1920 at 30 fps', async () => {
  const p = await probe(await encode(s('cfr.mp4'), 'tiktok', { gpu: 'off' }, out));
  assert.deepStrictEqual([p.video.width, p.video.height, p.video.fps], [1080, 1920, 30]);
});

test('Advanced: DNxHR HQ in MXF, mixed tracks', async () => {
  const dnx = await encode(s('cfr.mp4'), 'proxy', { codec: 'dnxhr_hq', container: 'mxf' }, out);
  const p = await probe(dnx);
  assert.deepStrictEqual([path.extname(dnx), p.video.codec, p.audio.codec], ['.mxf', 'dnxhd', 'pcm_s16le']); // Proxy keeps its PCM 16-bit
  assert.strictEqual((await probe(await encode(s('tracks.mov'), 'youtube', { tracks: 'mix', gpu: 'off' }, out))).audios.length, 1);
});

test('Audio "Copy" + "Mix" tracks: the mix is re-encoded instead of failing', async () => {
  const { tries } = buildArgs(s('tracks.mov'), await probe(s('tracks.mov'), { thumb: false }), settingsFor('youtube', { audio: 'copy', tracks: 'mix' }), null);
  assert.ok(!tries[0].join(' ').includes('-c:a copy'), tries[0].join(' '));
  const p = await probe(await encode(s('tracks.mov'), 'youtube', { audio: 'copy', tracks: 'mix', gpu: 'off' }, out));
  assert.deepStrictEqual([p.audios.length, p.audio.codec], [1, 'aac']);
});

test('Presets: cancel during the probe stops the job before any encode', async () => {
  const job = encode(s('cfr.mp4'), 'youtube', { gpu: 'off' }, out, () => {}, 'early-preset');
  cancel('early-preset');
  await assert.rejects(job, /CANCELLED/);
});

test('GPU: detected encoder is used, a failing one falls back to the CPU', async () => {
  const info = await probe(s('cfr.mp4'), { thumb: false });
  const { tries, usesGpu } = buildArgs(s('cfr.mp4'), info, settingsFor('youtube'), { vendor: 'Fake', h264: 'h264_bogus', hevc: null });
  assert.strictEqual(usesGpu, true);
  assert.strictEqual(tries.length, 2);
  assert.ok(tries[1].includes('libx264'));
  const gpu = await detectGpu();
  console.log('  GPU detected:', gpu ? gpu.vendor : 'none');
  if (gpu) assert.ok(fs.existsSync(await encode(s('cfr.mp4'), 'youtube', { gpu: 'on' }, out)));
});

test('Extractor: split L/R, mono, 24-bit, pick a track', async () => {
  const left = await extract(s('lr.wav'), { format: 'wav', channels: 'split' }, out);
  const right = left.replace(/ L\.wav$/, ' R.wav');
  assert.ok(fs.existsSync(right));
  assert.deepStrictEqual([(await probe(left)).audio.channels, (await probe(right)).audio.channels], [1, 1]);
  assert.strictEqual((await probe(await extract(s('lr.wav'), { format: 'wav', channels: 'mono', depth: '24' }, out))).audio.codec, 'pcm_s24le');
  near((await probe(await extract(s('tracks.mov'), { format: 'flac', track: '2' }, out))).duration, 2, 0.1);
  await assert.rejects(extract(s('tracks.mov'), { format: 'wav', track: '3' }, out), /NO_AUDIO/);
  await assert.rejects(extract(s('tracks.mov'), { format: 'wav', track: 'x' }, out), /UNSUPPORTED/);
});
