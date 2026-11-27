// Metadata inspector & cleaner.
// inspect(): everything ffprobe knows about a file (container, every stream, colour, tags, chapters) plus, for
//   photos, the EXIF / XMP / IPTC blocks that travel inside them (camera, date, GPS position…).
// clean(): a copy without any of that. Videos and audio are remuxed (no re-encode, instant); JPEG / PNG / WebP
//   have their metadata blocks removed byte for byte, so the picture itself is untouched.
const fs = require('fs');
const path = require('path');
const { kindOf, collect, json, produce, withJob, alive, outPath, remove, FFPROBE } = require('./convert');

// Tags that say who, where, when or with what: shown in orange, and what clean() removes.
const PRIVATE = /locat|gps|xyz|latitude|longitude|altitude|make|model|manufacturer|device|serial|owner|creation_time|date|software|encoder|author|artist|copyright|comment|description|keywords|user|account|lens|com\.(apple|android|samsung|xiaomi|huawei)/i;

const num = (x) => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
const frac = (s) => { const [a, b] = String(s || '').split('/').map(Number); return b ? a / b : num(a); };

// ---- Photos: metadata blocks inside JPEG / PNG / WebP ------------------------------------------------------
// TIFF (EXIF) reader for IFD0 and the GPS IFD: { Make, Model, DateTime, Software, Orientation, GPS }.
function readTiff(buf) {
  if (buf.length < 8) return {};
  const le = buf.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const NAMES = { 0x010f: 'Make', 0x0110: 'Model', 0x0131: 'Software', 0x0132: 'DateTime', 0x013b: 'Artist', 0x8298: 'Copyright', 0x0112: 'Orientation', 0x8825: 'GPS' };
  const out = {};
  try {
    const ifd = u32(4), n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const name = NAMES[tag];
      if (!name) continue;
      if (type === 2) { // ASCII
        const at = count > 4 ? u32(e + 8) : e + 8;
        out[name] = buf.toString('latin1', at, at + count).replace(/\0.*$/s, '').trim();
      } else if (type === 3) out[name] = u16(e + 8);
      else if (type === 4) out[name] = u32(e + 8);
    }
    if (out.GPS) {
      const g = out.GPS, gn = u16(g);
      out.GPS = gn > 0; // the position itself is not shown, only that there is one
    }
  } catch {}
  return out;
}

// Splits a JPEG into its segments up to the image data. [{ marker, start, end }] + where the scan starts.
function jpegSegments(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('CORRUPT');
  const segs = [];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new Error('CORRUPT');
    const m = buf[i + 1];
    if (m === 0xff) { i++; continue; } // fill byte
    if (m === 0xda) return { segs, scan: i }; // start of scan: compressed picture until the end
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { segs.push({ marker: m, start: i, end: i + 2 }); i += 2; continue; }
    const end = i + 2 + buf.readUInt16BE(i + 2);
    segs.push({ marker: m, start: i, end });
    i = end;
  }
  throw new Error('CORRUPT');
}
const isExif = (buf, s) => buf.toString('latin1', s.start + 4, s.start + 10) === 'Exif\0\0';
const isXmp = (buf, s) => buf.toString('latin1', s.start + 4, s.start + 33).startsWith('http://ns.adobe.com/xap/');

// Minimal EXIF holding only the orientation, so a portrait photo stays upright after cleaning.
function orientationExif(o) {
  const b = Buffer.alloc(2 + 2 + 6 + 8 + 2 + 12 + 4);
  let p = 0;
  b.writeUInt16BE(0xffe1, p); p += 2;
  b.writeUInt16BE(b.length - 2, p); p += 2;
  b.write('Exif\0\0', p, 'latin1'); p += 6;
  b.write('MM\0*', p, 'latin1'); p += 4;
  b.writeUInt32BE(8, p); p += 4;
  b.writeUInt16BE(1, p); p += 2; // one entry
  b.writeUInt16BE(0x0112, p); b.writeUInt16BE(3, p + 2); b.writeUInt32BE(1, p + 4); b.writeUInt16BE(o, p + 8); p += 12;
  b.writeUInt32BE(0, p); // no next IFD
  return b;
}

