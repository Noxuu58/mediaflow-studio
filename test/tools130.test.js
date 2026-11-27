// v1.3 tools: target-size compressor, silence Auto-Cut (+ XML / EDL), GIF & WebP, metadata inspector / cleaner.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { probe, cancel, FFMPEG, FFPROBE } = require('../src/convert');
const { compress, plan, MB } = require('../src/compress');
const silence = require('../src/silence');
const { makeGif, settings: gifSettings } = require('../src/gif');
const { inspect, clean, stripJpeg, photoMeta, readTiff } = require('../src/inspect');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't130-'));
const out = path.join(dir, 'out');
fs.mkdirSync(out);
const s = (n) => path.join(dir, n);
const ff = (...a) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} not within ${tol} of ${b}`);

// 12 s of busy 1080p (noise: hard to compress) with sound.
ff('-f', 'lavfi', '-i', 'testsrc2=d=12:s=1920x1080:r=30,noise=alls=30:allf=t', '-f', 'lavfi', '-i', 'sine=f=440:d=12',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-c:a', 'aac', '-shortest', s('busy.mp4'));
// Speech pattern: 1 s tone · 1.5 s silence · 2 s tone · 1 s silence · 1 s tone (6.5 s), with a picture.
ff('-f', 'lavfi', '-i', 'testsrc2=d=6.5:s=320x240:r=25', '-filter_complex',
  'sine=f=300:d=1[a];anullsrc=r=44100:cl=mono,atrim=duration=1.5[b];sine=f=300:d=2[c];anullsrc=r=44100:cl=mono,atrim=duration=1[d];sine=f=300:d=1[e];[a][b][c][d][e]concat=n=5:v=0:a=1[out]',
  '-map', '0:v', '-map', '[out]', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-timecode', '10:00:00:00', s('talk.mp4'));
// Metadata a phone would leave behind.
ff('-f', 'lavfi', '-i', 'testsrc2=d=1:s=320x240:r=25', '-f', 'lavfi', '-i', 'sine=d=1', '-c:v', 'libx264', '-c:a', 'aac', '-shortest',
  '-metadata', 'location=+48.8584+002.2945/', '-metadata', 'com.apple.quicktime.make=Apple', '-metadata', 'com.apple.quicktime.model=iPhone 15',
  '-metadata', 'artist=Jane Doe', '-metadata:s:v:0', 'handler_name=Core Media Video', '-movflags', 'use_metadata_tags', s('phone.mov'));

test('compressor: bitrate plan from duration and target, smallest size when impossible', () => {
  const info = { duration: 60, video: { width: 1920, height: 1080 }, audios: [{}] };
  const p = plan(info, 10);
  assert.ok(p.video + p.audio <= (10 * MB * 8) / 60 / 1000, JSON.stringify(p));
  assert.strictEqual(p.height, 720, 'about 1.2 Mb/s of video: 720p looks better than a blocky 1080p');
  assert.strictEqual(plan(info, 100).height, null);
  assert.strictEqual(plan({ ...info, audios: [] }, 10).audio, 0);
  assert.throws(() => plan({ ...info, duration: 3600 }, 8), /TOO_SMALL:\d+/);
  assert.throws(() => plan(info, 0), /BAD_SIZE/);
  // Discord preset (20 MB): the budget stays under 20 × 10^6 bytes, i.e. under 20 MB counted in MB or in MiB.
  const d = plan({ ...info, duration: 120 }, 20);
  assert.ok(((d.video + d.audio) * 1000 * 120) / 8 <= 20e6 && 20e6 < 20 * 2 ** 20, JSON.stringify(d));
  assert.strictEqual(plan({ ...info, bitrate: 900e3 }, 100).video, 900, 'a small file never grows past its own bitrate');
});

test('compressor: two passes land under the target, close to it', async () => {
  const seen = [];
  const file = await compress(s('busy.mp4'), { size: 2 }, out, (x) => seen.push(x));
  const bytes = fs.statSync(file).size;
  assert.ok(bytes <= 2 * MB, `${bytes} bytes`);
  assert.ok(bytes > 1.4 * MB, `${bytes} bytes: the budget is used, not wasted`);
  const p = await probe(file, { thumb: false });
  assert.deepStrictEqual([p.video.codec, p.audio.codec], ['h264', 'aac']);
  assert.ok(seen.some((x) => x > 0.2 && x < 0.5) && seen.at(-1) === 1, 'progress through both passes');
  assert.match(path.basename(file), / 2MB\.mp4$/);
});

test('compressor: cancel stops both passes and leaves nothing', async () => {
  const job = compress(s('busy.mp4'), { size: 3 }, out, () => {}, 'cmp');
  setTimeout(() => cancel('cmp'), 700);
  await assert.rejects(job, /CANCELLED/);
  assert.ok(!fs.readdirSync(out).some((n) => n.includes('3MB')));
});

test('auto-cut: silences → pieces to keep, with breathing room and frame-exact cuts', () => {
  const log = 'silence_start: 0\nsilence_end: 0.8\nsilence_start: 2.0\nsilence_end: 3.6\nsilence_start: 5.2\nsilence_end: 5.25\nsilence_start: 9.5';
  const sil = silence.parseSilences(log, 10);
  assert.deepStrictEqual(sil.at(-1), { start: 9.5, end: 10 }, 'silence until the end');
  const keep = silence.keepSegments(sil, 10, 0.1, 25);
  assert.deepStrictEqual(keep, [{ start: 0.72, end: 2.12 }, { start: 3.52, end: 9.6 }]); // 0.7 s and 3.5 s, snapped to the nearest frame
  for (const k of keep) for (const t of [k.start, k.end]) near(t * 25, Math.round(t * 25), 1e-6, 'on a frame');
  assert.deepStrictEqual(silence.keepSegments([{ start: 0, end: 10 }], 10, 0.1), [], 'all silent');
  assert.throws(() => silence.settings({ noise: -99 }), /UNSUPPORTED/);
});

test('auto-cut: the cut video only keeps what is said', async () => {
  const file = await silence.autocut(s('talk.mp4'), 'cut', { noise: -30, min: 0.6, pad: 0.1 }, out);
  const p = await probe(file, { thumb: false });
  near(p.duration, 4 + 2 * 0.2 + 0.1, 0.35, 'duration'); // 4 s of tone + 0.1 s kept around each cut
  assert.ok(p.video && p.audio, 'picture and sound');
});

test('auto-cut: Premiere / Resolve XML and EDL point at the original file', async () => {
  const xmlFile = await silence.autocut(s('talk.mp4'), 'xml', {}, out);
  const xml = fs.readFileSync(xmlFile, 'utf8');
  assert.match(xml, /^<\?xml[^>]+>\n<!DOCTYPE xmeml>\n<xmeml version="4">/);
  assert.strictEqual((xml.match(/<clipitem /g) || []).length, 6, '3 pieces × video + audio');
  assert.strictEqual((xml.match(/<file id="file-1">/g) || []).length, 1, 'the file is described once, then referenced');
  assert.match(xml, /<pathurl>file:\/\/localhost\/[A-Z]:\/.+talk\.mp4<\/pathurl>/);
  assert.match(xml, /<in>0<\/in><out>2[78]<\/out>/, 'first piece: frames 0 → ~27 (1 s of speech + 0.1 s, 25 fps)');
  for (const tag of ['xmeml', 'sequence', 'media', 'video', 'audio', 'track', 'clipitem']) {
    assert.strictEqual((xml.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length, (xml.match(new RegExp(`</${tag}>`, 'g')) || []).length, `<${tag}> balanced`);
  }
  const edl = fs.readFileSync(await silence.autocut(s('talk.mp4'), 'edl', {}, out), 'utf8');
  const events = edl.split('\r\n').filter((l) => /^\d{3}  /.test(l));
  assert.strictEqual(events.length, 3);
  assert.match(events[0], /^001  AX {7}AA\/V  C {8}10:00:00:00 10:00:01:0[23] 01:00:00:00 01:00:01:0[23]$/, 'source timecode of the file');
  assert.match(edl, /\* FROM CLIP NAME: talk\.mp4/);
});

test('auto-cut: a file without sound is refused clearly', async () => {
  ff('-f', 'lavfi', '-i', 'testsrc2=d=1:s=160x120', s('mute.mp4'));
  await assert.rejects(silence.autocut(s('mute.mp4'), 'cut', {}, out), /NO_AUDIO/);
});

test('GIF: palette-optimised, at the chosen size and frame rate, never upscaled', async () => {
  const gif = await makeGif(s('busy.mp4'), { format: 'gif', fps: 10, height: '360', start: 2, length: 3 }, out);
  const st = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-of', 'json', '-count_frames', '-show_streams', gif]));
  const v = st.streams[0];
  assert.deepStrictEqual([v.codec_name, v.height, Number(v.nb_read_frames)], ['gif', 360, 30]);
  assert.match(path.basename(gif), / 0m02s\.gif$/);
  const small = await makeGif(s('talk.mp4'), { format: 'gif', height: '720', length: 3 }, out);
  assert.strictEqual(JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-of', 'json', '-show_streams', small])).streams[0].height, 240, 'a 240p source stays 240p');
  assert.throws(() => gifSettings({ fps: 7 }), /UNSUPPORTED/);
});

test('GIF: animated WebP', async () => {
  const webp = await makeGif(s('talk.mp4'), { format: 'webp', fps: 15, height: 'source', length: 3 }, out);
  const buf = fs.readFileSync(webp);
  assert.strictEqual(buf.toString('latin1', 8, 12), 'WEBP');
  assert.ok(buf.includes(Buffer.from('ANIM')) && buf.includes(Buffer.from('ANMF')), 'animated WebP chunks');
});

test('inspector: streams, colour, tags — with what is private flagged', async () => {
  const r = await inspect(s('phone.mov'));
  assert.strictEqual(r.video[0].width, 320);
  assert.strictEqual(r.audio.length, 1);
  assert.ok(r.container && r.duration > 0.9);
  const keys = r.tags.filter((t) => t.private).map((t) => t.key);
  for (const k of ['location', 'com.apple.quicktime.make', 'com.apple.quicktime.model', 'artist']) assert.ok(keys.some((x) => x.includes(k)), `${k} flagged`);
  assert.ok(r.private >= 4);
});

test('cleaner: video metadata gone, streams copied as they are', async () => {
  const file = await clean(s('phone.mov'), out);
  const r = await inspect(file);
  assert.deepStrictEqual(r.tags.filter((t) => t.private), [], JSON.stringify(r.tags));
  const [a, b] = [await probe(s('phone.mov'), { thumb: false }), await probe(file, { thumb: false })];
  assert.deepStrictEqual([b.video.codec, b.video.width, b.audio.codec], [a.video.codec, a.video.width, a.audio.codec]);
  assert.match(path.basename(file), / Clean\.mov$/);
});

// A JPEG with an EXIF block (camera, date, GPS, orientation 6) and a comment, built byte by byte.
function exifJpeg() {
  ff('-f', 'lavfi', '-i', 'testsrc=s=64x48', '-frames:v', '1', s('plain.jpg'));
  const jpg = fs.readFileSync(s('plain.jpg'));
  const ascii = (t) => Buffer.from(`${t}\0`, 'latin1');
  const make = ascii('Canon'), model = ascii('EOS R6 Mark II'), date = ascii('2026:11:20 14:03:00');
  const entries = 5, ifdStart = 8, dataStart = ifdStart + 2 + entries * 12 + 4;
  const tiff = Buffer.alloc(dataStart + make.length + model.length + date.length + 2 + 4);
  tiff.write('MM\0*', 0, 'latin1'); tiff.writeUInt32BE(8, 4); tiff.writeUInt16BE(entries, 8);
  let d = dataStart;
  const put = (i, tag, type, count, value) => { const e = 10 + i * 12; tiff.writeUInt16BE(tag, e); tiff.writeUInt16BE(type, e + 2); tiff.writeUInt32BE(count, e + 4); if (type === 3) tiff.writeUInt16BE(value, e + 8); else tiff.writeUInt32BE(value, e + 8); };
  const str = (i, tag, b) => { put(i, tag, 2, b.length, d); b.copy(tiff, d); d += b.length; };
  str(0, 0x010f, make); str(1, 0x0110, model); put(2, 0x0112, 3, 1, 6); str(3, 0x0132, date);
  const gps = d; tiff.writeUInt16BE(0, gps); tiff.writeUInt32BE(0, gps + 2); // empty GPS IFD
  put(4, 0x8825, 4, 1, gps);
  tiff.writeUInt16BE(1, gps); // one GPS entry (content not needed)
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 0]), Buffer.from('Exif\0\0', 'latin1'), tiff]);
  app1.writeUInt16BE(app1.length - 2, 2);
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0, 9]), Buffer.from('private', 'latin1')]);
  fs.writeFileSync(s('photo.jpg'), Buffer.concat([jpg.subarray(0, 2), app1, com, jpg.subarray(2)]));
}

test('photos: EXIF read, then stripped byte for byte with the orientation kept', async () => {
  exifJpeg();
  const r = await inspect(s('photo.jpg'));
  assert.ok(r.blocks.includes('EXIF') && r.blocks.includes('Comment'), r.blocks.join());
  const exif = Object.fromEntries(r.tags.filter((t) => t.scope === 'EXIF').map((t) => [t.key, t.value]));
  assert.deepStrictEqual([exif.Make, exif.Model, exif.DateTime, exif.GPS], ['Canon', 'EOS R6 Mark II', '2026:11:20 14:03:00', 'true']);
  const file = await clean(s('photo.jpg'), out);
  const buf = fs.readFileSync(file);
  assert.ok(!buf.includes(Buffer.from('Canon')) && !buf.includes(Buffer.from('private')), 'camera and comment gone');
  assert.deepStrictEqual(photoMeta(buf, 'jpg').exif, { Orientation: 6 }, 'only the orientation is left');
  const img = fs.readFileSync(s('plain.jpg'));
  assert.ok(buf.subarray(buf.length - 200).equals(img.subarray(img.length - 200)), 'picture data untouched');
  execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-f', 'null', '-']); // still decodes
  assert.deepStrictEqual(readTiff(Buffer.alloc(4)), {});
  assert.throws(() => stripJpeg(Buffer.from('nope')), /CORRUPT/);
});

test('photos: PNG text chunks and WebP EXIF / XMP removed', async () => {
  ff('-f', 'lavfi', '-i', 'testsrc=s=32x32', '-frames:v', '1', s('pic.png'));
  const png = fs.readFileSync(s('pic.png'));
  const data = Buffer.from('Author\0Jane Doe', 'latin1');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0); chunk.write('tEXt', 4, 'latin1'); data.copy(chunk, 8);
  chunk.writeUInt32BE(zlib.crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  fs.writeFileSync(s('tagged.png'), Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]));
  assert.ok((await inspect(s('tagged.png'))).blocks.includes('Text'));
  const cleanPng = fs.readFileSync(await clean(s('tagged.png'), out));
  assert.ok(!cleanPng.includes(Buffer.from('Jane')));
  execFileSync(FFMPEG, ['-v', 'error', '-i', path.join(out, 'tagged Clean.png'), '-f', 'null', '-']);

  ff('-f', 'lavfi', '-i', 'testsrc=s=32x32', '-frames:v', '1', '-c:v', 'libwebp', s('pic.webp'));
  const webp = fs.readFileSync(s('pic.webp'));
  // VP8X (EXIF + XMP flags) + the image + EXIF + XMP chunks
  const vp8x = Buffer.alloc(18); vp8x.write('VP8X', 0, 'latin1'); vp8x.writeUInt32LE(10, 4); vp8x[8] = 0x0c; vp8x.writeUIntLE(31, 12, 3); vp8x.writeUIntLE(31, 15, 3);
  const riffChunk = (type, body) => { const c = Buffer.alloc(8 + body.length + (body.length % 2)); c.write(type, 0, 'latin1'); c.writeUInt32LE(body.length, 4); body.copy(c, 8); return c; };
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), vp8x, webp.subarray(12), riffChunk('EXIF', Buffer.from('MM\0*secret-camera', 'latin1')), riffChunk('XMP ', Buffer.from('<x>secret</x>'))]);
  const head = Buffer.alloc(8); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length, 4);
  fs.writeFileSync(s('tagged.webp'), Buffer.concat([head, body]));
  assert.deepStrictEqual((await inspect(s('tagged.webp'))).blocks.sort(), ['EXIF', 'XMP']);
  const cleanWebp = fs.readFileSync(await clean(s('tagged.webp'), out));
  assert.ok(!cleanWebp.includes(Buffer.from('secret')));
  assert.strictEqual(cleanWebp[20] & 0x0c, 0, 'VP8X flags cleared');
  assert.strictEqual(cleanWebp.readUInt32LE(4), cleanWebp.length - 8, 'RIFF size updated');
  execFileSync(FFMPEG, ['-v', 'error', '-i', path.join(out, 'tagged Clean.webp'), '-f', 'null', '-']);
});

test('every text key the new tools use exists in English (so in every language)', () => {
  globalThis.MF_LOCALES = {};
  require('../src/locales/en.js');
  const en = globalThis.MF_LOCALES.en.strings;
  const files = ['compressor', 'autocut', 'gif', 'inspector'].map((n) => fs.readFileSync(path.join(__dirname, '..', 'src', 'tools', `${n}.js`), 'utf8'));
  const keys = new Set(files.flatMap((src) => [...src.matchAll(/'((?:cmp|cut|gif|ins|q|common|unit|adv)\.[A-Za-z0-9.]+)'/g)].map((m) => m[1])));
  for (const [p, list] of [['cmp.t.', ['8', '20', '25', '50', '100', 'custom']], ['cut.t.', ['cut', 'xml', 'edl']], ['gif.t.', ['gif', 'webp']]]) list.forEach((x) => keys.add(p + x));
  for (const k of ['err.TOO_SMALL', 'err.BAD_SIZE', 'err.ALL_SILENT']) keys.add(k);
  const missing = [...keys].filter((k) => !(k in en));
  assert.deepStrictEqual(missing, []);
  assert.ok(keys.size > 100, `${keys.size} keys checked`);
});
