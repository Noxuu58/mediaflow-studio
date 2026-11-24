<div align="center">

<img src="build/icon.png" alt="MediaFlow Studio" width="96">

# MediaFlow Studio

**Convert · Download · Trim · Extract**

An everyday media toolkit for **video editors** — one fast, offline Windows app with a dark *liquid glass* interface.
Install it in two clicks: everything is included, nothing else to set up.

![Windows](https://img.shields.io/badge/Windows_10%2F11-0078D4?style=flat-square&logo=windows11&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=flat-square&logo=ffmpeg&logoColor=white)
![yt-dlp](https://img.shields.io/badge/yt--dlp-FF0000?style=flat-square&logo=youtube&logoColor=white)
[![Release](https://img.shields.io/github/v/release/Noxuu58/mediaflow-studio?style=flat-square&color=0A84FF&label=version)](https://github.com/Noxuu58/mediaflow-studio/releases/latest)

<br>

[![Download for Windows](https://img.shields.io/badge/Download_for_Windows-0A84FF?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/Noxuu58/mediaflow-studio/releases/latest/download/MediaFlow-Studio-Setup.exe)

<sub>or the <a href="https://github.com/Noxuu58/mediaflow-studio/releases/latest/download/MediaFlow-Studio-Portable.exe">portable version</a> (no install)</sub>

<br><br>

<img src="docs/screenshots/converter.png" alt="MediaFlow Studio — Converter" width="90%">

</div>

<br>

## Tools

| | Tool | What it does |
| :-- | :-- | :-- |
| 🔄 | **Converter** | One-click presets — **TikTok / Shorts**, **Clean export (YouTube)**, **Proxy for editing (ProRes)**, **Extract audio** — or any format. Variable frame rate is detected and fixed, HDR is tone-mapped for 8-bit deliveries, 10-bit and timecode are kept, and **GPU encoding** (NVIDIA / Intel / AMD) is used automatically. **Advanced** mode unlocks ProRes / DNxHR, bit depth, frame rate, resolution and audio-track control. |
| ⬇️ | **Downloader** | Paste a link from YouTube, TikTok, Instagram, X, Vimeo, SoundCloud and 1,000+ sites. Video or audio, in the quality you choose — H.264 + AAC preferred so it drops straight into your editor. |
| ✂️ | **Trimmer** | Preview, filmstrip timeline, in / out handles. **Fast** mode cuts instantly without re-encoding; **Frame-accurate** mode re-encodes at maximum quality. |
| 🎧 | **Audio Extractor** | Pull the audio out of any video as `WAV` `MP3` `FLAC` `M4A`, with **loudness normalization** (−14 / −16 / −23 LUFS), noise reduction and low-cut. Advanced: pick or mix tracks, mono, **split L / R** (lav + camera mic), 24-bit, 48 kHz. |
| 🪄 | **AI Enhance** | Two modes, 100% local on your graphics card: **Upscaling** with Real-ESRGAN (720p → 4K) and **Interpolation** with RIFE (smooth motion up to 60 fps). Lower targets are a classic downscale / frame drop. |

<div align="center">
<img src="docs/screenshots/trimmer.png" alt="Trimmer" width="32%">
<img src="docs/screenshots/downloader.png" alt="Downloader" width="32%">
<img src="docs/screenshots/audio-extractor.png" alt="Audio Extractor" width="32%">
</div>

<div align="center">
<img src="docs/screenshots/ai-enhance.png" alt="AI Enhance — Upscaling and Interpolation on your GPU" width="90%">
<br><sub><b>AI Enhance</b> — Real-ESRGAN upscaling and RIFE interpolation, running locally on your GPU.</sub>
</div>

<br>

<div align="center">
<img src="docs/screenshots/advanced.png" alt="Advanced mode — ProRes, DNxHR, bit depth, frame rate, audio tracks, GPU" width="90%">
<br><sub><b>Advanced mode</b> — one click away, never in the way: codecs, bit depth, frame rate, audio tracks, GPU.</sub>
</div>

<br>

| | Also |
| :-- | :-- |
| 🌍 | English & French interface |
| 🔔 | Windows notifications + taskbar progress |
| 🔊 | Soft UI sounds (one click to mute) |
| 🛡️ | Never overwrites a file — `name (1).mp4` |
| 📁 | Output folder per tool, remembered |

## Installation

**1. Download**

| | |
| :-- | :-- |
| ⭐ **[MediaFlow-Studio-Setup.exe](https://github.com/Noxuu58/mediaflow-studio/releases/latest/download/MediaFlow-Studio-Setup.exe)** | Recommended. Installs for your account — no admin rights — and adds a desktop shortcut. |
| 📦 [MediaFlow-Studio-Portable.exe](https://github.com/Noxuu58/mediaflow-studio/releases/latest/download/MediaFlow-Studio-Portable.exe) | No install. Run it from anywhere, even a USB drive. |

**2. Run it**

Double-click the file, click **Install**, done. FFmpeg and yt-dlp are built in — you never need a command line.

> **Windows protected your PC?** The app isn't code-signed yet, so SmartScreen may warn on first launch. Click **More info → Run anyway**.

**3. Stay up to date — automatically**

When a new version is out, the app shows an *Update available* banner: one click downloads it in the background, a second one restarts on the new version. You can also click **Check for updates** in the sidebar.

Sites change often: if a link stops working, click **Update** at the bottom of the Downloader to refresh the built-in yt-dlp.

**Uninstall** from *Settings → Apps → MediaFlow Studio*, like any other app.

## Shortcuts

| Keys | Action |
| :-- | :-- |
| <kbd>Ctrl</kbd> + <kbd>O</kbd> | Add files |
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Start (convert · extract · export · download) |
| <kbd>Esc</kbd> | Cancel |
| <kbd>Ctrl</kbd> + <kbd>V</kbd> | Paste a link (Downloader) |
| <kbd>Space</kbd> | Play / pause (Trimmer) |
| <kbd>I</kbd> · <kbd>O</kbd> | Set in / out point (Trimmer) |
| <kbd>←</kbd> <kbd>→</kbd> | One frame · with <kbd>Shift</kbd> one second (Trimmer) |

## For developers

<details>
<summary><b>Build from source</b></summary>

<br>

Requires Node.js 20+ on Windows.

```powershell
git clone https://github.com/Noxuu58/mediaflow-studio.git
cd mediaflow-studio
npm ci
npm start          # run the app
npm test           # test suite
npm run dist       # → dist/MediaFlow-Studio-Setup.exe + dist/MediaFlow-Studio-Portable.exe
```

`npm run dist` downloads the official `yt-dlp.exe` and checks it against the release's SHA-256 checksums before bundling it.
If `npm` blocked Electron's install script, run `node node_modules/electron/install.js` once.

</details>

<details>
<summary><b>Publish a release</b></summary>

<br>

```powershell
npm version patch          # 1.0.0 → 1.0.1
git push
git push --tags            # the tag starts .github/workflows/release.yml
```

GitHub Actions tests, builds and publishes the release; installed apps then offer the update automatically.
Full guide: **[RELEASING.md](RELEASING.md)**.

</details>

<details>
<summary><b>Project structure</b></summary>

<br>

```
src/
  main.js           Electron main process
  convert.js        FFmpeg engine — convert, trim, extract, preview strip
  download.js       yt-dlp engine (uses Electron's built-in Node for YouTube)
  i18n.js           translations (en, fr)
  sfx.js            UI sounds, synthesized (no audio files)
  app.js            sidebar, navigation, drag & drop, shared helpers
  styles.css        the whole design system
  tools/
    queue.js        reusable file queue (Converter + Audio Extractor)
    converter.js · downloader.js · trimmer.js · extractor.js
build/              icon, installer artwork, installer.nsh
scripts/            fetch-ytdlp.js
test/               node:test suites
```

**Add a tool** — a new file in `src/tools/` calling `App.register({...})` + one `<script>` line in `index.html`.
**Add a language** — copy the `en` block in `src/i18n.js` and translate it.

</details>

## Credits

[FFmpeg](https://ffmpeg.org) (GPL-3.0) · [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense) · [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) (BSD-3-Clause) · [RIFE ncnn Vulkan](https://github.com/nihui/rife-ncnn-vulkan) (MIT) · [Electron](https://www.electronjs.org) (MIT) — all bundled in the app.

Only download content you have the right to download.

<br>

<div align="center">
<sub>Made with ♥ for video editors.</sub>
</div>
