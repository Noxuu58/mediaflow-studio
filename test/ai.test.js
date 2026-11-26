// AI Video Enhancement: plan logic always; real Real-ESRGAN / RIFE runs only where a Vulkan GPU is available.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const ai = require('../src/ai');
const { encode, cancel, probe, FFMPEG, detectGpu, encoders, setEncoder } = require('../src/convert');

const info = (height, fps, extra = {}) => ({ video: { width: Math.round(height * 16 / 9), height, fps, baseFps: fps, rotation: 0, ...extra } });

test('enhance refuses a video without a known duration (it would stop after one chunk)', async () => {
  const p = ai.plan({ video: { width: 640, height: 360, fps: 30 } }, { height: '720' });
  for (const duration of [0, NaN, undefined]) {
    await assert.rejects(ai.enhance('x.mp4', { duration, video: { width: 640, height: 360, fps: 30 } }, p, { FFMPEG, job: { aborted: false, procs: new Set() } }), /AI_NO_DURATION/);
  }
});

test('enhance checks free disk space before writing anything', async () => {
  const info = { duration: 1e7, video: { width: 3840, height: 2160, fps: 60 } };
  const p = ai.plan(info, { height: '2160', fps: '120', model: 'quality', restore: true });
  assert.ok(ai.diskNeeded(info, p) > ai.diskNeeded({ ...info, duration: 10 }, p));
  await assert.rejects(ai.enhance('x.mp4', info, p, { FFMPEG, job: { aborted: false, procs: new Set() } }), /DISK_FULL:\d+/);
});

test('a hung engine is stopped after its timeout', async () => {
  const job = { aborted: false, procs: new Set() };
  await assert.rejects(ai.run(job, FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'nullsrc', '-f', 'null', '-'], null, 500), /AI_TIMEOUT/);
  assert.strictEqual(job.procs.size, 0);
});

test('plan: a plain target only uses the AI when it is higher than the source', () => {
  assert.deepStrictEqual(pick(ai.plan(info(720, 30), { height: 1080 })), { upscale: true, scale: 2, mult: 1, ai: true });
  assert.deepStrictEqual(pick(ai.plan(info(480, 30), { height: 2160 })), { upscale: true, scale: 4, mult: 1, ai: true }); // ×4.5 → AI ×4 + lanczos
  assert.deepStrictEqual(pick(ai.plan(info(720, 30), { height: 1080, model: 'quality' })), { upscale: true, scale: 4, mult: 1, ai: true });
  assert.deepStrictEqual(pick(ai.plan(info(2160, 60), { height: 1080, fps: 30 })), { upscale: false, scale: 1, mult: 1, ai: false }); // down = no AI
  assert.deepStrictEqual(pick(ai.plan(info(1080, 30), { fps: 60 })), { upscale: false, scale: 1, mult: 2, ai: true });
  assert.strictEqual(ai.plan(info(1080, 24), { fps: 60 }).mult, 3); // RIFE ×3 = 72, then resampled to 60
  assert.strictEqual(ai.plan(info(1080, 30), { fps: 240 }).mult, 8); // high-frame-rate targets
  assert.strictEqual(ai.plan(info(1080, 24), { fps: 180 }).mult, 8); // ×8 = 192, resampled to 180
  assert.strictEqual(ai.plan(info(1080, 29.97), { fps: 30 }).ai, false); // same rate: nothing to invent
  assert.strictEqual(ai.plan(info(1080, 30, { rotation: -90, width: 1080, height: 1920 }), { height: 1080 }).upscale, false); // portrait phone clip
});
test('plan: the Upscaling preset always runs the AI, even at the same or a lower size', () => {
  const r = (h, height, model) => ai.plan(info(h, 30), { height, model, restore: true });
  // 1080p → 1080p: AI ×2 at the source size (2160p), then back down to 1080p.
  assert.deepStrictEqual(pick2(r(1080, 1080)), { upscale: true, scale: 2, inH: 1080, outH: 2160, ai: true });
  // 4K → 1080p: frames brought to 1080p first, so the AI works at 2160p, not 8K.
  assert.deepStrictEqual(pick2(r(2160, 1080)), { upscale: true, scale: 2, inH: 1080, outH: 2160, ai: true });
  // "Best quality" is ×4 only: frames at half the target, ×4 = 2× the target.
  assert.deepStrictEqual(pick2(r(1080, 1080, 'quality')), { upscale: true, scale: 4, inH: 540, outH: 2160, ai: true });
  // A larger target works as before (no shrinking first).
  assert.deepStrictEqual(pick2(r(720, 1080)), { upscale: true, scale: 2, inH: null, outH: 1440, ai: true });
  // Interpolation (no restore) still leaves the resolution alone.
  assert.strictEqual(ai.plan(info(1080, 30), { fps: 60 }).upscale, false);
});
test('Vulkan / driver failures become clear error codes', () => {
  const fail = (msg, log = '') => ai.aiError(Object.assign(new Error(msg), { log })).message;
  assert.strictEqual(fail('code 255', '[0 GPU] queueC=0 vkAllocateMemory failed'), 'AI_VRAM');
  assert.strictEqual(fail('vkQueueSubmit failed -4'), 'AI_GPU_LOST');
  assert.strictEqual(fail('invalid gpu device'), 'AI_GPU_GONE');
  assert.strictEqual(fail('vkCreateInstance failed -9'), 'AI_NO_GPU');
  assert.strictEqual(fail('CANCELLED'), 'CANCELLED'); // anything else passes through
});