// JPEG: drop EXIF / XMP (APP1), APP3–APP13 (IPTC, maker data) and comments; keep JFIF, the ICC colour profile (APP2)
// and Adobe (APP14), which change how the picture looks.
function stripJpeg(buf) {
  const { segs, scan } = jpegSegments(buf);
  const parts = [buf.subarray(0, 2)];
  let orientation = 1;
  for (const s of segs) {
    if (s.marker === 0xe1 && isExif(buf, s)) orientation = readTiff(buf.subarray(s.start + 10, s.end)).Orientation || orientation;
    const drop = s.marker === 0xe1 || (s.marker >= 0xe3 && s.marker <= 0xed) || s.marker === 0xfe;
    if (!drop) parts.push(buf.subarray(s.start, s.end));
  }
  if (orientation > 1 && orientation <= 8) parts.splice(1, 0, orientationExif(orientation));
  parts.push(buf.subarray(scan));
  return Buffer.concat(parts);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'];
function pngChunks(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('CORRUPT');
  const out = [];
  for (let i = 8; i + 12 <= buf.length;) {
    const len = buf.readUInt32BE(i), type = buf.toString('latin1', i + 4, i + 8);
    out.push({ type, start: i, end: i + 12 + len, data: buf.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}
const stripPng = (buf) => Buffer.concat([PNG_SIG, ...pngChunks(buf).filter((c) => !PNG_DROP.includes(c.type)).map((c) => buf.subarray(c.start, c.end))]);

function webpChunks(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('CORRUPT');
  const out = [];
  for (let i = 12; i + 8 <= buf.length;) {
    const type = buf.toString('latin1', i, i + 4), len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    out.push({ type, start: i, end: Math.min(end, buf.length), data: buf.subarray(i + 8, i + 8 + len) });
    i = end;
  }
  return out;
}
// WebP: drop the EXIF and XMP chunks and clear their flags in the VP8X header.
function stripWebp(buf) {
  const chunks = webpChunks(buf).filter((c) => c.type !== 'EXIF' && c.type !== 'XMP ').map((c) => Buffer.from(buf.subarray(c.start, c.end)));
  for (const c of chunks) if (c.toString('latin1', 0, 4) === 'VP8X') c[8] &= ~0x0c;
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

// The metadata blocks a photo carries: { blocks: ['EXIF', 'XMP'…], exif: { Make, Model, DateTime, GPS… } }.
function photoMeta(buf, ext) {
  const blocks = new Set();
  let exif = {};
  try {
    if (ext === 'jpg' || ext === 'jpeg') {
      for (const s of jpegSegments(buf).segs) {
        if (s.marker === 0xe1 && isExif(buf, s)) { blocks.add('EXIF'); exif = readTiff(buf.subarray(s.start + 10, s.end)); }
        else if (s.marker === 0xe1 && isXmp(buf, s)) blocks.add('XMP');
        else if (s.marker === 0xed) blocks.add('IPTC');
        else if (s.marker === 0xfe) blocks.add('Comment');
        else if (s.marker >= 0xe3 && s.marker <= 0xec) blocks.add('Maker data');
      }
    } else if (ext === 'png') {
      for (const c of pngChunks(buf)) {
        if (c.type === 'eXIf') { blocks.add('EXIF'); exif = readTiff(c.data); } else if (PNG_DROP.includes(c.type)) blocks.add(c.type === 'tIME' ? 'Date' : 'Text');
      }
    } else if (ext === 'webp') {
      for (const c of webpChunks(buf)) {
        if (c.type === 'EXIF') { blocks.add('EXIF'); exif = readTiff(c.data.toString('latin1', 0, 6) === 'Exif\0\0' ? c.data.subarray(6) : c.data); }
        if (c.type === 'XMP ') blocks.add('XMP');
      }
    }
  } catch {}
  return { blocks: [...blocks], exif };
}

// ---- inspect -------------------------------------------------------------------------------------------
function tagList(scope, tags) {
  return Object.entries(tags || {}).map(([key, value]) => ({ scope, key, value: String(value), private: PRIVATE.test(key) }));
}

async function inspect(src) {
  const st = await fs.promises.stat(src);
  const meta = json(await collect(FFPROBE, ['-v', 'error', '-of', 'json', '-show_format', '-show_streams', '-show_chapters', src]));
  if (!meta?.format) throw new Error('CORRUPT');
  const f = meta.format;
  const streams = meta.streams || [];
  const video = streams.filter((s) => s.codec_type === 'video').map((s) => ({
    index: s.index, codec: s.codec_long_name || s.codec_name, profile: s.profile || null, level: s.level > 0 ? s.level : null,
    width: s.width, height: s.height, sar: s.sample_aspect_ratio && s.sample_aspect_ratio !== '0:1' ? s.sample_aspect_ratio : null,
    dar: s.display_aspect_ratio && s.display_aspect_ratio !== '0:1' ? s.display_aspect_ratio : null,
    fps: num(frac(s.avg_frame_rate || s.r_frame_rate)?.toFixed(3)), pixFmt: s.pix_fmt || null,
    depth: Number(/(\d+)(?:le|be)$/.exec(s.pix_fmt || '')?.[1]) || num(s.bits_per_raw_sample) || null,
    range: s.color_range || null, primaries: s.color_primaries || null, transfer: s.color_transfer || null, space: s.color_space || null,
    rotation: s.side_data_list?.find((d) => d.rotation != null)?.rotation ?? null,
    bitrate: num(s.bit_rate), frames: num(s.nb_frames), cover: Boolean(s.disposition?.attached_pic), language: s.tags?.language || null,
  }));
  const audio = streams.filter((s) => s.codec_type === 'audio').map((s) => ({
    index: s.index, codec: s.codec_long_name || s.codec_name, profile: s.profile || null, rate: num(s.sample_rate), channels: s.channels,
    layout: s.channel_layout || null, depth: num(s.bits_per_raw_sample) || num(s.bits_per_sample) || null, bitrate: num(s.bit_rate), language: s.tags?.language || null,
  }));
  const other = streams.filter((s) => s.codec_type !== 'video' && s.codec_type !== 'audio').map((s) => ({
    index: s.index, type: s.codec_type, codec: s.codec_name || s.codec_tag_string || '', language: s.tags?.language || null, title: s.tags?.title || s.tags?.handler_name || null,
  }));
  const tags = [...tagList('file', f.tags), ...streams.flatMap((s) => tagList(`#${s.index}`, s.tags))];
  const ext = path.extname(src).slice(1).toLowerCase();
  const photo = kindOf(src) === 'image' ? photoMeta(await fs.promises.readFile(src), ext) : { blocks: [], exif: {} };
  for (const [key, value] of Object.entries(photo.exif)) {
    if (key !== 'Orientation') tags.push({ scope: 'EXIF', key, value: key === 'GPS' ? String(value) : String(value), private: key !== 'Orientation' });
  }
  return {
    path: src, name: path.basename(src), kind: kindOf(src), size: st.size,
    container: f.format_long_name || f.format_name, duration: num(f.duration), bitrate: num(f.bit_rate),
    created: f.tags?.creation_time || photo.exif.DateTime || null,
    video, audio, other, chapters: (meta.chapters || []).length,
    tags, blocks: photo.blocks, private: tags.filter((t) => t.private).length + photo.blocks.length,
  };
}

// ---- clean ---------------------------------------------------------------------------------------------
// A copy named "<name> Clean.<ext>" without tags, chapters, data tracks (GPS…) or photo metadata blocks.
function clean(src, outDir, onProgress = () => {}, id) {
  const kind = kindOf(src), ext = path.extname(src).slice(1).toLowerCase();
  if (!kind) return Promise.reject(new Error('UNSUPPORTED'));
  const name = `${path.parse(src).name} Clean`;
  if (kind === 'image') {
    return withJob(id, async (job) => {
      const buf = await fs.promises.readFile(src);
      alive(job);
      const strip = { jpg: stripJpeg, jpeg: stripJpeg, png: stripPng, webp: stripWebp }[ext];
      if (!strip) throw new Error('UNSUPPORTED');
      const out = outPath(src, outDir, name, ext);
      try { await fs.promises.writeFile(out, strip(buf)); } catch (e) { await remove(out); throw e; }
      onProgress(1);
      return out;
    });
  }
  // Streams only (no data tracks: some phones store the GPS track there); -bitexact keeps FFmpeg's own name and
  // the write date out of the file.
  const mp4ish = ['mp4', 'mov', 'm4a'].includes(ext);
  return withJob(id, async (job) => {
    const info = json(await collect(FFPROBE, ['-v', 'error', '-of', 'json', '-show_format', src]));
    alive(job);
    const total = Number(info?.format?.duration) || 0;
    return produce(id, outPath(src, outDir, name, ext), [['-i', src, '-map', '0:v?', '-map', '0:a?', '-map', '0:s?',
      '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
      ...(mp4ish ? ['-movflags', '+faststart'] : [])]], onProgress, total);
  });
}

module.exports = { inspect, clean, stripJpeg, stripPng, stripWebp, photoMeta, readTiff, PRIVATE };
