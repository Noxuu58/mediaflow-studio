// GIF & animated WebP from a video passage, or from a still image brought to life with a looping motion
// (stickers). GIFs get a palette made for that very clip (palettegen) and an error-diffusion dither (paletteuse):
// 256 well-chosen colours, no grain, no banding; transparent images stay transparent.
const path = require('path');
const { probe, kindOf, withJob, alive, produce, outPath } = require('./convert');

const FPS = [10, 12, 15, 20, 24, 30];
const HEIGHTS = ['240', '320', '360', '480', '720', 'source']; // 320: sticker size (Discord, Telegram…)
const LENGTHS = [0, 3, 5, 10, 15, 30]; // seconds, 0 = to the end
// Still images: how the picture moves, over one loop of SECONDS. Each motion is periodic, so the loop never jumps.
const STYLES = ['bounce', 'float', 'pulse', 'sway', 'shake', 'spin', 'sparkle'];
const SECONDS = [1, 2, 3, 4, 6];

function settings({ format = 'gif', fps = 15, height = '480', start = 0, length = 0, loop = true, style = 'bounce', seconds = 2 } = {}) {
  const s = { format, fps: Number(fps), height: String(height), start: Number(start) || 0, length: Number(length) || 0, loop: loop !== false && loop !== '0',
    style: String(style), seconds: Number(seconds) };
  if (!['gif', 'webp'].includes(s.format) || !FPS.includes(s.fps) || !HEIGHTS.includes(s.height) || !LENGTHS.includes(s.length) || !(s.start >= 0)
    || !STYLES.includes(s.style) || !SECONDS.includes(s.seconds)) throw new Error('UNSUPPORTED');
  return s;
}

// The end of every filter graph: an optimised palette (transparency kept) for GIF, alpha-capable WebP otherwise.
const finish = (s) => (s.format === 'gif'
  ? { fc: ',split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a:alpha_threshold=128', args: ['-loop', s.loop ? '0' : '-1'] }
  : { fc: ',format=yuva420p', args: ['-c:v', 'libwebp_anim', '-lossless', '0', '-quality', '82', '-compression_level', '5', '-loop', s.loop ? '0' : '1'] });

// A still image → one seamless loop. The picture moves on a transparent canvas of its own size (never enlarged),
// scaled down a little where the motion needs room.
function stillArgs(src, s, { width, height }) {
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  const ch = even(s.height === 'source' ? height : Math.min(height, Number(s.height)));
  const cw = even((width * ch) / height);
  const P = s.seconds, r = s.fps, n = Math.round(P * r);
  const room = { bounce: 0.8, float: 0.86, pulse: 0.8, sway: 0.86, shake: 0.9, spin: (Math.min(cw, ch) / Math.hypot(cw, ch)) * 0.96, sparkle: 1 }[s.style];
  const obj = `[0:v]scale=${even(cw * room)}:${even(ch * room)}:flags=lanczos,format=rgba`;
  const center = 'x=(W-w)/2:y=(H-h)/2';
  const pad = 'pad=iw+8:ih+8:4:4:color=black@0'; // transparent border: rotated edges stay clean
  const big = Math.max(cw, ch), gw = even((64 * cw) / big), gh = even((64 * ch) / big); // sparkle grid: ~30 at a time
  const motion = {
    bounce: `${obj}[o];[1:v][o]overlay=x=(W-w)/2:y=(H-h)*pow(2*mod(t\\,${P})/${P}-1\\,2)`,
    float: `${obj}[o];[1:v][o]overlay=x=(W-w)/2:y=(H-h)/2*(1+sin(2*PI*t/${P}))`,
    pulse: `${obj}[o];[1:v][o]overlay=${center},zoompan=z='1.12+0.1*sin(2*PI*on/${n})':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${cw}x${ch}:fps=${r}`,
    sway: `${obj},${pad},rotate=a=0.15*sin(2*PI*t/${P}):c=none:ow=rotw(0.15):oh=roth(0.15)[o];[1:v][o]overlay=${center}`,
    shake: `${obj}[o];[1:v][o]overlay=x=(W-w)/2*(1+sin(2*PI*t*6/${P})):y=(H-h)/2*(1+cos(2*PI*t*4/${P}))`,
    spin: `${obj},${pad},rotate=a=2*PI*t/${P}:c=none:ow=hypot(iw\\,ih):oh=ow[o];[1:v][o]overlay=${center}`,
    // Twinkling points of light: sparse noise on a coarse grid, held 3 frames, blurred into soft dots.
    sparkle: `${obj}[o];[1:v][o]overlay=${center}[base];color=0xA0A0A0:s=${gw}x${gh}:r=${r / 3}:d=${P},format=gray,noise=alls=100:allf=t+u,`
      + `lut=y='if(gte(val\\,202)\\,255\\,0)',fps=${r},scale=${cw}:${ch}:flags=neighbor,gblur=sigma=${+((2.2 * big) / 256).toFixed(2)},lut=y='min(255\\,val*3)'[m];`
      + `color=0xFFF6D0:s=${cw}x${ch}:r=${r}:d=${P},format=rgba[w];[w][m]alphamerge[sp];[base][sp]overlay`,
  }[s.style];
  const end = finish(s);
  return ['-loop', '1', '-framerate', String(r), '-t', String(P), '-i', src, '-f', 'lavfi', '-i', `color=c=black@0.0:s=${cw}x${ch}:r=${r}:d=${P},format=rgba`,
    '-filter_complex', motion + end.fc, '-frames:v', String(n), ...end.args, '-an'];
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
  const kind = kindOf(src);
  if (kind !== 'video' && kind !== 'image') return Promise.reject(new Error('UNSUPPORTED'));
  const s = settings(opts);
  return withJob(id, async (job) => {
    const info = await probe(src, { thumb: false });
    alive(job);
    if (!info.video?.width) throw new Error('UNSUPPORTED');
    if (kind === 'image') {
      return produce(id, outPath(src, outDir, `${path.parse(src).name} ${s.style}`, s.format), [stillArgs(src, s, info.video)], onProgress, s.seconds);
    }
    if (info.duration && s.start >= info.duration) throw new Error('BAD_RANGE');
    const total = s.length || Math.max(0.1, info.duration - s.start);
    const name = `${path.parse(src).name}${s.start || s.length ? ` ${stamp(s.start)}` : ''}`;
    return produce(id, outPath(src, outDir, name, s.format), [gifArgs(src, s)], onProgress, total);
  });
}

module.exports = { makeGif, gifArgs, stillArgs, settings, FPS, HEIGHTS, LENGTHS, STYLES, SECONDS };
