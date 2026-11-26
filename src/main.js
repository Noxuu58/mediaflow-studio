const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, clipboard, powerSaveBlocker, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { aiRequested, convert, encode, trim, extract, strip, probe, detectGpu, encoders, setEncoder, kindOf, TARGETS, cancel, killAll, FFMPEG } = require('./convert');
const dl = require('./download');
const ai = require('./ai');
const { createLog } = require('./log');
const { readable } = require('./errors');
const presets = require('./presets');

const logsDir = () => app.getPath('logs');
const log = createLog(() => path.join(logsDir(), 'main.log'));
process.on('uncaughtException', (e) => log('error', 'uncaught exception', e));
process.on('unhandledRejection', (e) => log('error', 'unhandled rejection', e));
app.on('render-process-gone', (_e, _wc, d) => log('error', 'window process gone', d));
app.on('child-process-gone', (_e, d) => log('warn', 'child process gone', d));

// Windows taskbar/notification identity; must equal build.appId (the installer stamps it on the shortcuts).
// Dev runs (plain electron.exe, Electron logo) get their own ID: if they share the app's ID, Windows ties that ID
// to the Electron logo and shows it in the taskbar — what happened to v1.0.0 with 'com.mediaflow.studio'.
const APP_ID = 'com.noxuu58.mediaflowstudio';
app.setAppUserModelId(app.isPackaged ? APP_ID : `${APP_ID}.dev`);
nativeTheme.themeSource = 'dark'; // dark acrylic tint and dialogs even when Windows is in light mode

function createWindow() {
  const win = new BrowserWindow({
    title: 'MediaFlow Studio',
    width: 1180, height: 760, minWidth: 820, minHeight: 560,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e5e5ea', height: 48 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), autoplayPolicy: 'no-user-gesture-required' }, // success chime after a long job
  });
  win.setMenu(null);
  // The window only ever shows src/index.html: a dropped link or a stray <a> never navigates it or opens a window.
  // Reloading that same page stays allowed (switching language reloads the window).
  win.webContents.on('will-navigate', (e, url) => { if (url.split('#')[0] !== win.webContents.getURL().split('#')[0]) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => win.show());
  // Closing in the middle of an export / AI job / download would throw the work away: ask first.
  win.on('close', (e) => {
    if (!running) return;
    const L = quitText();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: [L['quit.quit'], L['quit.stay']], defaultId: 1, cancelId: 1, noLink: true,
      title: 'MediaFlow Studio', message: L['quit.message'], detail: L['quit.detail'],
    });
    if (choice !== 0) e.preventDefault();
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('info', (_e, files) => files.map((f) => {
  const st = fs.statSync(f, { throwIfNoEntry: false });
  const kind = st?.isFile() ? kindOf(f) : null;
  return { path: f, kind, size: st?.size || 0, targets: TARGETS[kind] || [] };
}));
ipcMain.handle('probe', (_e, f) => probe(f));
ipcMain.handle('pick-files', async () => (await dialog.showOpenDialog({
  properties: ['openFile', 'multiSelections'],
  filters: [{ name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'mp4', 'mkv', 'mov', 'webm', 'avi'] }],
})).filePaths);
ipcMain.handle('pick-dir', async () => (await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })).filePaths[0]);
ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('cancel', (_e, id) => cancel(id));
ipcMain.handle('taskbar', (e, p) => BrowserWindow.fromWebContents(e.sender)?.setProgressBar(p));
const progress = (e, id) => (p, stage) => e.sender.send('progress', { id, p, stage }); // stage: AI step label
// Targets starting with '@' are presets (engine validates the advanced overrides); others are plain formats.
// A plain video format with AI targets goes through the "Clean export" pipeline in that container.
ipcMain.handle('convert', (e, { id, src, target, outDir, advanced = {} }) => {
  const what = `convert ${path.basename(src)} → ${target} ${JSON.stringify(advanced)}`;
  if (String(target).startsWith('@')) return awake(encode(src, target.slice(1), advanced, outDir, progress(e, id), id), what);
  if (aiRequested(advanced) && kindOf(src) === 'video' && ['mp4', 'mov', 'mkv'].includes(target)) {
    return awake(encode(src, 'youtube', { ...advanced, container: target }, outDir, progress(e, id), id), what);
  }
  return awake(convert(src, target, outDir, progress(e, id), id), what);
});
ipcMain.handle('gpu', () => detectGpu());
ipcMain.handle('ai-info', (_e, fresh) => ai.detect(FFMPEG, fresh));
ipcMain.handle('trim', (e, { id, src, range, outDir }) => awake(trim(src, range, outDir, progress(e, id), id), `trim ${path.basename(src)} ${JSON.stringify(range)}`));
ipcMain.handle('extract', (e, { id, src, options, outDir }) => awake(extract(src, options, outDir, progress(e, id), id), `extract ${path.basename(src)} ${JSON.stringify(options)}`));
ipcMain.handle('strip', (_e, src, duration) => strip(src, duration));

