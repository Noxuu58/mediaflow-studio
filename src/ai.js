// AI Video Enhancement — Real-ESRGAN upscaling + RIFE frame interpolation (ncnn, Vulkan: NVIDIA / AMD / Intel).
// The video is processed in chunks of CHUNK frames so disk use stays bounded even in 4K:
//   extract PNG frames → Real-ESRGAN (if the target is larger) → RIFE (if the target fps is higher)
//   → encode the chunk (GPU encoder when available) → delete the frames.
// Chunks are concatenated, the source audio is copied, and the result feeds the normal preset encode.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AI_DIR = [process.resourcesPath && path.join(process.resourcesPath, 'ai'), path.join(__dirname, '..', 'vendor', 'ai')]
  .find((p) => p && fs.existsSync(path.join(p, 'realesrgan', 'realesrgan-ncnn-vulkan.exe')));
const ESRGAN = AI_DIR && path.join(AI_DIR, 'realesrgan', 'realesrgan-ncnn-vulkan.exe');
const RIFE = AI_DIR && path.join(AI_DIR, 'rife', 'rife-ncnn-vulkan.exe');
const CHUNK = 48;
const available = () => Boolean(ESRGAN && RIFE && fs.existsSync(RIFE));

// What has to happen for a source → target change. Lower targets are plain downscale / frame drop (no AI).
function plan(info, { height = 'source', fps = 'source', model = 'fast' } = {}) {
  const v = info.video;
  const turned = Math.abs(v.rotation || 0) % 180 === 90;
  const srcH = turned ? v.width : v.height;
  const srcFps = v.baseFps || v.fps;
  const targetH = height === 'source' ? srcH : Number(height);
  const targetFps = fps === 'source' ? srcFps : Number(fps);
  const upscale = targetH > srcH;
  const ratio = targetFps / srcFps;
  const mult = ratio > 1.01 ? Math.ceil(ratio - 1e-6) : 1; // RIFE makes ×mult, ffmpeg then resamples to the exact target
  const scale = !upscale ? 1 : model === 'quality' ? 4 : Math.min(4, Math.max(2, Math.ceil(targetH / srcH - 1e-6)));
  return { srcH, srcFps, targetH, targetFps, upscale, scale, mult, model, ai: upscale || mult > 1 };
}

// Spawns a tracked process (cancel kills it). Rejects with its last error line, or CANCELLED.
function run(job, bin, args, onOutput) {
  return new Promise((resolve, reject) => {
    if (job.aborted) return reject(new Error('CANCELLED'));
    const p = spawn(bin, args, { windowsHide: true, cwd: path.dirname(bin) });
    job.procs.add(p);
    let err = '';
    const collect = (d) => { err = (err + d).slice(-4000); onOutput?.(String(d)); };
    p.stdout.on('data', collect);
    p.stderr.on('data', collect);
    p.on('error', (e) => { job.procs.delete(p); reject(e); });
    p.on('close', (code) => {
      job.procs.delete(p);
      if (job.aborted) return reject(new Error('CANCELLED'));
      if (code === 0) return resolve(err);
      const line = err.trim().split(/\r?\n/).filter((l) => l && !/^\d+\.\d+%$/.test(l.trim())).pop() || `code ${code}`;
      reject(new Error(line));
    });
  });
}

const frames = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : []);
const fresh = (dir) => { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); };

