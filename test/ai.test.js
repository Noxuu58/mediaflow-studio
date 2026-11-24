// AI Video Enhancement: plan logic always; real Real-ESRGAN / RIFE runs only where a Vulkan GPU is available.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const ai = require('../src/ai');
const { encode, cancel, probe, FFMPEG } = require('../src/convert');

const info = (height, fps, extra = {}) => ({ video: { width: Math.round(height * 16 / 9), height, fps, baseFps: fps, rotation: 0, ...extra } });

test('plan: AI only when the target is higher than the source', () => {
  assert.deepStrictEqual(pick(ai.plan(info(720, 30), { height: 1080 })), { upscale: true, scale: 2, mult: 1, ai: true });
  assert.deepStrictEqual(pick(ai.plan(info(480, 30), { height: 2160 })), { upscale: true, scale: 4, mult: 1, ai: true }); // ×4.5 → AI ×4 + lanczos
  assert.deepStrictEqual(pick(ai.plan(info(720, 30), { height: 1080, model: 'quality' })), { upscale: true, scale: 4, mult: 1, ai: true });
  assert.deepStrictEqual(pick(ai.plan(info(2160, 60), { height: 1080, fps: 30 })), { upscale: false, scale: 1, mult: 1, ai: false }); // down = no AI
  assert.deepStrictEqual(pick(ai.plan(info(1080, 30), { fps: 60 })), { upscale: false, scale: 1, mult: 2, ai: true });
  assert.strictEqual(ai.plan(info(1080, 24), { fps: 60 }).mult, 3); // RIFE ×3 = 72, then resampled to 60
  assert.strictEqual(ai.plan(info(1080, 29.97), { fps: 30 }).ai, false); // same rate: nothing to invent
  assert.strictEqual(ai.plan(info(1080, 30, { rotation: -90, width: 1080, height: 1920 }), { height: 1080 }).upscale, false); // portrait phone clip
});
function pick({ upscale, scale, mult, ai: a }) { return { upscale, scale, mult, ai: a }; }

test('AI on the GPU', async (t) => {
  const gpu = await ai.detect(FFMPEG);
  if (!gpu.available) return t.skip('no Vulkan GPU / AI engines here');
  console.log('  AI GPU:', gpu.gpu);
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

  await t.test('both at once, plus a lower target fps path (no AI)', async () => {
    const both = await probe(await encode(s('small15.mp4'), 'youtube', { aiHeight: '720', aiFps: '25', gpu: 'on' }, out));
    assert.deepStrictEqual([both.video.height, both.video.fps], [720, 25]); // RIFE ×2 = 30, resampled to 25
    const down = await probe(await encode(s('small15.mp4'), 'youtube', { aiFps: '24', gpu: 'on' }, out));
    assert.strictEqual(down.video.fps, 24);
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
