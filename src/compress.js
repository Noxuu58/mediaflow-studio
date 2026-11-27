// Target-size compressor: a video that fits a size limit (Discord, e-mail…), as sharp as that size allows.
// The bitrate comes from the duration and the target; two libx264 passes spend it where the picture needs it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { probe, kindOf, run, withJob, alive, outPath, remove, TONEMAP } = require('./convert');

const MB = 1e6; // sites count in MB or MiB: 10^6 bytes is the smaller of the two, so the file fits either way
const OVERHEAD = 0.97; // MP4 headers and index
const MIN_VIDEO = 80; // kb/s: below this a video is only blocks
// Fewer lines when the bitrate is low: a sharp 480p beats a blocky 1080p. [below N kb/s of video, at most H lines]
const HEIGHTS = [[400, 360], [900, 480], [2000, 720], [5000, 1080]];

// { video, audio } in kb/s and the height to scale to (null = keep). TOO_SMALL:<MB> when the target can't hold
// the video, with the smallest size that can.
function plan(info, targetMB) {
  const duration = Number(info.duration);
  if (!(duration > 0) || !info.video) throw new Error('UNSUPPORTED');
  if (!(targetMB >= 1 && targetMB <= 4000)) throw new Error('BAD_SIZE');
  const total = (targetMB * MB * 8 * OVERHEAD) / duration / 1000;
  const audio = !info.audios?.length ? 0 : total >= 1000 ? 128 : total >= 400 ? 96 : 64;
  if (total - audio < MIN_VIDEO) throw new Error(`TOO_SMALL:${Math.ceil(((MIN_VIDEO + audio) * 1000 * duration) / 8 / MB / OVERHEAD)}`);
  // Never more than the source already uses: a file that fits keeps its quality and does not grow.
  const video = Math.floor(Math.min(total - audio, info.bitrate > 0 ? Math.max(MIN_VIDEO, info.bitrate / 1000) : Infinity));
  const v = info.video;
  const srcH = Math.abs(v.rotation || 0) % 180 === 90 ? v.width : v.height;
  const max = HEIGHTS.find(([kb]) => video < kb)?.[1];
  return { video, audio, height: max && srcH > max ? max : null, duration };
}

function compress(src, { size } = {}, outDir, onProgress = () => {}, id) {
  if (kindOf(src) !== 'video') return Promise.reject(new Error('UNSUPPORTED'));
  const targetMB = Number(size);
  return withJob(id, async (job) => {
    const info = await probe(src, { thumb: false });
    alive(job);
    let p = plan(info, targetMB);
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mediaflow-'));
    const out = outPath(src, outDir, `${path.parse(src).name} ${+targetMB.toFixed(2)}MB`, 'mp4');
    try {
      for (let attempt = 0; ; attempt++) {
        const vf = [info.video.hdr && TONEMAP, p.height && `scale=-2:${p.height}:flags=lanczos`, 'format=yuv420p'].filter(Boolean).join(',');
        const video = ['-map', '0:v:0', '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${p.video}k`, '-passlogfile', path.join(tmp, 'pass')];
        const audio = p.audio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', `${p.audio}k`, '-ac', '2'] : ['-an'];
        // Pass 1 measures where the detail is; pass 2 spends the bitrate there.
        await run(['-i', src, ...video, '-pass', '1', '-an', '-f', 'null', '-'], (x) => onProgress(x * 0.45), info.duration, job);
        await run(['-i', src, ...video, '-pass', '2', ...audio, '-map_metadata', '0', '-movflags', '+faststart', out], (x) => onProgress(0.45 + x * 0.55), info.duration, job);
        const bytes = (await fs.promises.stat(out)).size;
        if (bytes <= targetMB * MB) break;
        // Rare (very short or very noisy clips): aim lower by the amount it went over, twice at most.
        if (attempt === 2) throw new Error(`TOO_SMALL:${Math.ceil(bytes / MB)}`);
        p = { ...p, video: Math.floor(p.video * (targetMB * MB / bytes) * 0.97) };
        if (p.video < MIN_VIDEO) throw new Error(`TOO_SMALL:${Math.ceil(bytes / MB)}`);
      }
      onProgress(1);
      return out;
    } catch (e) {
      await remove(out);
      throw job.aborted ? new Error('CANCELLED') : e;
    } finally { await remove(tmp); }
  });
}

module.exports = { compress, plan, MB };
