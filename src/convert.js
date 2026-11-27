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

// Picks a free name and reserves it at once (exclusive create): two jobs started together never pick the same file.
// FFmpeg then overwrites the empty placeholder (-y); a failed job deletes it.
function uniquePath(dir, name, target) {
  for (let i = 0; ; i++) {
    const out = path.join(dir, i ? `${name} (${i}).${target}` : `${name}.${target}`);
    try { fs.closeSync(fs.openSync(out, 'wx')); return out; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}
// Never blocks the window; a file still held by a just-killed process is retried (EBUSY / EPERM).
const remove = (p) => fs.promises.rm(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});

// Running jobs by id, so cancelling a clip in one tool never stops another tool's queue.
const jobs = new Map(); // id -> { aborted, procs: Set<ChildProcess> }
function cancel(id) {
  for (const [k, job] of jobs) if (id == null || k === id) { job.aborted = true; job.procs.forEach((p) => p.kill()); }
}
const killAll = () => cancel();
// A job is registered from its first line (probe, GPU test, AI) to its last, so cancel(id) works at any moment.
// Nested calls with the same id (extract's L / R files, the encode after the AI) share the job.
async function withJob(id = Symbol('job'), fn) {
  if (jobs.has(id)) return fn(jobs.get(id));
  const job = { aborted: false, procs: new Set() };
  jobs.set(id, job);
  try { return await fn(job); } finally { if (jobs.get(id) === job) jobs.delete(id); }
}
const alive = (job) => { if (job.aborted) throw new Error('CANCELLED'); };

// ffprobe ships next to the app (resources/bin) or in vendor/ during development (scripts/fetch-ffprobe.js).
const FFPROBE = [process.resourcesPath && path.join(process.resourcesPath, 'bin', 'ffprobe.exe'),
  path.join(__dirname, '..', 'vendor', 'ffprobe.exe')].find((p) => p && fs.existsSync(p));

// Runs a binary and collects stdout (Buffer). Never rejects: probing must not break the UI.
function collect(bin, args, timeout = 20000) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out = [];
    const timer = setTimeout(() => p.kill(), timeout);
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.resume();
    p.on('error', () => { clearTimeout(timer); resolve(Buffer.alloc(0)); });
    p.on('close', () => { clearTimeout(timer); resolve(Buffer.concat(out)); });
  });
}
const json = (buf) => { try { return JSON.parse(buf.toString()); } catch { return null; } };
const frac = (s) => { const [a, b] = String(s || '0').split('/').map(Number); return b ? a / b : a || 0; };
const HDR_TRANSFERS = ['smpte2084', 'arib-std-b67']; // PQ (HDR10, Dolby Vision base) and HLG

// Variable frame rate: the frame interval of the first ~300 frames varies (phones, OBS, screen captures).
function isVfr(pts) {
  const t = pts.filter(Number.isFinite).sort((a, b) => a - b);
  const d = t.slice(1).map((x, i) => x - t[i]).filter((x) => x > 1e-4).sort((a, b) => a - b);
  if (d.length < 10) return false;
  const pick = (q) => d[Math.floor(q * (d.length - 1))];
  return pick(0.95) / pick(0.05) > 1.5;
}

