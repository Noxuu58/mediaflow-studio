// AI Video Enhancement — Real-ESRGAN upscaling + RIFE frame interpolation (ncnn, Vulkan: NVIDIA / AMD / Intel).
// The video is processed in chunks of CHUNK frames so disk use stays bounded even in 4K:
//   extract PNG frames → Real-ESRGAN (Upscaling, or a larger target) → RIFE (if the target fps is higher)
//   → encode the chunk (GPU encoder when available) → delete the frames.
// Chunks are concatenated, the source audio is copied, and the result feeds the normal preset encode.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AI_DIR = [process.resourcesPath && path.join(process.resourcesPath, 'ai'), path.join(__dirname, '..', 'vendor', 'ai')]
  .find((p) => p && fs.existsSync(path.join(p, 'realesrgan', 'realesrgan-ncnn-vulkan.exe')));
const ESRGAN = AI_DIR && path.join(AI_DIR, 'realesrgan', 'realesrgan-ncnn-vulkan.exe');
const RIFE = AI_DIR && path.join(AI_DIR, 'rife', 'rife-ncnn-vulkan.exe');
const CHUNK = 48;
const available = () => Boolean(ESRGAN && RIFE && fs.existsSync(RIFE));
const SYS32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const hasVulkan = () => fs.existsSync(path.join(SYS32, 'vulkan-1.dll')); // the loader every Vulkan driver installs

// Which Vulkan GPU runs the AI: 'auto' (ncnn picks, dedicated card first) or a device index from devices().
let gpuId = 'auto';
const setGpu = (id) => { gpuId = /^\d{1,2}$/.test(String(id)) ? String(id) : 'auto'; };
const gpuArgs = () => (gpuId === 'auto' ? [] : ['-g', gpuId]);

// What has to happen for a source → target change. Lower frame rates are a plain frame drop (no AI).
// Resolution: with restore (the Upscaling preset) the AI always runs, even when the target is not larger than the
// source: frames go to the AI at the target size (or half of it for the ×4-only "quality" model), come out ×2 larger
// with the detail rebuilt and the compression noise gone, then are scaled back down to the target. Without restore,
// a lower target is a plain downscale.
function plan(info, { height = 'source', fps = 'source', model = 'fast', restore = false } = {}) {
  const v = info.video;
  const turned = Math.abs(v.rotation || 0) % 180 === 90;
  const srcH = turned ? v.width : v.height;
  const srcFps = v.baseFps || v.fps;
  const targetH = height === 'source' ? srcH : Number(height);
  const targetFps = fps === 'source' ? srcFps : Number(fps);
  const bigger = targetH > srcH;
  const upscale = bigger || restore;
  const ratio = targetFps / srcFps;
  const mult = ratio > 1.01 ? Math.ceil(ratio - 1e-6) : 1; // RIFE makes ×mult, ffmpeg then resamples to the exact target
  const scale = !upscale ? 1 : model === 'quality' ? 4 : bigger ? Math.min(4, Math.max(2, Math.ceil(targetH / srcH - 1e-6))) : 2;
  // Height the frames are brought to before the AI (null = as they are): the AI then works at 2× the target.
  const inH = upscale && !bigger ? Math.max(2, Math.round((targetH * 2) / scale / 2) * 2) : null;
  const outH = upscale ? (inH || srcH) * scale : srcH;
  return { srcH, srcFps, targetH, targetFps, upscale, scale, inH, outH, mult, model, ai: upscale || mult > 1 };
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
      reject(Object.assign(new Error(line), { log: err }));
    });
  });
}

const frames = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : []);
const fresh = (dir) => { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); };

// Vulkan driver errors → short codes the UI explains (see err.AI_* in i18n.js).
function aiError(e) {
  const m = `${e.message} ${e.log || ''}`;
  if (/invalid gpu device/i.test(m)) return new Error('AI_GPU_GONE');
  if (/out of (device |host )?memory|OUT_OF_(DEVICE|HOST)_MEMORY|vkAllocateMemory failed/i.test(m)) return new Error('AI_VRAM');
  if (/DEVICE_LOST|vkQueueSubmit failed|vkWaitForFences failed/i.test(m)) return new Error('AI_GPU_LOST');
  if (/vkCreateInstance failed|no vulkan device|vulkan-1\.dll/i.test(m)) return new Error('AI_NO_GPU');
  return e;
}

