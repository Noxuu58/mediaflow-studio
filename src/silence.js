// Auto-Cut: finds the silences of a rush (FFmpeg silencedetect) and keeps only what is said.
// Three outputs: the cut video / audio, or a timeline for the editor — FCP 7 XML (Premiere Pro, DaVinci Resolve,
// Final Cut via XtoCC) or a CMX 3600 EDL — that points at the original file, so every cut stays adjustable.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { probe, kindOf, run, withJob, alive, outPath, remove, FFMPEG, AUDIO_OUT } = require('./convert');

const NOISE = [-20, -25, -30, -35, -40, -50]; // dB: below this level it counts as silence
const MIN = [0.3, 0.5, 0.6, 0.8, 1, 1.5, 2]; // seconds of silence before it is cut
const PAD = [0, 0.05, 0.1, 0.2, 0.3]; // seconds of breath kept on each side of a cut
const MIN_KEEP = 0.15; // a shorter piece of speech is a click or a breath: dropped

function settings({ noise = -30, min = 0.6, pad = 0.1 } = {}) {
  const s = { noise: Number(noise), min: Number(min), pad: Number(pad) };
  if (!NOISE.includes(s.noise) || !MIN.includes(s.min) || !PAD.includes(s.pad)) throw new Error('UNSUPPORTED');
  return s;
}

// silencedetect's log → [{ start, end }] in seconds. A silence still open at the end runs to the end.
function parseSilences(log, duration) {
  const out = [];
  let start = null;
  for (const m of String(log).matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === 'start') start = Math.max(0, Number(m[2]));
    else if (start != null) { out.push({ start, end: Math.min(duration, Number(m[2])) }); start = null; }
  }
  if (start != null && start < duration) out.push({ start, end: duration });
  return out;
}

// The parts to keep: everything between silences, with `pad` seconds of each silence kept around the speech.
// Pieces shorter than MIN_KEEP go; overlapping pieces merge. fps snaps the cuts to whole frames.
function keepSegments(silences, duration, pad = 0.1, fps = 0) {
  const snap = (t) => (fps ? Math.round(t * fps) / fps : Math.round(t * 1000) / 1000);
  const keep = [];
  let pos = 0;
  for (const s of silences) {
    const end = Math.min(duration, s.start + pad);
    if (end - pos >= MIN_KEEP) keep.push({ start: pos, end });
    pos = Math.max(pos, s.end - pad);
  }
  if (duration - pos >= MIN_KEEP) keep.push({ start: pos, end: duration });
  const merged = [];
  for (const k of keep.map((x) => ({ start: snap(x.start), end: snap(Math.min(duration, x.end)) }))) {
    const last = merged.at(-1);
    if (last && k.start <= last.end) last.end = Math.max(last.end, k.end);
    else if (k.end > k.start) merged.push(k);
  }
  return merged;
}

// Runs silencedetect on the first audio track (cancellable through the job). Progress 0..1.
function detect(src, s, duration, job, onProgress) {
  return new Promise((resolve, reject) => {
    if (job.aborted) return reject(new Error('CANCELLED'));
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-progress', 'pipe:1', '-nostats', '-i', src, '-map', '0:a:0',
      '-af', `silencedetect=n=${s.noise}dB:d=${s.min}`, '-f', 'null', '-'], { windowsHide: true });
    job.procs.add(p);
    let log = '', tail = '';
    p.stderr.on('data', (d) => {
      const text = String(d);
      tail = (tail + text).slice(-2000);
      log += text.split(/\r?\n/).filter((l) => l.includes('silence_')).join('\n') + '\n';
    });
    p.stdout.on('data', (d) => { const m = /out_time_us=(\d+)/.exec(String(d)); if (m && duration) onProgress(Math.min(1, m[1] / 1e6 / duration)); });
    p.on('error', (e) => { job.procs.delete(p); reject(e); });
    p.on('close', (code) => {
      job.procs.delete(p);
      if (job.aborted) return reject(new Error('CANCELLED'));
      if (code !== 0) return reject(Object.assign(new Error(tail.trim().split(/\r?\n/).pop() || `code ${code}`), { log: tail }));
      resolve(parseSilences(log, duration));
    });
  });
}

