const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Inside the packaged app the binary is unpacked next to app.asar (see asarUnpack in package.json).
const FFMPEG = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

const KINDS = {
  image: ['png', 'jpg', 'jpeg', 'webp'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'],
  video: ['mp4', 'mkv', 'mov', 'webm', 'avi'],
};
const TARGETS = {
  image: ['png', 'jpg', 'webp'],
  audio: ['mp3', 'wav', 'flac', 'm4a'],
  video: ['mp4', 'mkv', 'mov', 'webm', 'mp3', 'wav', 'flac', 'm4a'],
};

const ext = (f) => path.extname(f).slice(1).toLowerCase();
const kindOf = (f) => Object.keys(KINDS).find((k) => KINDS[k].includes(ext(f))) || null;

// Re-encode settings, chosen for maximum quality.
function encodeArgs(src, target) {
  switch (target) {
    case 'png': return ['-frames:v', '1', '-c:v', 'png'];
    // Flatten transparency onto white: JPEG has no alpha channel.
    case 'jpg': return ['-frames:v', '1', '-filter_complex',
      '[0:v]format=rgba,split[a][b];[a]drawbox=c=white@1:t=fill[bg];[bg][b]overlay=format=auto,format=yuvj444p',
      '-c:v', 'mjpeg', '-q:v', '1'];
    // PNG sources stay lossless; already-lossy sources use near-lossless quality to avoid bloated files.
    case 'webp': return ['-frames:v', '1', '-c:v', 'libwebp',
      ...(ext(src) === 'png' ? ['-lossless', '1'] : ['-quality', '95']), '-compression_level', '6'];
    case 'mp3': return ['-vn', '-c:a', 'libmp3lame', '-q:a', '0'];
    // shortcut: always 16-bit PCM, 24-bit sources lose depth; probe sample_fmt if hi-res audio matters.
    case 'wav': return ['-vn', '-c:a', 'pcm_s16le'];
    case 'flac': return ['-vn', '-c:a', 'flac', '-compression_level', '8'];
    case 'm4a': return ['-vn', '-c:a', 'aac', '-b:a', '256k'];
    case 'webm': return ['-map', '0:v:0', '-map', '0:a?', '-c:v', 'libvpx-vp9', '-crf', '28', '-b:v', '0',
      '-row-mt', '1', '-c:a', 'libopus', '-b:a', '160k'];
    default: return ['-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', ...(target === 'mkv' ? [] : ['-movflags', '+faststart'])];
  }
}

// Video-to-video first tries a lossless remux (stream copy); the muxer rejects incompatible codecs fast.
const copyArgs = (target) => ['-map', '0:v:0', '-map', '0:a?', '-c', 'copy',
  ...(target === 'mkv' ? [] : ['-movflags', '+faststart'])];

function uniquePath(dir, name, target) {
  let out = path.join(dir, `${name}.${target}`);
  for (let i = 1; fs.existsSync(out); i++) out = path.join(dir, `${name} (${i}).${target}`);
  return out;
}

// Running jobs by id, so cancelling a clip in one tool never stops another tool's queue.
const jobs = new Map(); // id -> { aborted, procs: Set<ChildProcess> }
function cancel(id) {
  for (const [k, job] of jobs) if (id == null || k === id) { job.aborted = true; job.procs.forEach((p) => p.kill()); }
}
const killAll = () => cancel();

// One ffmpeg pass: duration, stream summary and (for video) a small JPEG thumbnail.
function probe(src) {
  const kind = kindOf(src);
  const thumb = kind === 'video' ? ['-frames:v', '1', '-vf', 'scale=192:-2', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1'] : [];
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', ...(thumb.length ? ['-ss', '1'] : []), '-i', src, ...thumb], { windowsHide: true });
    const timer = setTimeout(() => p.kill(), 15000);
    const img = []; let err = '';
    p.stdout.on('data', (d) => img.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => {});
    p.on('close', () => {
      clearTimeout(timer);
      const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(err);
      const v = kind !== 'audio' && /Stream #.*?Video: (\w+).*?, (\d{2,5})x(\d{2,5})(?:.*?([\d.]+) fps)?/.exec(err);
      const a = /Stream #.*?Audio: (\w+).*?, (\d+) Hz, (\w+)/.exec(err);
      resolve({
        duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
        video: v ? { codec: v[1], width: +v[2], height: +v[3], fps: v[4] ? +v[4] : 0 } : null,
        audio: a ? { codec: a[1], rate: +a[2], layout: a[3] } : null,
        thumb: img.length ? `data:image/jpeg;base64,${Buffer.concat(img).toString('base64')}` : null,
      });
    });
  });
}

// Timeline preview strip: evenly spaced video frames side by side, or the waveform of an audio file.
function strip(src, duration) {
  const N = 12;
  const args = kindOf(src) === 'audio'
    ? ['-i', src, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1400x96:colors=0x5ac8fa', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1']
    : [...Array.from({ length: N }, (_, i) => ['-ss', String(duration * (i + 0.5) / N), '-i', src]).flat(),
      '-filter_complex', Array.from({ length: N }, (_, i) => `[${i}:v:0]scale=-2:90,setsar=1[v${i}]`).join(';')
        + `;${Array.from({ length: N }, (_, i) => `[v${i}]`).join('')}hstack=inputs=${N}`,
      '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1'];
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', ...args], { windowsHide: true });
    const timer = setTimeout(() => p.kill(), 30000);
    const img = [];
    p.stdout.on('data', (d) => img.push(d));
    p.stderr.resume();
    p.on('error', () => {});
    p.on('close', () => {
      clearTimeout(timer);
      const type = args.includes('png') ? 'png' : 'jpeg';
      resolve(img.length ? `data:image/${type};base64,${Buffer.concat(img).toString('base64')}` : null);
    });
  });
}

