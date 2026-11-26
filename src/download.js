const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FFMPEG } = require('./convert');

// Which yt-dlp to run is decided by main.js (bundled copy, user's choice, or PATH).
let YTDLP = 'yt-dlp';
const setBinary = (p) => { YTDLP = p || 'yt-dlp'; };
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
// YouTube needs a JavaScript runtime. Electron's own executable is one (Node) when ELECTRON_RUN_AS_NODE is set,
// so users don't have to install Deno or Node.
let RUNTIME = [];
function setRuntime(execPath) {
  RUNTIME = ['--no-js-runtimes', '--js-runtimes', `node:${execPath}`];
  ENV.ELECTRON_RUN_AS_NODE = '1';
}

// Always first on the command line: a yt-dlp.conf in the output folder, %APPDATA% or next to the exe never applies.
const SAFE = ['--ignore-config'];
// Title + id: two videos with the same title never overwrite each other.
const OUTPUT = '%(title).140B [%(id)s].%(ext)s';

const VIDEO = ['mp4', 'mov', 'mkv'];
const AUDIO = ['mp3', 'm4a', 'wav', 'flac', 'opus'];

function exec(args, timeout = 120000) {
  return new Promise((resolve, reject) => execFile(YTDLP, [...SAFE, ...args], { env: ENV, windowsHide: true, timeout, maxBuffer: 64 << 20 },
    (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
}
const errorLine = (text, fallback) =>
  (String(text).split(/\r?\n/).filter((l) => l.startsWith('ERROR:')).pop() || fallback).replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '');

const version = () => exec(['--version'], 15000).then((v) => v.trim()).catch(() => null);
const update = () => exec(['-U'], 180000).then((o) => o.trim().split(/\r?\n/).pop(), (e) => { throw new Error(errorLine(e.stderr, e.message)); });

async function analyze(url) {
  let json;
  // --flat-playlist: a playlist link lists its videos at once instead of reading every one of them (minutes).
  try { json = JSON.parse(await exec([...RUNTIME, '-J', '--no-playlist', '--flat-playlist', '--no-warnings', '--', url])); } // `--`: a pasted "-x…" is never read as an option
  catch (e) { throw new Error(errorLine(e.stderr, 'UNREADABLE')); }
  return toInfo(json, url);
}

const MAX_ENTRIES = 1000;
const thumbOf = (j) => j.thumbnail || j.thumbnails?.at(-1)?.url || null;
// yt-dlp's JSON → what the window shows. A playlist lists its videos (links that yt-dlp can download one by one).
function toInfo(json, url) {
  if (json._type === 'playlist') {
    const entries = (json.entries || []).map((e) => ({ url: e.url || e.webpage_url, title: e.title || e.id || '', duration: e.duration || 0, thumbnail: thumbOf(e) }))
      .filter((e) => /^https?:\/\//i.test(e.url || '')).slice(0, MAX_ENTRIES);
    if (!entries.length) throw new Error('UNREADABLE');
    return {
      playlist: true, url: json.webpage_url || url, title: json.title || 'Playlist', uploader: json.uploader || json.channel || '',
      site: (json.extractor_key || '').replace(/Tab$/, ''), thumbnail: thumbOf(json) || entries.find((e) => e.thumbnail)?.thumbnail || null,
      hasVideo: true, heights: [], duration: entries.reduce((a, e) => a + e.duration, 0), entries,
    };
  }
  const video = (json.formats || []).filter((f) => f.vcodec && f.vcodec !== 'none' && f.height);
  return {
    url: json.webpage_url || url,
    title: json.title || 'Sans titre',
    uploader: json.uploader || json.channel || '',
    site: json.extractor_key || '',
    duration: json.duration || 0,
    thumbnail: json.thumbnail || null,
    hasVideo: video.length > 0 || json.vcodec && json.vcodec !== 'none',
    heights: [...new Set(video.map((f) => f.height))].sort((a, b) => b - a),
  };
}

function formatArgs(fmt, quality) {
  if (VIDEO.includes(fmt)) {
    const res = quality === 'best' ? 'res' : `res:${quality}`;
    // Editors want H.264/AAC: prefer them at equal resolution, except in MKV which takes anything.
    return ['-f', 'bv*+ba/b', '-S', fmt === 'mkv' ? res : `${res},vcodec:h264,acodec:aac`,
      '--merge-output-format', fmt, '--remux-video', fmt];
  }
  if (AUDIO.includes(fmt)) {
    return ['-f', 'ba/b', '-x', '--audio-format', fmt, '--audio-quality', quality === 'best' ? '0' : `${quality}K`,
      ...(fmt === 'mp3' || fmt === 'm4a' ? ['--embed-thumbnail'] : [])];
  }
  throw new Error('UNSUPPORTED');
}

// Only a part of the video: yt-dlp downloads just that range (frame-accurate for video: cut points get keyframes).
// The file name says which part, so two passages of one video never collide. Seconds in, BAD_RANGE when invalid.
const stamp = (s) => `${Math.floor(s / 60)}m${(s % 60).toFixed(1).padStart(4, '0')}s`;
function sectionArgs(fmt, section) {
  if (!section) return { args: [], output: OUTPUT };
  const start = Number(section.start), end = Number(section.end);
  if (!(start >= 0 && end > start && Number.isFinite(end))) throw new Error('BAD_RANGE');
  return {
    args: ['--download-sections', `*${start}-${end}`, ...(VIDEO.includes(fmt) ? ['--force-keyframes-at-cuts'] : [])],
    output: OUTPUT.replace('.%(ext)s', ` ${stamp(start)}-${stamp(end)}.%(ext)s`),
  };
}

const running = new Map(); // id -> child
function cancel(id) {
  for (const [k, p] of running) if (id == null || k === id) {
    p.cancelled = true;
    execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {}); // also kills yt-dlp's ffmpeg children
  }
}

// YouTube intermittently answers 403 on media URLs; a fresh attempt gets new URLs and usually succeeds.
async function download(...args) {
  try { return await attempt(...args); } catch (e) {
    if (/HTTP Error 403/.test(e.message)) return attempt(...args);
    throw e;
  }
}

function attempt(id, url, { fmt, quality = 'best', outDir, section }, onProgress = () => {}) {
  const part = sectionArgs(fmt, section);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediaflow-'));
  // Killed processes release file handles a moment after exiting: retry, and never let cleanup fail the job.
  const cleanup = () => fs.promises.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  const outFile = path.join(tmp, 'out.txt');
  const args = [...SAFE, ...RUNTIME, ...formatArgs(fmt, quality), ...part.args, '--embed-metadata', '--no-playlist', '--newline', '--no-colors',
    '--ffmpeg-location', FFMPEG, '-P', outDir, '-P', `temp:${tmp}`, '-o', part.output,
    '--progress-template', 'download:MFP %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
    '--print-to-file', 'after_move:filepath', outFile, '--', url];
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, args, { env: ENV, windowsHide: true });
    running.set(id, p);
    let streams = 1, stream = -1, err = '', buf = '';
    const weight = () => (streams > 1 ? [0.85, 0.15] : [1]); // video stream dominates the download time
    p.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const line of lines) {
        let m;
        if ((m = /Downloading \d+ format\(s\): (\S+)/.exec(line))) streams = m[1].split('+').length;
        else if (line.startsWith('[download] Destination:')) stream++;
        else if ((m = /^MFP (\S+) (\S+) (\S+) (\S+) (\S+)/.exec(line))) {
          const [done, total, est, speed, eta] = m.slice(1).map(Number);
          const frac = Math.min(1, done / (total || est || Infinity) || 0);
          const w = weight(), i = Math.max(0, Math.min(stream, w.length - 1));
          onProgress({ stage: 'download', p: w.slice(0, i).reduce((a, b) => a + b, 0) + w[i] * frac, speed: speed || 0, eta: Number.isFinite(eta) ? eta : null });
        } else if (/^\[(Merger|ExtractAudio|VideoRemuxer|EmbedThumbnail|Metadata|FixupM3u8)\]/.test(line)) onProgress({ stage: 'post', p: 1 });
      }
    });
    p.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
    p.on('error', async (e) => { running.delete(id); await cleanup(); reject(e.code === 'ENOENT' ? new Error('YTDLP_MISSING') : e); });
    p.on('close', async (code) => {
      running.delete(id);
      const out = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').trim().split(/\r?\n/).pop() : null;
      await cleanup();
      if (p.cancelled) return reject(new Error('CANCELLED'));
      if (code === 0 && out) return resolve(out);
      reject(new Error(errorLine(err, `YTDLP_FAILED:${code}`)));
    });
  });
}

module.exports = { analyze, download, cancel, version, update, setBinary, setRuntime, toInfo, sectionArgs, VIDEO, AUDIO, SAFE, OUTPUT };