const tinyPng = (job, FFMPEG, file) => run(job, FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=gray:s=32x32', '-frames:v', '1', file]);
const esrganTest = (job, tmp, extra) => run(job, ESRGAN, ['-i', path.join(tmp, 'a.png'), '-o', path.join(tmp, 'b.png'), '-n', 'realesr-animevideov3', '-s', '2', '-m', path.join(path.dirname(ESRGAN), 'models'), ...extra]);
const listed = (log) => [...new Map([...String(log).matchAll(/^\[(\d+) ([^\]]+)\]/gm)].map((m) => [m[1], m[2].trim()]))].map(([id, name]) => ({ id, name }));

// Versions from vulkaninfo (installed with the GPU driver on Windows). null when it isn't there.
function vulkanInfo() {
  const bin = path.join(SYS32, 'vulkaninfo.exe');
  if (!fs.existsSync(bin)) return Promise.resolve(null);
  return new Promise((resolve) => execFile(bin, ['--summary'], { windowsHide: true, timeout: 10000 }, (_e, out = '') => {
    const gpus = String(out).split(/^GPU\d+:/m).slice(1).map((b) => ({
      name: /deviceName\s*=\s*(.+)/.exec(b)?.[1].trim(), api: /apiVersion\s*=\s*([\d.]+)/.exec(b)?.[1],
      type: /deviceType\s*=\s*PHYSICAL_DEVICE_TYPE_(\w+)/.exec(b)?.[1].toLowerCase(), driver: /driverInfo\s*=\s*(.+)/.exec(b)?.[1].trim(),
    }));
    resolve({ version: /Vulkan Instance Version:\s*([\d.]+)/.exec(out)?.[1] || null, gpus });
  }));
}

// Every Vulkan GPU the AI engines can use (id = ncnn's -g index), with versions when known. Cached; fresh = re-scan.
let devCache;
function devices(FFMPEG, fresh = false) {
  if (fresh) devCache = null;
  return (devCache ||= (async () => {
    const out = { engines: available(), vulkan: hasVulkan(), version: null, devices: [] };
    if (!out.engines || !out.vulkan) return out;
    const job = { aborted: false, procs: new Set() };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediaflow-ai-'));
    try {
      await tinyPng(job, FFMPEG, path.join(tmp, 'a.png'));
      // An out-of-range -g makes ncnn list every device, then stop before doing any work.
      const log = await esrganTest(job, tmp, ['-g', '99']).catch((e) => e.log || '');
      const vk = await vulkanInfo();
      out.version = vk?.version || null;
      const left = [...(vk?.gpus || [])];
      out.devices = listed(log).map((d) => {
        const i = left.findIndex((g) => g.name === d.name);
        const g = i >= 0 ? left.splice(i, 1)[0] : {};
        return { ...d, api: g.api || null, type: g.type || null, driver: g.driver || null };
      });
    } catch {} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    return out;
  })());
}