test('Settings: video encoder choice', async () => {
  try {
    setEncoder('cpu');
    assert.strictEqual(await detectGpu(), null);
    setEncoder('nope'); // unknown value = auto
    assert.deepStrictEqual(await detectGpu(), (await encoders())[0] || null);
  } finally { setEncoder('auto'); }
});

function pick({ upscale, scale, mult, ai: a }) { return { upscale, scale, mult, ai: a }; }
function pick2(p) { return { upscale: p.upscale, scale: p.scale, inH: p.inH, outH: p.outH, ai: p.ai }; }

test('AI on the GPU', async (t) => {
  const gpu = await ai.detect(FFMPEG);
  if (!gpu.available) return t.skip('no Vulkan GPU / AI engines here');
  console.log('  AI GPU:', gpu.gpu);

  await t.test('lists the Vulkan GPUs; a card that is gone gives a clear reason', async () => {
    const hw = await ai.devices(FFMPEG);
    assert.ok(hw.vulkan && hw.devices.length >= 1 && hw.devices[0].name, JSON.stringify(hw));
    try {
      ai.setGpu(hw.devices[0].id);
      assert.strictEqual((await ai.detect(FFMPEG)).available, true);
      ai.setGpu('42');
      assert.strictEqual((await ai.detect(FFMPEG)).reason, 'GPU_GONE');
    } finally { ai.setGpu('auto'); }
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-'));
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  const s = (n) => path.join(dir, n);
  const ff = (...a) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
  const frameCount = (f) => Number(/frame=\s*(\d+)/g.exec(spawnSync(FFMPEG, ['-hide_banner', '-i', f, '-map', '0:v:0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.split('\n').filter((l) => l.includes('frame=')).pop() || '')?.[1]);
  // 60 frames = 2 chunks (48 + 12): exercises the overlap frame at the chunk boundary.
  ff('-f', 'lavfi', '-i', 'testsrc2=d=4:s=160x120:r=15', '-f', 'lavfi', '-i', 'sine=d=4', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', s('small15.mp4'));

  await t.test('upscale 120p → 480p keeps every frame and the audio', async () => {
    const stages = new Set();
    const res = await encode(s('small15.mp4'), 'youtube', { aiHeight: '720', gpu: 'on' }, out, (p, stage) => stage && stages.add(stage));
    const p = await probe(res);
    assert.deepStrictEqual([p.video.height, p.video.fps], [720, 15]);
    assert.strictEqual(frameCount(res), 60);
    assert.ok(p.audio, 'audio kept');
    assert.ok(stages.has('upscale') && stages.has('encode'), [...stages].join(','));
  });

  await t.test('interpolate 15 → 30 fps doubles the frames across chunks', async () => {
    const res = await encode(s('small15.mp4'), 'youtube', { aiFps: '30', gpu: 'on' }, out);
    const p = await probe(res);
    assert.strictEqual(p.video.fps, 30);
    const n = frameCount(res);
    assert.ok(Math.abs(n - 120) <= 1, `frames ${n}`);
  });

  await t.test('images: ×2 / ×3 / ×4 in their own format, transparency kept, size limit', async () => {
    ff('-f', 'lavfi', '-i', 'testsrc2=s=160x120', '-frames:v', '1', s('photo.jpg'));
    ff('-f', 'lavfi', '-i', "testsrc2=s=100x80,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,50),255,0)'", '-frames:v', '1', s('logo.png'));
    const jpg = await encode(s('photo.jpg'), 'upscale', { aiScale: '4' }, out);
    assert.match(path.basename(jpg), /^photo Upscaled\.jpg$/);
    assert.deepStrictEqual([(await probe(jpg)).video.width, (await probe(jpg)).video.height], [640, 480]);
    const png = await encode(s('logo.png'), 'upscale', { aiScale: '3', aiModel: 'quality' }, out); // ×4 model, then exact ×3
    assert.deepStrictEqual([(await probe(png)).video.width, (await probe(png)).video.height], [300, 240]);
    const alpha = execFileSync(FFMPEG, ['-v', 'error', '-i', png, '-vf', 'crop=1:1:250:120,format=rgba', '-f', 'rawvideo', '-']);
    assert.strictEqual(alpha[3], 0, 'transparent half stays transparent');
    ff('-f', 'lavfi', '-i', 'color=gray:s=5000x100', '-frames:v', '1', s('wide.png'));
    await assert.rejects(encode(s('wide.png'), 'upscale', { aiScale: '4' }, out), /IMAGE_TOO_BIG/);
  });

  await t.test('interpolate 15 → 240 fps (high-frame-rate target, RIFE ×16)', async () => {
    const res = await encode(s('small15.mp4'), 'youtube', { aiFps: '240', gpu: 'on' }, out);
    assert.strictEqual((await probe(res)).video.fps, 240);
    const n = frameCount(res);
    assert.ok(Math.abs(n - 960) <= 16, `frames ${n}`);
  });

  await t.test('both at once, plus a lower target fps path (no AI)', async () => {
    const both = await probe(await encode(s('small15.mp4'), 'youtube', { aiHeight: '720', aiFps: '25', gpu: 'on' }, out));
    assert.deepStrictEqual([both.video.height, both.video.fps], [720, 25]); // RIFE ×2 = 30, resampled to 25
    const down = await probe(await encode(s('small15.mp4'), 'youtube', { aiFps: '24', gpu: 'on' }, out));
    assert.strictEqual(down.video.fps, 24);
  });

  // Image distance in dB (higher = closer): PSNR of two files, first frame of each.
  const psnr = (a, b) => Number(/average:([\d.]+|inf)/.exec(spawnSync(FFMPEG, ['-hide_banner', '-i', a, '-i', b,
    '-filter_complex', '[0:v][1:v]psnr', '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1]);
  const frameAt = (f, n, png) => { ff('-i', f, '-vf', `select='eq(n,${n})'`, '-frames:v', '1', png); return png; };

  // The bug in 1.2.7: a video already at the chosen size came out unchanged (plain re-encode in 3 s, no AI).
  await t.test('Upscaling a soft video already at the target size runs the AI and makes it sharper', async () => {
    // The "ugly" video: 360p detail stretched to 720p (soft edges everywhere).
    ff('-f', 'lavfi', '-i', 'testsrc2=d=1:s=640x360:r=24', '-vf', 'scale=1280:720:flags=bicubic,gblur=sigma=1.2', '-c:v', 'libx264', '-crf', '16', s('soft720.mp4'));
    const stages = new Set();
    const res = await encode(s('soft720.mp4'), 'upscale', { aiHeight: '720', aiModel: 'quality' }, out, (p, stage) => stage && stages.add(stage));
    const p = await probe(res);
    assert.deepStrictEqual([p.video.width, p.video.height, frameCount(res)], [1280, 720, 24]);
    assert.ok(stages.has('upscale'), `AI stage ran: ${[...stages]}`);
    // Sharper: more edge energy (mean of a Sobel edge map) than the soft source. Synthetic bars gain ≈7 %; real footage far more.
    const edges = (f) => Number(/YAVG=([\d.]+)/.exec(spawnSync(FFMPEG, ['-hide_banner', '-i', f, '-frames:v', '1', '-vf', 'format=gray,sobel,signalstats,metadata=print', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1]);
    const [before, after] = [edges(s('soft720.mp4')), edges(res)];
    assert.ok(after > before * 1.04, `edge energy ${before} → ${after}`);
  });

  await t.test('interpolation invents real in-between frames (not copies)', async () => {
    const own = path.join(dir, 'between');
    fs.mkdirSync(own);
    const res = await encode(s('small15.mp4'), 'interpolate', { aiFps: '30' }, own);
    const [f20, f21, f22] = [20, 21, 22].map((n) => frameAt(res, n, path.join(own, `${n}.png`)));
    // Frame 21 sits between source frames 10 and 11 (output frames 20 and 22): different from both, closer to each than they are to each other.
    const [a, b, ends] = [psnr(f21, f20), psnr(f21, f22), psnr(f20, f22)];
    assert.ok(a < 50 && b < 50 && a > ends && b > ends, `21↔20 ${a} dB, 21↔22 ${b} dB, 20↔22 ${ends} dB`);
  });

  await t.test('AI Enhance tool modes: Upscaling and Interpolation presets', async () => {
    const up = await encode(s('small15.mp4'), 'upscale', { aiHeight: '720', aiModel: 'fast' }, out);
    assert.match(path.basename(up), /^small15 Upscaled\.mp4$/);
    assert.strictEqual((await probe(up)).video.height, 720);
    const mid = await encode(s('small15.mp4'), 'interpolate', { aiFps: '30' }, out);
    assert.match(path.basename(mid), /^small15 Interpolated\.mp4$/);
    assert.deepStrictEqual([(await probe(mid)).video.fps, (await probe(mid)).video.height], [30, 120]); // resolution untouched
  });

  await t.test('cancel stops the AI stage and cleans its temp folder', async () => {
    ff('-f', 'lavfi', '-i', 'testsrc2=d=20:s=320x240:r=30', '-c:v', 'libx264', s('long.mp4'));
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('mediaflow-ai-')).length;
    const job = encode(s('long.mp4'), 'youtube', { aiHeight: '1080', aiModel: 'quality' }, out, () => {}, 'ai-job');
    await new Promise((r) => setTimeout(r, 4000));
    cancel('ai-job');
    await assert.rejects(job, /CANCELLED/);
    assert.strictEqual(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('mediaflow-ai-')).length, before);
  });
});