ipcMain.handle('clipboard', () => clipboard.readText());
ipcMain.handle('downloads-dir', () => app.getPath('downloads'));
// yt-dlp ships inside the app (vendor/ → resources/bin). It runs from a copy in userData so the
// Update button (yt-dlp -U) works even from Program Files or a portable exe that unpacks to a temp folder.
// shortcut: an existing copy is never replaced by a newer bundled one; the Update button keeps it current.
function bundledYtdlp() {
  const bundled = app.isPackaged ? path.join(process.resourcesPath, 'bin', 'yt-dlp.exe') : path.join(__dirname, '..', 'vendor', 'yt-dlp.exe');
  const copy = path.join(app.getPath('userData'), 'bin', 'yt-dlp.exe');
  try {
    if (!fs.existsSync(copy) && fs.existsSync(bundled)) {
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(bundled, copy);
    }
  } catch {}
  return fs.existsSync(copy) ? copy : null;
}
dl.setRuntime(process.execPath);
// Order: the yt-dlp.exe the user picked → the bundled copy → yt-dlp on PATH.
ipcMain.handle('dl-version', (_e, bin) => { dl.setBinary(bin || bundledYtdlp()); return dl.version(); });
ipcMain.handle('dl-pick-binary', async () => (await dialog.showOpenDialog({
  title: 'yt-dlp.exe', properties: ['openFile'], filters: [{ name: 'yt-dlp', extensions: ['exe'] }],
})).filePaths[0]);
ipcMain.handle('dl-update', () => dl.update().catch((e) => { log('error', 'yt-dlp update', e); throw readable(e); }));
ipcMain.handle('dl-analyze', (_e, url) => dl.analyze(url).catch((e) => { log('warn', 'analyze link', e); throw readable(e); }));
ipcMain.handle('dl-cancel', (_e, id) => dl.cancel(id));
ipcMain.handle('dl-start', (e, { id, url, fmt, quality, outDir, section }) =>
  awake(dl.download(id, url, { fmt, quality, outDir, section }, (p) => e.sender.send('dl-progress', { id, ...p })), `download ${fmt} ${quality}${section ? ` ${section.start}-${section.end}s` : ''}`));

// ---- Settings (stored by the renderer, applied here): video encoder, AI graphics card, keep the PC awake.
let keepAwake = true, running = 0, blocker = null;
// Files this app wrote in this session: the only paths the window may start a drag with.
const produced = new Set();
let dragIcon;
// A finished file dragged from its row straight into Premiere Pro, DaVinci Resolve, Explorer…
ipcMain.on('drag-out', (e, file) => {
  if (!produced.has(file) || !fs.existsSync(file)) return;
  dragIcon ||= nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 48, height: 48 });
  e.sender.startDrag({ file, icon: dragIcon });
});