// Can the chosen GPU run the AI? A real 32×32 upscale (≈1 s), cached per GPU; fresh = test again.
// { available, gpu: name, id, reason } — reason: ENGINES | NO_VULKAN | NO_GPU | GPU_GONE | FAILED.
const checks = new Map();
function detect(FFMPEG, fresh = false) {
  const id = gpuId;
  if (fresh) checks.delete(id);
  if (!checks.has(id)) checks.set(id, (async () => {
    if (!available()) return { available: false, reason: 'ENGINES' };
    if (!hasVulkan()) return { available: false, reason: 'NO_VULKAN' };
    const job = { aborted: false, procs: new Set() };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediaflow-ai-'));
    let log = '';
    try {
      await tinyPng(job, FFMPEG, path.join(tmp, 'a.png'));
      log = await esrganTest(job, tmp, gpuArgs()).catch((e) => e.log || e.message);
      const devs = listed(log);
      const name = (devs.find((d) => d.id === id) || devs[0])?.name || null;
      if (fs.existsSync(path.join(tmp, 'b.png'))) return { available: true, gpu: name, id };
      if (/invalid gpu device/i.test(log)) return { available: false, reason: 'GPU_GONE', id };
      return { available: false, reason: devs.length ? 'FAILED' : 'NO_GPU', gpu: name, id };
    } catch { return { available: false, reason: 'FAILED', id }; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  return checks.get(id);
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
        '-map', '0:v:0', '-frames:v', String(take), '-fps_mode', 'passthrough', ...(p.inH ? ['-vf', `scale=-2:${p.inH}:flags=lanczos`] : []), path.join(dir('in'), '%08d.png')]);
      done('extract');
      let cur = dir('in');
      const count = frames(cur).length;
      if (!count) break;
      if (p.upscale) {
        const model = p.model === 'quality' ? 'realesrgan-x4plus' : 'realesr-animevideov3';
        await run(job, ESRGAN, ['-i', cur, '-o', dir('up'), '-n', model, '-s', String(p.scale), '-m', path.join(path.dirname(ESRGAN), 'models'), '-f', 'png', ...gpuArgs()],
          (out) => { const m = /(\d+(?:\.\d+)?)%/.exec(out); if (m) done('upscale', Math.min(1, ((frames(dir('up')).length) + Number(m[1]) / 100) / count)); });
        cur = dir('up');
        done('upscale');
      }
      if (p.mult > 1) {
        const keep = (last ? count : count - 1) * p.mult; // drop what belongs to the next chunk
        const uhd = p.outH >= 1440;
        await run(job, RIFE, ['-i', cur, '-o', dir('mid'), '-m', path.join(path.dirname(RIFE), 'rife-v4.6'), '-n', String(count * p.mult), ...(uhd ? ['-u'] : []), ...gpuArgs()]);
        frames(dir('mid')).slice(keep).forEach((f) => fs.rmSync(path.join(dir('mid'), f)));
        cur = dir('mid');
        done('interpolate');
      }
      // Width to a multiple of 8 (854×480 → 1920×1080, not 1922): standard sizes, happier hardware encoders.
      const vf = p.outH !== p.targetH && p.upscale ? ['-vf', `scale=-8:${p.targetH}:flags=lanczos`] : [];
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
    throw aiError(e);
  }
}

// Photo / image upscaling: one Real-ESRGAN pass, then an exact ×scale resize (the "Best quality" model is ×4 only).
// Returns { file, tmp }: a PNG at the final size (alpha kept) and the folder to delete. MAX_SIDE keeps the result
// openable everywhere (WebP stops at 16383 px) and within reach of the GPU.
const MAX_SIDE = 16383;
async function upscaleImage(src, { width, height }, { scale = 4, model = 'fast' }, { FFMPEG, job, onProgress = () => {} }) {
  if (Math.max(width, height) * scale > MAX_SIDE) throw new Error(`IMAGE_TOO_BIG:${MAX_SIDE}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediaflow-ai-'));
  const f = (n) => path.join(tmp, n);
  try {
    // Any source (JPEG, WebP, 16-bit / palette PNG…) → plain 8-bit PNG, alpha kept, for the AI engine.
    await run(job, FFMPEG, ['-v', 'error', '-i', src, '-frames:v', '1', '-pix_fmt', 'rgba', f('in.png')]);
    const s = model === 'quality' ? 4 : scale;
    await run(job, ESRGAN, ['-i', f('in.png'), '-o', f('up.png'), '-n', model === 'quality' ? 'realesrgan-x4plus' : 'realesr-animevideov3',
      '-s', String(s), '-m', path.join(path.dirname(ESRGAN), 'models'), '-f', 'png', ...gpuArgs()],
    (out) => { const m = /(\d+(?:\.\d+)?)%/.exec(out); if (m) onProgress(Math.min(0.95, Number(m[1]) / 100)); });
    if (s === scale) return { file: f('up.png'), tmp };
    await run(job, FFMPEG, ['-v', 'error', '-i', f('up.png'), '-vf', `scale=${width * scale}:${height * scale}:flags=lanczos`, f('out.png')]);
    return { file: f('out.png'), tmp };
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    throw aiError(e);
  }
}

module.exports = { plan, enhance, upscaleImage, MAX_SIDE, detect, devices, setGpu, available, hasVulkan, aiError, CHUNK };
