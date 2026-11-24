// AI engines for "AI Video Enhancement", bundled into the app (vendor/ai → resources/ai):
//   Real-ESRGAN (upscaling)       xinntao/Real-ESRGAN v0.2.5.0, realesrgan-ncnn-vulkan — BSD-3-Clause
//   RIFE v4.6 (frame interpolation) nihui/rife-ncnn-vulkan 20221029 — MIT
// Both run on any Vulkan GPU (NVIDIA, AMD, Intel). Only the files the app uses are extracted.
// Zip hashes are pinned: a changed upstream file is refused.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PACKS = [
  {
    name: 'realesrgan',
    url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip',
    sha256: 'abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d',
    prefix: '',
    files: ['realesrgan-ncnn-vulkan.exe', 'vcomp140.dll',
      ...['x2', 'x3', 'x4'].flatMap((s) => [`models/realesr-animevideov3-${s}.bin`, `models/realesr-animevideov3-${s}.param`]),
      'models/realesrgan-x4plus.bin', 'models/realesrgan-x4plus.param'],
  },
  {
    name: 'rife',
    url: 'https://github.com/nihui/rife-ncnn-vulkan/releases/download/20221029/rife-ncnn-vulkan-20221029-windows.zip',
    sha256: 'd8e4d772d26cd8006ef0ad0bc82eb191b53c68677d1ae2f42506d74cbbbea606',
    prefix: 'rife-ncnn-vulkan-20221029-windows/',
    files: ['rife-ncnn-vulkan.exe', 'vcomp140.dll', 'LICENSE', 'rife-v4.6/flownet.bin', 'rife-v4.6/flownet.param'],
  },
];
const root = path.join(__dirname, '..', 'vendor', 'ai');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  for (const pack of PACKS) {
    const dest = path.join(root, pack.name);
    const stamp = path.join(dest, '.sha256');
    if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === pack.sha256 && pack.files.every((f) => fs.existsSync(path.join(dest, f)))) {
      console.log(`${pack.name} already present`);
      continue;
    }
    const res = await fetch(pack.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${pack.url}`);
    const zip = Buffer.from(await res.arrayBuffer());
    if (sha(zip) !== pack.sha256) throw new Error(`${pack.name}: checksum mismatch — refusing to bundle it`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ai-${pack.name}-`));
    try {
      fs.writeFileSync(path.join(tmp, 'pack.zip'), zip);
      // Windows' bsdtar reads zip archives; only the listed members are extracted.
      execFileSync('tar', ['-xf', path.join(tmp, 'pack.zip'), '-C', tmp, ...pack.files.map((f) => pack.prefix + f)]);
      fs.rmSync(dest, { recursive: true, force: true });
      for (const f of pack.files) {
        fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
        fs.copyFileSync(path.join(tmp, pack.prefix + f), path.join(dest, f));
      }
      fs.writeFileSync(stamp, pack.sha256);
      console.log(`${pack.name}: ${pack.files.length} files, sha256 verified`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
})().catch((e) => { console.error(`fetch-ai: ${e.message}`); process.exit(1); });
