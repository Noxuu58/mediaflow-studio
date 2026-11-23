// Downloads the official yt-dlp.exe into vendor/ (bundled into the app by electron-builder) and checks it
// against the SHA2-256SUMS file published with the same release. Runs automatically before `npm run dist`.
//   node scripts/fetch-ytdlp.js            latest release (skips if vendor/ already has it)
//   YTDLP_VERSION=2026.10.26 node ...      pin a version
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const version = process.env.YTDLP_VERSION;
const base = version
  ? `https://github.com/yt-dlp/yt-dlp/releases/download/${version}`
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const dir = path.join(__dirname, '..', 'vendor');
const exe = path.join(dir, 'yt-dlp.exe');

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

(async () => {
  const sums = (await get(`${base}/SHA2-256SUMS`)).toString();
  const expected = /^([a-f0-9]{64})\s+\*?yt-dlp\.exe$/m.exec(sums)?.[1];
  if (!expected) throw new Error('yt-dlp.exe is missing from SHA2-256SUMS');
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  if (fs.existsSync(exe) && sha(fs.readFileSync(exe)) === expected) return console.log('yt-dlp.exe already up to date');
  const bin = await get(`${base}/yt-dlp.exe`);
  if (sha(bin) !== expected) throw new Error('yt-dlp.exe checksum mismatch — refusing to bundle it');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(exe, bin);
  console.log(`yt-dlp.exe ${(bin.length / 1e6).toFixed(1)} MB, sha256 verified`);
})().catch((e) => { console.error(`fetch-ytdlp: ${e.message}`); process.exit(1); });