// Personal presets: JSON files in and out, every value checked (src/presets.js).
ipcMain.handle('presets-export', async (e, list) => {
  const json = presets.serialize(list);
  const { filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    defaultPath: path.join(app.getPath('documents'), list.length === 1 ? `${list[0].name.replace(/[\\/:*?"<>|]/g, '_')}.mediaflow.json` : 'MediaFlow presets.mediaflow.json'),
    filters: [{ name: 'MediaFlow presets', extensions: ['json'] }],
  });
  if (!filePath) return null;
  await fs.promises.writeFile(filePath, json);
  return filePath;
});
ipcMain.handle('presets-import', async (e) => {
  const { filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    properties: ['openFile'], filters: [{ name: 'MediaFlow presets', extensions: ['json'] }],
  });
  if (!filePaths[0]) return null;
  if ((await fs.promises.stat(filePaths[0])).size > 1 << 20) throw new Error('PRESET_INVALID');
  return presets.parse(await fs.promises.readFile(filePaths[0], 'utf8'));
});
// Every job goes through here: no sleep / suspend while any job runs (the screen may still turn off), failures are
// logged with the tool's output and turned into codes the window explains in the user's language.
function awake(job, what = 'job') {
  if (++running === 1 && keepAwake) blocker = powerSaveBlocker.start('prevent-app-suspension');
  return Promise.resolve(job).then((out) => {
    if (typeof out === 'string') produced.add(out); // may be dragged out of the window (see 'drag-out')
    return out;
  }, (e) => {
    if (e?.message !== 'CANCELLED') log('error', what, e);
    throw readable(e);
  }).finally(() => {
    if (--running === 0 && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
  });
}
let uiLang = 'en';
// The quit dialog is shown by the main process, in the language chosen in the window (same files as the UI).
function quitText() {
  const file = (code) => path.join(__dirname, 'locales', `${path.basename(code)}.js`);
  for (const code of new Set([uiLang, 'en'])) if (fs.existsSync(file(code))) require(file(code));
  return { ...globalThis.MF_LOCALES.en.strings, ...globalThis.MF_LOCALES[uiLang]?.strings };
}
ipcMain.handle('prefs', (_e, p = {}) => { setEncoder(p.encoder); ai.setGpu(p.aiGpu); keepAwake = p.keepAwake !== false; uiLang = p.lang || uiLang; });
// Everything the Settings panel shows: working encoders, Vulkan GPUs + versions, the graphics vendors present.
ipcMain.handle('hardware', async (_e, fresh) => {
  const [enc, vk, info] = await Promise.all([encoders(), ai.devices(FFMPEG, fresh), app.getGPUInfo('basic').catch(() => ({}))]);
  const vendors = [...new Set((info.gpuDevice || []).map((g) => VENDORS[g.vendorId]).filter(Boolean))];
  return { encoders: enc, ai: vk, vendors };
});
// Driver download pages, by vendor key only (the renderer never passes a URL).
const VENDORS = { 0x10de: 'nvidia', 0x1002: 'amd', 0x8086: 'intel' };
const DRIVERS = { nvidia: 'https://www.nvidia.com/Download/index.aspx', amd: 'https://www.amd.com/en/support/download/drivers.html', intel: 'https://www.intel.com/content/www/us/en/support/detect.html' };
ipcMain.handle('open-logs', async () => { await fs.promises.mkdir(logsDir(), { recursive: true }); return shell.openPath(logsDir()); });
ipcMain.handle('driver-page', (_e, vendor) => DRIVERS[vendor] && shell.openExternal(DRIVERS[vendor]));

// ---- Auto-update from GitHub Releases (build.publish in package.json; release assets latest.yml + blockmap).
// The installed app downloads in the background and installs on restart. The portable build cannot replace
// itself, so it only announces the new version and opens the download page.
const { autoUpdater } = require('electron-updater');
const RELEASES = 'https://github.com/Noxuu58/mediaflow-studio/releases/latest';
const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
const sendUpdate = (state, extra = {}) => BrowserWindow.getAllWindows()[0]?.webContents.send('update', { state, portable, ...extra });
autoUpdater.autoDownload = false; // the user clicks "Update" first
autoUpdater.autoInstallOnAppQuit = true; // downloaded but not restarted yet → installs when the app closes
// Development only: point the updater at a folder served over HTTP instead of GitHub. Never in the shipped app,
// where an environment variable must not be able to swap the update source.
const devFeed = !app.isPackaged && process.env.MEDIAFLOW_UPDATE_FEED;
if (devFeed) autoUpdater.setFeedURL({ provider: 'generic', url: devFeed });
autoUpdater.on('update-available', (i) => sendUpdate('available', { version: i.version }));
autoUpdater.on('update-not-available', () => sendUpdate('latest', { version: app.getVersion() }));
autoUpdater.on('download-progress', (p) => sendUpdate('downloading', { percent: p.percent, speed: p.bytesPerSecond }));
autoUpdater.on('update-downloaded', (i) => sendUpdate('ready', { version: i.version }));
autoUpdater.on('error', (e) => { log('warn', 'update', e); sendUpdate('error', { message: String(e?.message || e).split('\n')[0] }); });
const canUpdate = () => app.isPackaged || Boolean(devFeed);
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('update-check', () => (canUpdate() ? autoUpdater.checkForUpdates().catch(() => {}) : sendUpdate('dev', { version: app.getVersion() })));
ipcMain.handle('update-download', () => (portable ? shell.openExternal(RELEASES) : autoUpdater.downloadUpdate().catch(() => {})));
ipcMain.handle('update-install', () => { killAll(); dl.cancel(); autoUpdater.quitAndInstall(true, true); }); // silent install, then relaunch

// The installed app keeps its Start Menu / desktop shortcuts pointed at itself. The installer relaunches the app
// through the Start Menu shortcut after an update: aimed at an old copy (a portable run in %TEMP%), it reopened
// that old version and "Restart & Install" seemed to do nothing. Only existing shortcuts are fixed, never created.
function repairShortcuts() {
  if (!app.isPackaged || portable) return;
  const exe = process.execPath;
  const links = [path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'MediaFlow Studio.lnk'),
    path.join(app.getPath('desktop'), 'MediaFlow Studio.lnk')];
  for (const link of links) {
    try {
      if (!fs.existsSync(link)) continue;
      const { target } = shell.readShortcutLink(link);
      if (path.resolve(target).toLowerCase() === exe.toLowerCase()) continue;
      shell.writeShortcutLink(link, 'update', { target: exe, cwd: path.dirname(exe), icon: exe, iconIndex: 0, appUserModelId: APP_ID });
    } catch {} // unreadable shortcut: leave it alone
  }
}

// Temp folders (AI frames mediaflow-ai-*, downloads mediaflow-*) left behind by a crash or a forced shutdown
// (a normal run always deletes its own). Asynchronous: a large AI folder never freezes the window.
async function cleanStaleTemp() {
  const dayAgo = Date.now() - 24 * 3600e3;
  const names = await fs.promises.readdir(os.tmpdir()).catch(() => []);
  for (const d of names.filter((n) => n.startsWith('mediaflow-'))) {
    const p = path.join(os.tmpdir(), d);
    try { if ((await fs.promises.stat(p)).mtimeMs < dayAgo) await fs.promises.rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}
app.whenReady().then(() => { log('info', `MediaFlow Studio ${app.getVersion()} started (${os.release()}, ${app.isPackaged ? 'installed' : 'dev'})`); createWindow(); encoders(); setTimeout(() => { cleanStaleTemp(); repairShortcuts(); }, 5000); }); // GPU test runs once, in the background
app.on('before-quit', () => { killAll(); dl.cancel(); }); // don't leave orphan ffmpeg / yt-dlp processes running
app.on('window-all-closed', () => app.quit());