// ---- Timelines ---------------------------------------------------------------------------------------
const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const timebase = (fps) => ({ tb: Math.round(fps) || 30, ntsc: Math.abs(fps - Math.round(fps)) > 0.01 });

// 01:00:00:00-style timecode from a frame count at an integer timebase (non-drop frame).
function timecode(frames, tb) {
  const f = frames % tb, s = Math.floor(frames / tb);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, f].map((n) => String(n).padStart(2, '0')).join(':');
}
const tcFrames = (tc, tb) => { const p = String(tc || '').split(/[:;]/).map(Number); return p.length === 4 && p.every(Number.isFinite) ? ((p[0] * 60 + p[1]) * 60 + p[2]) * tb + p[3] : 0; };

// CMX 3600: one event per kept piece, source in/out (the file's own timecode, if it has one) → record from 01:00:00:00.
function edl(segments, { file, fps, hasVideo, hasAudio, timecode: startTc, title }) {
  const { tb } = timebase(fps);
  const offset = tcFrames(startTc, tb);
  const name = path.basename(file);
  const track = hasVideo && hasAudio ? 'AA/V' : hasVideo ? 'V   ' : 'AA  ';
  let rec = tcFrames('01:00:00:00', tb);
  const lines = [`TITLE: ${title}`, 'FCM: NON-DROP FRAME', ''];
  segments.forEach((s, i) => {
    const a = Math.round(s.start * fps), b = Math.round(s.end * fps);
    lines.push(`${String(i + 1).padStart(3, '0')}  AX       ${track}  C        ${timecode(offset + a, tb)} ${timecode(offset + b, tb)} ${timecode(rec, tb)} ${timecode(rec + b - a, tb)}`,
      `* FROM CLIP NAME: ${name}`, '');
    rec += b - a;
  });
  return `${lines.join('\r\n')}\r\n`;
}

// FCP 7 XML (xmeml 4): a sequence whose clips all point at the original file, video and audio linked.
function xml(segments, { file, fps, duration, width, height, hasVideo, hasAudio, rate = 48000, channels = 2, title }) {
  const { tb, ntsc } = timebase(fps);
  const rateXml = `<rate><timebase>${tb}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
  const total = Math.round(duration * fps);
  const name = xmlEsc(path.basename(file));
  const url = `file://localhost/${encodeURI(path.resolve(file).replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
  const fileXml = `<file id="file-1"><name>${name}</name><pathurl>${xmlEsc(url)}</pathurl>${rateXml}<duration>${total}</duration><media>`
    + (hasVideo ? `<video><samplecharacteristics>${rateXml}<width>${width}</width><height>${height}</height></samplecharacteristics></video>` : '')
    + (hasAudio ? `<audio><samplecharacteristics><depth>16</depth><samplerate>${rate}</samplerate></samplecharacteristics><channelcount>${channels}</channelcount></audio>` : '')
    + '</media></file>';
  let rec = 0, first = true;
  const pieces = segments.map((s) => {
    const i = Math.round(s.start * fps), o = Math.round(s.end * fps);
    const p = { i, o, start: rec, end: rec + o - i };
    rec += o - i;
    return p;
  });
  const kinds = [hasVideo && 'v', hasAudio && 'a'].filter(Boolean);
  const clip = (p, k, kind) => {
    const fileRef = first ? fileXml : '<file id="file-1"/>';
    first = false;
    const links = kinds.length > 1 ? kinds.map((x) => `<link><linkclipref>${x}-${k + 1}</linkclipref></link>`).join('') : '';
    return `<clipitem id="${kind}-${k + 1}"><name>${name}</name><enabled>TRUE</enabled><duration>${total}</duration>${rateXml}`
      + `<start>${p.start}</start><end>${p.end}</end><in>${p.i}</in><out>${p.o}</out>${fileRef}`
      + (kind === 'a' ? '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>' : '') + `${links}</clipitem>`;
  };
  const video = hasVideo ? `<video><format><samplecharacteristics>${rateXml}<width>${width}</width><height>${height}</height></samplecharacteristics></format><track>${pieces.map((p, k) => clip(p, k, 'v')).join('')}</track></video>` : '';
  const audio = hasAudio ? `<audio><track>${pieces.map((p, k) => clip(p, k, 'a')).join('')}</track></audio>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="sequence-1"><name>${xmlEsc(title)}</name><duration>${rec}</duration>${rateXml}`
    + `<media>${video}${audio}</media></sequence></xmeml>\n`;
}

