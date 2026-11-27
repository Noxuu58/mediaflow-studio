// GIF & animated WebP from a video passage. GIFs get a palette made for that very clip (palettegen) and an
// error-diffusion dither (paletteuse): 256 well-chosen colours, no grain, no banding.
const path = require('path');
const { probe, kindOf, withJob, alive, produce, outPath } = require('./convert');

const FPS = [10, 12, 15, 20, 24, 30];
const HEIGHTS = ['240', '360', '480', '720', 'source'];
const LENGTHS = [0, 3, 5, 10, 15, 30]; // seconds, 0 = to the end

function settings({ format = 'gif', fps = 15, height = '480', start = 0, length = 0, loop = true } = {}) {
  const s = { format, fps: Number(fps), height: String(height), start: Number(start) || 0, length: Number(length) || 0, loop: loop !== false && loop !== '0' };
  if (!['gif', 'webp'].includes(s.format) || !FPS.includes(s.fps) || !HEIGHTS.includes(s.height) || !LENGTHS.includes(s.length) || !(s.start >= 0)) throw new Error('UNSUPPORTED');
  return s;
}

// FFmpeg arguments (input included) for one clip; never upscales (min(target, source height)).
function gifArgs(src, s) {
  const seek = [...(s.start > 0 ? ['-ss', String(s.start)] : []), ...(s.length > 0 ? ['-t', String(s.length)] : [])];
  const scale = s.height === 'source' ? '' : `scale=-2:'min(${s.height},ih)':flags=lanczos,`;
  if (s.format === 'gif') {
    return [...seek, '-i', src, '-filter_complex',
      `[0:v]fps=${s.fps},${scale}split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
      '-loop', s.loop ? '0' : '-1', '-an'];
  }
  return [...seek, '-i', src, '-vf', `fps=${s.fps},${scale}format=yuva420p`, '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', '82',
    '-compression_level', '5', '-loop', s.loop ? '0' : '1', '-an'];
}

const stamp = (t) => `${Math.floor(t / 60)}m${String(Math.floor(t % 60)).padStart(2, '0')}s`;

function makeGif(src, opts, outDir, onProgress = () => {}, id) {
  if (kindOf(src) !== 'video') return Promise.reject(new Error('UNSUPPORTED'));
  const s = settings(opts);
  return withJob(id, async (job) => {
    const info = await probe(src, { thumb: false });
    alive(job);
    if (!info.video) throw new Error('UNSUPPORTED');
    if (info.duration && s.start >= info.duration) throw new Error('BAD_RANGE');
    const total = s.length || Math.max(0.1, info.duration - s.start);
    const name = `${path.parse(src).name}${s.start || s.length ? ` ${stamp(s.start)}` : ''}`;
    return produce(id, outPath(src, outDir, name, s.format), [gifArgs(src, s)], onProgress, total);
  });
}

module.exports = { makeGif, gifArgs, settings, FPS, HEIGHTS, LENGTHS };
