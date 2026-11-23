// Puts ffprobe.exe in vendor/ (bundled into the app by electron-builder, used by the tests).
// Source: the FFmpeg 6.1.1 "essentials" build by gyan.dev — the exact build ffmpeg-static ships
// (its ffmpeg.exe is byte-identical to node_modules/ffmpeg-static/ffmpeg.exe). Both hashes are pinned.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const URL = 'https://github.com/GyanD/codexffmpeg/releases/download/6.1.1/ffmpeg-6.1.1-essentials_build.zip';
const ZIP_SHA256 = '742e32fc9f92681f9f254b925e1b613fdd8074ba40749d4879aefdb009b94cc5';
const FFPROBE_SHA256 = '3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4';
const INNER = 'ffmpeg-6.1.1-essentials_build/bin/ffprobe.exe';
const out = path.join(__dirname, '..', 'vendor', 'ffprobe.exe');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  if (fs.existsSync(out) && sha(fs.readFileSync(out)) === FFPROBE_SHA256) return console.log('ffprobe.exe already present');
  const res = await fetch(URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${URL}`);
  const zip = Buffer.from(await res.arrayBuffer());
  if (sha(zip) !== ZIP_SHA256) throw new Error('FFmpeg zip checksum mismatch — refusing to use it');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffprobe-'));
  try {
    fs.writeFileSync(path.join(tmp, 'ff.zip'), zip);
    execFileSync('tar', ['-xf', path.join(tmp, 'ff.zip'), '-C', tmp, INNER]); // bsdtar ships with Windows 10+
    const bin = fs.readFileSync(path.join(tmp, INNER));
    if (sha(bin) !== FFPROBE_SHA256) throw new Error('ffprobe.exe checksum mismatch — refusing to bundle it');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, bin);
    console.log(`ffprobe.exe ${(bin.length / 1e6).toFixed(1)} MB, sha256 verified`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(`fetch-ffprobe: ${e.message}`); process.exit(1); });