// Which GPU ncnn/Vulkan will use (name printed by Real-ESRGAN on start), cached. null = no usable GPU.
let gpuInfo;
function detect(FFMPEG) {
  return (gpuInfo ||= (async () => {
    if (!available()) return { available: false };
    const job = { aborted: false, procs: new Set() };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediaflow-ai-'));
    try {
      await run(job, FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=gray:s=32x32', '-frames:v', '1', path.join(tmp, 'a.png')]);
      const log = await run(job, ESRGAN, ['-i', path.join(tmp, 'a.png'), '-o', path.join(tmp, 'b.png'), '-n', 'realesr-animevideov3', '-s', '2', '-m', path.join(path.dirname(ESRGAN), 'models')]);
      const name = /\[0 ([^\]]+)\]/.exec(log)?.[1]?.trim();
      return { available: fs.existsSync(path.join(tmp, 'b.png')), gpu: name || null };
    } catch { return { available: false }; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
}

// Lossless-looking intermediate encode for a chunk (GPU when possible); the preset encode comes after.
function chunkEncoder(gpu) {
  if (gpu?.h264 === 'h264_nvenc') return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'constqp', '-qp', '14'];
  if (gpu?.h264 === 'h264_qsv') return ['-c:v', 'h264_qsv', '-global_quality', '16'];
  if (gpu?.h264 === 'h264_amf') return ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', '14', '-qp_p', '14'];
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12'];
}

// Runs the AI stage. Returns { file, tmp } — the enhanced video (with the source audio) and the folder to delete.
// onProgress(fraction 0..1, stage) with stage in 'prepare' | 'upscale' | 'interpolate' | 'encode'.
async function enhance(src, info, p, { FFMPEG, job, gpu, tonemap, onProgress = () => {} }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediaflow-ai-'));
  try {
    const dir = (n) => path.join(tmp, n);
    let input = src;
    // Frame-exact chunks need a constant frame rate, and the AI models work on 8-bit SDR frames:
    // VFR and HDR sources get a quick preparation pass first (HDR is tone-mapped to BT.709).
    if (info.video.vfr || info.video.hdr) {
      onProgress(0, 'prepare');
      const vf = [info.video.hdr && tonemap, info.video.vfr && `fps=${p.srcFps}`, 'format=yuv420p'].filter(Boolean).join(',');
      await run(job, FFMPEG, ['-v', 'error', '-i', src, '-map', '0:v:0', '-vf', vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-an', dir('prep.mkv')]);
      input = dir('prep.mkv');
    }
    const total = Math.max(1, Math.round(info.duration * p.srcFps));
    const chunks = Math.ceil(total / CHUNK);
    const outFps = +(p.srcFps * p.mult).toFixed(3);
    const weights = { extract: 0.08, upscale: p.upscale ? 0.62 : 0, interpolate: p.mult > 1 ? 0.22 : 0, encode: 0.08 };
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    const list = [];
    for (let k = 0; k < chunks; k++) {
      const done = (stage, frac = 1) => {
        const order = ['extract', 'upscale', 'interpolate', 'encode'];
        const before = order.slice(0, order.indexOf(stage)).reduce((a, s) => a + weights[s], 0);
        onProgress((k + (before + weights[stage] * frac) / sum) / chunks, stage === 'extract' ? 'prepare' : stage);
      };
      const s = k * CHUNK;
      const last = k === chunks - 1;
      // RIFE needs the next chunk's first frame to interpolate across the boundary: take one extra frame.
      const take = Math.min(total - s, CHUNK) + (!last && p.mult > 1 ? 1 : 0);
      ['in', 'up', 'mid'].forEach((d) => fresh(dir(d)));
      // -ss half a frame early keeps frame s and drops s-1 (accurate seek), without depending on float rounding.
      await run(job, FFMPEG, ['-v', 'error', ...(s ? ['-ss', ((s - 0.5) / p.srcFps).toFixed(6)] : []), '-i', input,
        '-map', '0:v:0', '-frames:v', String(take), '-fps_mode', 'passthrough', path.join(dir('in'), '%08d.png')]);
      done('extract');
      let cur = dir('in');
      const count = frames(cur).length;
      if (!count) break;
      if (p.upscale) {
        const model = p.model === 'quality' ? 'realesrgan-x4plus' : 'realesr-animevideov3';
        await run(job, ESRGAN, ['-i', cur, '-o', dir('up'), '-n', model, '-s', String(p.scale), '-m', path.join(path.dirname(ESRGAN), 'models'), '-f', 'png'],
          (out) => { const m = /(\d+(?:\.\d+)?)%/.exec(out); if (m) done('upscale', Math.min(1, ((frames(dir('up')).length) + Number(m[1]) / 100) / count)); });
        cur = dir('up');
        done('upscale');
      }
      if (p.mult > 1) {
        const keep = (last ? count : count - 1) * p.mult; // drop what belongs to the next chunk
        const uhd = p.upscale ? p.srcH * p.scale >= 1440 : p.srcH >= 1440;
        await run(job, RIFE, ['-i', cur, '-o', dir('mid'), '-m', path.join(path.dirname(RIFE), 'rife-v4.6'), '-n', String(count * p.mult), ...(uhd ? ['-u'] : [])]);
        frames(dir('mid')).slice(keep).forEach((f) => fs.rmSync(path.join(dir('mid'), f)));
        cur = dir('mid');
        done('interpolate');
      }
      const outH = p.upscale ? p.srcH * p.scale : p.srcH;
      // Width to a multiple of 8 (854×480 → 1920×1080, not 1922): standard sizes, happier hardware encoders.
      const vf = outH !== p.targetH && p.upscale ? ['-vf', `scale=-8:${p.targetH}:flags=lanczos`] : [];
      const chunk = dir(`chunk${String(k).padStart(5, '0')}.mp4`);
      const encode = (enc) => run(job, FFMPEG, ['-v', 'error', '-framerate', String(outFps), '-i', path.join(cur, '%08d.png'), ...vf, ...enc, '-pix_fmt', 'yuv420p', chunk]);
      try { await encode(chunkEncoder(gpu)); } catch (e) {
        if (job.aborted || !gpu) throw e;
        await encode(chunkEncoder(null)); // driver refused (size, format): CPU
      }
      list.push(chunk);
      done('encode');
    }
    ['in', 'up', 'mid'].forEach((d) => fs.rmSync(dir(d), { recursive: true, force: true }));
    fs.writeFileSync(dir('list.txt'), list.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    await run(job, FFMPEG, ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', dir('list.txt'), '-i', src,
      '-map', '0:v:0', '-map', '1:a?', '-c', 'copy', dir('enhanced.mkv')]);
    onProgress(1, 'encode');
    return { file: dir('enhanced.mkv'), tmp };
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    throw e;
  }
}

module.exports = { plan, enhance, detect, available, CHUNK };
