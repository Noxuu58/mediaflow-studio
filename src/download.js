const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FFMPEG } = require('./convert');

// yt-dlp is the user's own install (found on PATH) so it can be updated independently of this app.
let YTDLP = 'yt-dlp';
const setBinary = (p) => { YTDLP = p || 'yt-dlp'; };
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

const VIDEO = ['mp4', 'mov', 'mkv'];
const AUDIO = ['mp3', 'm4a', 'wav', 'flac', 'opus'];

function exec(args, timeout = 120000) {
  return new Promise((resolve, reject) => execFile(YTDLP, args, { env: ENV, windowsHide: true, timeout, maxBuffer: 64 << 20 },
    (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
}
const errorLine = (text, fallback) =>
  (String(text).split(/\r?\n/).filter((l) => l.startsWith('ERROR:')).pop() || fallback).replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '');

const version = () => exec(['--version'], 15000).then((v) => v.trim()).catch(() => null);
const update = () => exec(['-U'], 180000).then((o) => o.trim().split(/\r?\n/).pop(), (e) => { throw new Error(errorLine(e.stderr, e.message)); });

async function analyze(url) {
  let json;
  try { json = JSON.parse(await exec(['-J', '--no-playlist', '--no-warnings', '--', url])); } // `--`: a pasted "-x…" is never read as an option
  catch (e) { throw new Error(errorLine(e.stderr, 'UNREADABLE')); }
  // shortcut: playlists are refused, add per-entry download if needed.
  if (json._type === 'playlist') throw new Error(`PLAYLIST:${json.entries?.length ?? '?'}`);
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

function attempt(id, url, { fmt, quality = 'best', outDir }, onProgress = () => {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediaflow-'));
  // Killed processes release file handles a moment after exiting: retry, and never let cleanup fail the job.
  const cleanup = () => fs.promises.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  const outFile = path.join(tmp, 'out.txt');
  const args = [...formatArgs(fmt, quality), '--embed-metadata', '--no-playlist', '--newline', '--no-colors',
    '--ffmpeg-location', FFMPEG, '-P', outDir, '-P', `temp:${tmp}`, '-o', '%(title).150B.%(ext)s',
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

module.exports = { analyze, download, cancel, version, update, setBinary, VIDEO, AUDIO };
