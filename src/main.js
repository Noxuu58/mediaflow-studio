const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { convert, trim, extract, strip, probe, kindOf, TARGETS, cancel, killAll } = require('./convert');
const dl = require('./download');

app.setAppUserModelId('com.mediaflow.studio'); // required for Windows notifications
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
const progress = (e, id) => (p) => e.sender.send('progress', { id, p });
ipcMain.handle('convert', (e, { id, src, target, outDir }) => convert(src, target, outDir, progress(e, id), id));
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

app.whenReady().then(createWindow);
app.on('before-quit', () => { killAll(); dl.cancel(); }); // don't leave orphan ffmpeg / yt-dlp processes running
app.on('window-all-closed', () => app.quit());