function run(args, onProgress, total, job) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-n', '-progress', 'pipe:1', '-nostats', ...args],
      { windowsHide: true });
    job.procs.add(p);
    let duration = total, err = '';
    p.stderr.on('data', (d) => {
      err = (err + d).slice(-4000);
      const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(err);
      if (m && !duration) duration = +m[1] * 3600 + +m[2] * 60 + +m[3];
    });
    p.stdout.on('data', (d) => {
      const m = /out_time_us=(\d+)/g; let t, last;
      while ((t = m.exec(d))) last = t;
      if (last && duration) onProgress(Math.min(0.99, +last[1] / 1e6 / duration));
    });
    p.on('error', reject);
    p.on('close', (code) => {
      job.procs.delete(p);
      if (code === 0) return resolve();
      const line = err.trim().split(/\r?\n/).filter((l) => !/^\s/.test(l)).pop() || `code ${code}`;
      reject(Object.assign(new Error(line), { log: err }));
    });
  });
}

// Errors the UI translates are thrown as codes: CANCELLED, UNSUPPORTED, BAD_RANGE, NO_AUDIO.
// Runs FFmpeg into `out`, trying each argument list in turn (e.g. lossless remux first, then re-encode).
async function produce(id = Symbol('job'), out, tries, onProgress, total = 0) {
  const job = { aborted: false, procs: new Set() };
  jobs.set(id, job);
  try {
    let last;
    for (const args of tries) {
      try { await run([...args, out], onProgress, total, job); onProgress(1); return out; } catch (e) {
        fs.rmSync(out, { force: true }); // never leave a half-written file behind
        last = job.aborted ? new Error('CANCELLED') : e;
        if (job.aborted) break;
      }
    }
    throw last;
  } finally { jobs.delete(id); }
}

const outPath = (src, outDir, name, ext2) => uniquePath(outDir || path.dirname(src), name, ext2);

// Every job takes an optional `id` (last argument) so it can be cancelled on its own with cancel(id).
function convert(src, target, outDir, onProgress = () => {}, id) {
  const kind = kindOf(src);
  if (!kind || !TARGETS[kind].includes(target)) return Promise.reject(new Error('UNSUPPORTED'));
  const tries = kind === 'video' && KINDS.video.includes(target) ? [['-i', src, ...copyArgs(target)]] : [];
  tries.push(['-i', src, ...encodeArgs(src, target)]);
  return produce(id, outPath(src, outDir, path.parse(src).name, target), tries, onProgress);
}

// Clip [start, end] seconds. Fast = stream copy (lossless, starts on the keyframe before `start`);
// precise = re-encode at max quality, frame-accurate. Audio is always copied: its frames are tiny.
function trim(src, { start, end, precise }, outDir, onProgress = () => {}, id) {
  const kind = kindOf(src);
  start = Number(start); end = Number(end);
  if (kind !== 'video' && kind !== 'audio') return Promise.reject(new Error('UNSUPPORTED'));
  if (!(start >= 0 && end > start)) return Promise.reject(new Error('BAD_RANGE'));
  const stamp = (s) => `${Math.floor(s / 60)}m${(s % 60).toFixed(1).padStart(4, '0')}s`;
  const seek = ['-ss', String(start), '-i', src, '-t', String(end - start)];
  const args = precise && kind === 'video' ? [...seek, ...encodeArgs(src, ext(src))]
    : [...seek, '-map', '0:v?', '-map', '0:a?', '-c', 'copy', '-avoid_negative_ts', 'make_zero'];
  const out = outPath(src, outDir, `${path.parse(src).name} ${stamp(start)}-${stamp(end)}`, ext(src));
  return produce(id, out, [args], onProgress, end - start);
}

const AUDIO_OUT = ['mp3', 'wav', 'flac', 'm4a'];
const LOUDNESS = [-14, -16, -23]; // streaming, podcast, broadcast (EBU R128)

// First audio track → audio file, with optional cleanup: low-cut, FFT denoise, loudness normalization.
async function extract(src, { format, loudness, denoise, lowcut } = {}, outDir, onProgress = () => {}, id) {
  const kind = kindOf(src);
  if ((kind !== 'video' && kind !== 'audio') || !AUDIO_OUT.includes(format)) throw new Error('UNSUPPORTED');
  if (loudness && !LOUDNESS.includes(Number(loudness))) throw new Error('UNSUPPORTED');
  const af = [lowcut && 'highpass=f=80', denoise && 'afftdn=nf=-25', loudness && `loudnorm=I=${Number(loudness)}:TP=-1.5:LRA=11`].filter(Boolean);
  // loudnorm resamples to 192 kHz internally, so pin a standard rate whenever filters run.
  const args = ['-i', src, '-map', '0:a:0', ...encodeArgs(src, format), ...(af.length ? ['-af', af.join(','), '-ar', '48000'] : [])];
  try { return await produce(id, outPath(src, outDir, path.parse(src).name, format), [args], onProgress); } catch (e) {
    throw /matches no streams/.test(e.log || '') ? new Error('NO_AUDIO') : e;
  }
}

module.exports = { convert, trim, extract, strip, probe, kindOf, TARGETS, AUDIO_OUT, cancel, killAll, FFMPEG };