// ---- The job -------------------------------------------------------------------------------------------
// target: 'cut' (media file), 'xml' or 'edl'. Returns the output path.
function autocut(src, target, opts, outDir, onProgress = () => {}, id) {
  const kind = kindOf(src);
  if ((kind !== 'video' && kind !== 'audio') || !['cut', 'xml', 'edl'].includes(target)) return Promise.reject(new Error('UNSUPPORTED'));
  const s = settings(opts);
  return withJob(id, async (job) => {
    const info = await probe(src, { thumb: false });
    alive(job);
    if (!info.audios.length) throw new Error('NO_AUDIO');
    if (!(info.duration > 0)) throw new Error('UNSUPPORTED');
    const hasVideo = Boolean(info.video) && kind === 'video';
    const fps = hasVideo ? info.video.baseFps || info.video.fps || 25 : 25;
    const silences = await detect(src, s, info.duration, job, (x) => onProgress(x * (target === 'cut' ? 0.3 : 0.95)));
    const segments = keepSegments(silences, info.duration, s.pad, hasVideo ? fps : 0);
    if (!segments.length) throw new Error('ALL_SILENT');
    const base = `${path.parse(src).name} Auto-Cut`;
    if (target !== 'cut') {
      const meta = { file: src, fps, duration: info.duration, width: info.video?.width, height: info.video?.height, hasVideo, hasAudio: true,
        rate: info.audio.rate, channels: info.audio.channels, timecode: info.timecode, title: base };
      const out = outPath(src, outDir, base, target);
      await fs.promises.writeFile(out, target === 'xml' ? xml(segments, meta) : edl(segments, meta));
      onProgress(1);
      return out;
    }
    // Cut file: every kept piece is re-encoded on its own (frame-accurate start), with PCM audio so pieces join
    // without gaps, then joined and the audio encoded once.
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mediaflow-'));
    const ext = hasVideo ? 'mp4' : AUDIO_OUT.includes(path.extname(src).slice(1).toLowerCase()) ? path.extname(src).slice(1).toLowerCase() : 'm4a';
    let out;
    try {
      const kept = segments.reduce((a, x) => a + x.end - x.start, 0);
      let done = 0;
      const list = [];
      for (const [i, seg] of segments.entries()) {
        const piece = path.join(tmp, `${String(i).padStart(5, '0')}.${hasVideo ? 'mkv' : 'wav'}`);
        const len = seg.end - seg.start;
        await run(['-ss', seg.start.toFixed(6), '-i', src, '-t', len.toFixed(6), '-map_metadata', '-1',
          ...(hasVideo ? ['-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p'] : ['-map', '0:a:0']),
          '-c:a', 'pcm_s24le', '-ar', '48000', piece], (x) => onProgress(0.3 + ((done + x * len) / kept) * 0.65), len, job);
        done += len;
        list.push(`file '${piece.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
      }
      await fs.promises.writeFile(path.join(tmp, 'list.txt'), list.join('\n'));
      const audio = { mp3: ['-c:a', 'libmp3lame', '-q:a', '0'], wav: ['-c:a', 'pcm_s24le'], flac: ['-c:a', 'flac'], m4a: ['-c:a', 'aac', '-b:a', '256k'] };
      out = outPath(src, outDir, base, ext);
      await run(['-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-i', src, '-map', '0', '-map_metadata', '1',
        ...(hasVideo ? ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'] : audio[ext] || ['-c:a', 'aac', '-b:a', '256k']), out],
      (x) => onProgress(0.95 + x * 0.05), kept, job);
      onProgress(1);
      return out;
    } catch (e) {
      if (out) await remove(out);
      throw job.aborted ? new Error('CANCELLED') : e;
    } finally { await remove(tmp); }
  });
}

module.exports = { autocut, parseSilences, keepSegments, edl, xml, timecode, settings, NOISE, MIN, PAD };