// File inspection with ffprobe (JSON): streams, colour, bit depth, VFR, audio tracks, timecode,
// plus a small JPEG thumbnail from ffmpeg for videos. Fields stay null when unknown.
async function probe(src, { thumb = true } = {}) {
  const kind = kindOf(src);
  const [meta, packets, img] = await Promise.all([
    collect(FFPROBE, ['-v', 'error', '-of', 'json', '-show_format', '-show_streams', src]).then(json),
    kind === 'video' ? collect(FFPROBE, ['-v', 'error', '-of', 'json', '-select_streams', 'v:0', '-read_intervals', '%+#300', '-show_entries', 'packet=pts_time', src]).then(json) : null,
    kind === 'video' && thumb ? collect(FFMPEG, ['-hide_banner', '-nostdin', '-ss', '1', '-i', src, '-frames:v', '1', '-vf', 'scale=192:-2', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1'], 15000) : null,
  ]);
  const streams = meta?.streams || [];
  const vs = kind !== 'audio' && streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const as = streams.filter((s) => s.codec_type === 'audio');
  const tag = (s, k) => s?.tags?.[k];
  const color = (v) => (v && !/unknown|reserved|unspecified/.test(v) ? v : null);
  const video = vs ? {
    codec: vs.codec_name,
    width: vs.width, height: vs.height,
    fps: +frac(vs.avg_frame_rate || vs.r_frame_rate).toFixed(3),
    baseFps: +frac(vs.r_frame_rate).toFixed(3), // the stream's nominal rate (30 for a VFR phone clip)
    pixFmt: vs.pix_fmt,
    depth: Number(/(\d+)(?:le|be)$/.exec(vs.pix_fmt || '')?.[1]) || Number(vs.bits_per_raw_sample) || 8,
    hdr: HDR_TRANSFERS.includes(vs.color_transfer),
    vfr: kind === 'video' && isVfr((packets?.packets || []).map((p) => Number(p.pts_time))),
    color: { primaries: color(vs.color_primaries), transfer: color(vs.color_transfer), space: color(vs.color_space) },
    rotation: Number(vs.side_data_list?.find((d) => d.rotation != null)?.rotation ?? tag(vs, 'rotate') ?? 0),
  } : null;
  const audios = as.map((s) => ({ codec: s.codec_name, rate: Number(s.sample_rate), channels: s.channels, layout: s.channel_layout || `${s.channels}ch` }));
  return {
    duration: Number(meta?.format?.duration) || 0,
    bitrate: Number(meta?.format?.bit_rate) || 0,
    video,
    audio: audios[0] || null,
    audios,
    timecode: tag(meta?.format, 'timecode') || streams.map((s) => tag(s, 'timecode')).find(Boolean) || null,
    thumb: img?.length ? `data:image/jpeg;base64,${img.toString('base64')}` : null,
  };
}

// ---- GPU encoders: each one tried once (a tiny encode). The preference (Settings) picks among those that work:
// 'auto' = first of NVIDIA → Intel → AMD, a vendor id, or 'cpu' to never use the GPU.
const ENCODERS = [['nvenc', 'NVIDIA NVENC', 'h264_nvenc', 'hevc_nvenc'], ['qsv', 'Intel Quick Sync', 'h264_qsv', 'hevc_qsv'], ['amf', 'AMD AMF', 'h264_amf', 'hevc_amf']];
let encoderPref = 'auto';
const setEncoder = (pref) => { encoderPref = ['auto', 'cpu', ...ENCODERS.map((e) => e[0])].includes(pref) ? pref : 'auto'; };
let gpuCheck;
function encoders() {
  const works = (enc) => new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:r=30:d=0.2', '-c:v', enc, '-f', 'null', '-'], { windowsHide: true });
    const timer = setTimeout(() => p.kill(), 15000);
    p.on('error', () => resolve(false));
    p.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
  return (gpuCheck ||= (async () => {
    const list = [];
    for (const [id, vendor, h264, hevc] of ENCODERS) {
      if (await works(h264)) list.push({ id, vendor, h264, hevc: (await works(hevc)) ? hevc : null });
    }
    return list;
  })());
}
async function detectGpu() {
  if (encoderPref === 'cpu') return null;
  const list = await encoders();
  return list.find((e) => e.id === encoderPref) || list[0] || null;
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
    if (job.aborted) return reject(new Error('CANCELLED'));
    // -y: the output name was reserved by uniquePath (an empty placeholder), never someone else's file.
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args],
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
function produce(id, out, tries, onProgress, total = 0) {
  return withJob(id, async (job) => {
    let last;
    for (const args of tries) {
      try { await run([...args, out], onProgress, total, job); onProgress(1); return out; } catch (e) {
        last = job.aborted ? new Error('CANCELLED') : e;
        if (job.aborted) break;
      }
    }
    await remove(out); // never leave a half-written file (or the empty placeholder) behind
    throw last;
  });
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

// ---- Presets (Simple mode) + Advanced overrides -----------------------------------------------
// The UI only sends a preset id and the advanced choices; everything is validated against these lists.
const PRESETS = {
  tiktok: { codec: 'h264', speed: 'fast', container: 'mp4', vertical: true, fps: 30, depth: 'auto', height: null, audio: 'aac192', tracks: 'first', loudness: -14, suffix: ' TikTok' },
  youtube: { codec: 'h264', speed: 'quality', container: 'mp4', fps: 'fix', depth: 'auto', height: null, audio: 'aac320', tracks: 'first', suffix: ' YouTube' },
  proxy: { codec: 'prores_proxy', container: 'mov', fps: 'fix', depth: 'auto', height: 1080, audio: 'pcm16', tracks: 'all', suffix: ' Proxy' },
  audio: { codec: 'none', container: 'wav', audio: 'pcm24', tracks: 'first', suffix: '' },
  // AI Enhance tool: same high-quality delivery as "Clean export"; the AI target comes from aiHeight / aiFps.
  upscale: { codec: 'h264', speed: 'quality', container: 'mp4', fps: null, depth: 'auto', height: null, audio: 'aac320', tracks: 'all', suffix: ' Upscaled' },
  interpolate: { codec: 'h264', speed: 'quality', container: 'mp4', fps: null, depth: 'auto', height: null, audio: 'aac320', tracks: 'all', suffix: ' Interpolated' },
};
const ADVANCED = {
  codec: ['auto', 'h264', 'hevc', 'prores_proxy', 'prores_lt', 'prores', 'prores_hq', 'dnxhr_lb', 'dnxhr_sq', 'dnxhr_hq', 'dnxhr_hqx'],
  container: ['auto', 'mp4', 'mov', 'mkv', 'mxf'],
  depth: ['auto', '8', '10'],
  fps: ['auto', 'keep', 'fix', '24', '25', '30', '50', '60'],
  height: ['auto', 'source', '2160', '1440', '1080', '720'],
  audio: ['auto', 'aac192', 'aac320', 'pcm16', 'pcm24', 'copy'],
  tracks: ['auto', 'first', 'all', 'mix'],
  gpu: ['auto', 'on', 'off'],
  // AI Video Enhancement (src/ai.js): Upscaling always runs the AI; a lower frame rate is a plain frame drop.
  aiHeight: ['auto', '720', '1080', '1440', '2160'],
  aiFps: ['auto', '24', '25', '30', '50', '60', '120', '180', '240'],
  aiModel: ['auto', 'fast', 'quality'],
  aiScale: ['auto', '2', '3', '4'], // images: ×2 / ×3 / ×4
};
const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';
const aiRequested = (adv = {}) => ['aiHeight', 'aiFps'].some((k) => adv[k] && adv[k] !== 'auto');
const AUDIO_ONLY_KEYS = ['audio', 'tracks'];

function settingsFor(preset, adv = {}) {
  const base = PRESETS[preset];
  if (!base) throw new Error('UNSUPPORTED');
  const s = { gpu: 'auto', ...base };
  for (const [k, allowed] of Object.entries(ADVANCED)) {
    const v = adv[k];
    if (v == null || v === 'auto' || v === '') continue;
    if (!allowed.includes(String(v))) throw new Error('UNSUPPORTED');
    if (preset === 'audio' && !AUDIO_ONLY_KEYS.includes(k)) continue; // video settings don't apply to audio
    s[k] = /^\d+$/.test(v) ? Number(v) : v;
  }
  if (s.height === 'source') s.height = null;
  if (s.fps === 'keep') s.fps = null;
  // Keep codec / container / audio combinations that editors and players actually accept.
  const intra = /^(prores|dnxhr)/.test(s.codec);
  if (preset === 'audio') s.container = /^aac/.test(s.audio) ? 'm4a' : 'wav';
  else {
    if (intra && s.container === 'mp4') s.container = 'mov';
    if (!intra && s.container === 'mxf') s.container = 'mov';
    if (s.container === 'mp4' && /^pcm/.test(s.audio)) s.audio = 'aac320';
    if (s.container === 'mxf' && !/^pcm/.test(s.audio)) s.audio = 'pcm24';
  }
  return s;
}

const STANDARD_FPS = [['24000/1001', 23.976], ['24', 24], ['25', 25], ['30000/1001', 29.97], ['30', 30], ['50', 50], ['60000/1001', 59.94], ['60', 60]];
const nearestFps = (f) => STANDARD_FPS.reduce((best, cur) => (Math.abs(cur[1] - f) < Math.abs(best[1] - f) ? cur : best))[0];

function videoEncoder(codec, depth, speed, hw) {
  const fast = speed === 'fast';
  if (codec === 'h264') {
    if (hw?.h264 && depth === 8) {
      if (hw.h264 === 'h264_nvenc') return ['-c:v', 'h264_nvenc', '-preset', fast ? 'p4' : 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', fast ? '23' : '19', '-b:v', '0', '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
      if (hw.h264 === 'h264_qsv') return ['-c:v', 'h264_qsv', '-preset', fast ? 'faster' : 'slower', '-global_quality', fast ? '24' : '20', '-pix_fmt', 'nv12'];
      const q = fast ? '23' : '19';
      return ['-c:v', 'h264_amf', '-quality', fast ? 'speed' : 'quality', '-rc', 'cqp', '-qp_i', q, '-qp_p', q, '-qp_b', q, '-pix_fmt', 'yuv420p'];
    }
    return ['-c:v', 'libx264', '-preset', fast ? 'veryfast' : 'slow', '-crf', fast ? '21' : '17',
      '-profile:v', depth === 10 ? 'high10' : 'high', '-pix_fmt', depth === 10 ? 'yuv420p10le' : 'yuv420p'];
  }
  if (codec === 'hevc') {
    const ten = depth === 10;
    if (hw?.hevc === 'hevc_nvenc') return ['-c:v', 'hevc_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', '21', '-b:v', '0', '-tag:v', 'hvc1', ...(ten ? ['-profile:v', 'main10', '-pix_fmt', 'p010le'] : ['-pix_fmt', 'yuv420p'])];
    if (hw?.hevc === 'hevc_qsv') return ['-c:v', 'hevc_qsv', '-global_quality', '22', '-tag:v', 'hvc1', '-pix_fmt', ten ? 'p010le' : 'nv12'];
    if (hw?.hevc === 'hevc_amf') return ['-c:v', 'hevc_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '20', '-tag:v', 'hvc1', '-pix_fmt', ten ? 'p010le' : 'yuv420p'];
    return ['-c:v', 'libx265', '-preset', 'medium', '-crf', '20', '-tag:v', 'hvc1', '-x265-params', 'log-level=error', '-pix_fmt', ten ? 'yuv420p10le' : 'yuv420p'];
  }
  if (codec.startsWith('prores')) return ['-c:v', 'prores_ks', '-profile:v', String({ prores_proxy: 0, prores_lt: 1, prores: 2, prores_hq: 3 }[codec]), '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'];
  return ['-c:v', 'dnxhd', '-profile:v', codec, '-pix_fmt', codec === 'dnxhr_hqx' ? 'yuv422p10le' : 'yuv422p'];
}

// Builds the FFmpeg arguments for a preset job. Returns { tries, ext, usesGpu }: `tries` holds the GPU
// command first and the CPU one as fallback (a driver can refuse a format or a size).
function buildArgs(src, info, s, gpu) {
  const audios = info.audios || [];
  const af = s.loudness ? [`loudnorm=I=${s.loudness}:TP=-1.5:LRA=11`] : [];
  let audio = s.audio;
  const mix = s.tracks === 'mix' && audios.length > 1;
  if ((af.length || mix) && audio === 'copy') audio = 'aac320'; // filters (loudness, mix) need a re-encode
  const acodec = { aac192: ['-c:a', 'aac', '-b:a', '192k'], aac320: ['-c:a', 'aac', '-b:a', '320k'], pcm16: ['-c:a', 'pcm_s16le'], pcm24: ['-c:a', 'pcm_s24le'], copy: ['-c:a', 'copy'] }[audio];
  const rate = audio === 'copy' ? [] : ['-ar', '48000'];
  let amap = [], fc = [];
  if (audios.length) {
    if (mix) {
      fc.push(`${audios.map((_, i) => `[0:a:${i}]`).join('')}amix=inputs=${audios.length}:normalize=0${af.length ? `,${af.join(',')}` : ''}[aout]`);
      amap = ['-map', '[aout]'];
    } else amap = ['-map', s.tracks === 'all' ? '0:a' : '0:a:0'];
  }
  const afArgs = af.length && !fc.length && audios.length ? ['-af', af.join(',')] : [];
  const audioArgs = audios.length ? [...amap, ...afArgs, ...acodec, ...rate] : [];

  if (s.codec === 'none') {
    if (!audios.length) throw new Error('NO_AUDIO');
    return { tries: [['-i', src, ...(fc.length ? ['-filter_complex', fc.join(';')] : []), '-vn', ...audioArgs, '-map_metadata', '0']], ext: s.container, usesGpu: false };
  }

  const v = info.video;
  if (!v) throw new Error('UNSUPPORTED');
  const intra = /^(prores|dnxhr)/.test(s.codec);
  const depth = s.depth === 8 ? 8 : s.depth === 10 ? 10
    : s.codec.startsWith('prores') || s.codec === 'dnxhr_hqx' ? 10
      : s.codec === 'hevc' && v.depth >= 10 ? 10 : 8;
  const tonemap = v.hdr && depth === 8; // HDR → SDR so 8-bit deliveries don't look washed out
  const vf = [];
  if (tonemap) vf.push(TONEMAP);
  const turned = Math.abs(v.rotation) % 180 === 90; // ffmpeg auto-rotates before the filters
  const W = turned ? v.height : v.width, H = turned ? v.width : v.height;
  if (s.vertical) vf.push(W > H ? 'crop=trunc(ih*9/16/2)*2:ih,scale=1080:1920:flags=lanczos' : 'scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2');
  else if (s.height && H > s.height) vf.push(`scale=-2:${s.height}:flags=lanczos`);
  const fps = typeof s.fps === 'number' ? String(s.fps) : s.fps === 'fix' && v.vfr ? nearestFps(v.baseFps || v.fps) : null;
  if (fps) vf.push(`fps=${fps}`); // constant frame rate: no audio drift in the editor
  const colorTags = tonemap ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']
    : [['-color_primaries', v.color.primaries], ['-color_trc', v.color.transfer], ['-colorspace', v.color.space]].filter(([, x]) => x).flat();
  const keepTc = info.timecode && ['mov', 'mp4', 'mxf'].includes(s.container) ? ['-timecode', info.timecode] : [];
  const mux = s.container === 'mp4' || s.container === 'mov' ? ['-movflags', '+faststart'] : [];
  const filters = [...(vf.length ? [`[0:v:0]${vf.join(',')}[vout]`] : []), ...fc];
  const head = ['-i', src, ...(filters.length ? ['-filter_complex', filters.join(';')] : []), '-map', vf.length ? '[vout]' : '0:v:0'];
  const tail = [...audioArgs, ...colorTags, ...keepTc, '-map_metadata', '0', ...mux];
  const hw = !intra && s.gpu !== 'off' && gpu && (s.codec === 'h264' ? depth === 8 : Boolean(gpu.hevc)) ? gpu : null;
  const cpu = [...head, ...videoEncoder(s.codec, depth, s.speed, null), ...tail];
  return { tries: hw ? [[...head, ...videoEncoder(s.codec, depth, s.speed, hw), ...tail], cpu] : [cpu], ext: s.container, usesGpu: Boolean(hw) };
}

// Preset job: probe → settings → FFmpeg (GPU first when available, CPU fallback).
// With AI targets (aiHeight / aiFps), the AI stage (src/ai.js) runs first and the preset encode takes its
// output: progress 0-90 % is the AI work (onProgress gets a stage label), 90-100 % the final encode.
async function encode(src, preset, adv, outDir, onProgress = () => {}, id = Symbol('job')) {
  const kind = kindOf(src);
  if (kind === 'image' && preset === 'upscale') return upscaleImage(src, settingsFor(preset, adv), outDir, onProgress, id);
  if (kind !== 'video' && !(kind === 'audio' && preset === 'audio')) throw new Error('UNSUPPORTED');
  const s = settingsFor(preset, adv);
  return withJob(id, async (job) => {
    let info = await probe(src, { thumb: false });
    alive(job);
    const gpu = s.gpu === 'off' ? null : await detectGpu();
    let input = src, tmp = null, report = (x) => onProgress(x);
    try {
      if (preset !== 'audio' && info.video && (s.aiHeight || s.aiFps)) {
        const ai = require('./ai');
        const p = ai.plan(info, { height: s.aiHeight || 'source', fps: s.aiFps || 'source', model: s.aiModel || 'fast', restore: preset === 'upscale' });
        s.height = p.targetH; // exact target: AI already reached it when upscaling, plain downscale otherwise
        if (Math.abs(p.targetFps - p.srcFps) > 0.01) s.fps = p.targetFps; // drop frames, or resample RIFE's ×N to the target
        if (p.ai) {
          const check = await ai.detect(FFMPEG); // clear message now, not after minutes of frame extraction
          if (!check.available) throw new Error(check.reason === 'ENGINES' ? 'AI_MISSING' : `AI_${check.reason}`);
          alive(job);
          ({ file: input, tmp } = await ai.enhance(src, info, p, { FFMPEG, job, gpu, tonemap: TONEMAP, onProgress: (x, stage) => onProgress(x * 0.9, stage) }));
          info = { ...(await probe(input, { thumb: false })), timecode: info.timecode };
          report = (x) => onProgress(0.9 + x * 0.1, 'encode');
        }
      }
      alive(job);
      const { tries, ext } = buildArgs(input, info, s, gpu);
      return await produce(id, outPath(src, outDir, `${path.parse(src).name}${s.suffix}`, ext), tries, report, info.duration);
    } finally {
      if (tmp) await remove(tmp);
    }
  });
}

// AI Enhance on a photo: Real-ESRGAN ×2 / ×3 / ×4 (src/ai.js), saved in the source format ("photo Upscaled.jpg").
function upscaleImage(src, s, outDir, onProgress, id) {
  const ai = require('./ai');
  return withJob(id, async (job) => {
    const info = await probe(src, { thumb: false });
    if (!info.video?.width) throw new Error('UNSUPPORTED');
    const check = await ai.detect(FFMPEG);
    if (!check.available) throw new Error(check.reason === 'ENGINES' ? 'AI_MISSING' : `AI_${check.reason}`);
    alive(job);
    const up = await ai.upscaleImage(src, info.video, { scale: s.aiScale || 4, model: s.aiModel || 'fast' }, { FFMPEG, job, onProgress: (x) => onProgress(x * 0.95, 'upscale') });
    try {
      const target = ext(src) === 'jpeg' ? 'jpg' : ext(src);
      return await produce(id, outPath(src, outDir, `${path.parse(src).name}${s.suffix}`, target), [['-i', up.file, ...encodeArgs(src, target)]], (x) => onProgress(0.95 + x * 0.05, 'encode'));
    } finally { await remove(up.tmp); }
  });
}

const AUDIO_OUT = ['mp3', 'wav', 'flac', 'm4a'];
const LOUDNESS = [-14, -16, -23]; // streaming, podcast, broadcast (EBU R128)

const EXTRACT_ADV = { track: /^(first|mix|[1-9]\d?)$/, channels: /^(keep|mono|split)$/, depth: /^(16|24)$/, rate: /^(source|44100|48000)$/ };

// An audio track → audio file, with optional cleanup (low-cut, FFT denoise, loudness normalization)
// and pro options: which track (or a mix of all), mono / split L-R into two files, 24-bit, sample rate.
// Returns the output path (for "split", the left-channel file; the right one sits next to it).
async function extract(src, opts = {}, outDir, onProgress = () => {}, id = Symbol('job')) {
  const { format, loudness, denoise, lowcut, track = 'first', channels = 'keep', depth = '16', rate = 'source' } = opts;
  const kind = kindOf(src);
  if ((kind !== 'video' && kind !== 'audio') || !AUDIO_OUT.includes(format)) throw new Error('UNSUPPORTED');
  if (loudness && !LOUDNESS.includes(Number(loudness))) throw new Error('UNSUPPORTED');
  for (const [k, re] of Object.entries(EXTRACT_ADV)) if (!re.test(String({ track, channels, depth, rate }[k]))) throw new Error('UNSUPPORTED');
  return withJob(id, async (job) => {
    const info = await probe(src, { thumb: false });
    alive(job);
    const n = info.audios.length;
    if (!n) throw new Error('NO_AUDIO');
    const index = track === 'mix' || track === 'first' ? 0 : Number(track) - 1;
    if (index >= n) throw new Error('NO_AUDIO');
    const af = [lowcut && 'highpass=f=80', denoise && 'afftdn=nf=-25', loudness && `loudnorm=I=${Number(loudness)}:TP=-1.5:LRA=11`].filter(Boolean);
    const input = track === 'mix' && n > 1 ? `${info.audios.map((_, i) => `[0:a:${i}]`).join('')}amix=inputs=${n}:normalize=0` : `[0:a:${index}]anull`;
    const codec = format === 'wav' ? ['-c:a', depth === '24' ? 'pcm_s24le' : 'pcm_s16le']
      : format === 'flac' ? ['-c:a', 'flac', '-compression_level', '8', ...(depth === '24' ? ['-sample_fmt', 's32', '-bits_per_raw_sample', '24'] : [])]
        : encodeArgs(src, format).filter((a) => a !== '-vn');
    // loudnorm resamples to 192 kHz internally, so a filtered file always gets a standard rate.
    const ar = rate !== 'source' ? ['-ar', rate] : af.length ? ['-ar', '48000'] : [];
    const base = path.parse(src).name;
    const file = (label, chain, extra = []) => produce(id, outPath(src, outDir, base + label, format),
      [['-i', src, '-filter_complex', `${input}${chain ? `,${chain}` : ''}${af.length ? `,${af.join(',')}` : ''}[a]`, '-map', '[a]', '-vn', ...codec, ...ar, ...extra, '-map_metadata', '0']],
      onProgress, info.duration);
    if (channels === 'split') { // e.g. lav mic on channel 1, camera mic on channel 2
      const left = await file(' L', 'pan=mono|c0=c0');
      await file(' R', 'pan=mono|c0=c1');
      return left;
    }
    return file('', '', channels === 'mono' ? ['-ac', '1'] : []);
  });
}

module.exports = { aiRequested, convert, encode, trim, extract, strip, probe, detectGpu, encoders, setEncoder, settingsFor, buildArgs, PRESETS, ADVANCED, kindOf, TARGETS, AUDIO_OUT, cancel, killAll, FFMPEG,
  // building blocks for the other engines (compress.js, silence.js, gif.js, inspect.js)
  run, produce, withJob, alive, outPath, remove, encodeArgs, ext, collect, json, FFPROBE, TONEMAP };
