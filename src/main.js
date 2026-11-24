const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { aiRequested, convert, encode, trim, extract, strip, probe, detectGpu, kindOf, TARGETS, cancel, killAll, FFMPEG } = require('./convert');
const dl = require('./download');

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
  win.once('ready-to-show', () => win.show());
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
  if (String(target).startsWith('@')) return encode(src, target.slice(1), advanced, outDir, progress(e, id), id);
  if (aiRequested(advanced) && kindOf(src) === 'video' && ['mp4', 'mov', 'mkv'].includes(target)) {
    return encode(src, 'youtube', { ...advanced, container: target }, outDir, progress(e, id), id);
  }
  return convert(src, target, outDir, progress(e, id), id);
});
ipcMain.handle('gpu', () => detectGpu());
ipcMain.handle('ai-info', () => require('./ai').detect(FFMPEG));
ipcMain.handle('trim', (e, { id, src, range, outDir }) => trim(src, range, outDir, progress(e, id), id));
ipcMain.handle('extract', (e, { id, src, options, outDir }) => extract(src, options, outDir, progress(e, id), id));
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
ipcMain.handle('dl-update', () => dl.update());
ipcMain.handle('dl-analyze', (_e, url) => dl.analyze(url));
ipcMain.handle('dl-cancel', (_e, id) => dl.cancel(id));
ipcMain.handle('dl-start', (e, { id, url, fmt, quality, outDir }) =>
  dl.download(id, url, { fmt, quality, outDir }, (p) => e.sender.send('dl-progress', { id, ...p })));

// ---- Auto-update from GitHub Releases (build.publish in package.json; release assets latest.yml + blockmap).
// The installed app downloads in the background and installs on restart. The portable build cannot replace
// itself, so it only announces the new version and opens the download page.
const { autoUpdater } = require('electron-updater');
const RELEASES = 'https://github.com/Noxuu58/mediaflow-studio/releases/latest';
const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
const sendUpdate = (state, extra = {}) => BrowserWindow.getAllWindows()[0]?.webContents.send('update', { state, portable, ...extra });
autoUpdater.autoDownload = false; // the user clicks "Update" first
autoUpdater.autoInstallOnAppQuit = true; // downloaded but not restarted yet → installs when the app closes
// Local end-to-end tests only: point the updater at a folder served over HTTP instead of GitHub.
if (process.env.MEDIAFLOW_UPDATE_FEED) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.MEDIAFLOW_UPDATE_FEED });
autoUpdater.on('update-available', (i) => sendUpdate('available', { version: i.version }));
autoUpdater.on('update-not-available', () => sendUpdate('latest', { version: app.getVersion() }));
autoUpdater.on('download-progress', (p) => sendUpdate('downloading', { percent: p.percent, speed: p.bytesPerSecond }));
autoUpdater.on('update-downloaded', (i) => sendUpdate('ready', { version: i.version }));
autoUpdater.on('error', (e) => sendUpdate('error', { message: String(e?.message || e).split('\n')[0] }));
const canUpdate = () => app.isPackaged || Boolean(process.env.MEDIAFLOW_UPDATE_FEED);
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('update-check', () => (canUpdate() ? autoUpdater.checkForUpdates().catch(() => {}) : sendUpdate('dev', { version: app.getVersion() })));
ipcMain.handle('update-download', () => (portable ? shell.openExternal(RELEASES) : autoUpdater.downloadUpdate().catch(() => {})));
ipcMain.handle('update-install', () => { killAll(); dl.cancel(); autoUpdater.quitAndInstall(true, true); }); // silent install, then relaunch

app.whenReady().then(() => { createWindow(); detectGpu(); }); // GPU test runs once, in the background
app.on('before-quit', () => { killAll(); dl.cancel(); }); // don't leave orphan ffmpeg / yt-dlp processes running
app.on('window-all-closed', () => app.quit());
