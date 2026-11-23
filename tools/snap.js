// Dev helper: drives the real app offscreen and saves screenshots of each state.
//   electron tools/snap.js icon <out.png>                    render build/icon.svg
//   electron tools/snap.js tour <prefix> <en|fr>             empty state of every tool, in one language
//   electron tools/snap.js convert <prefix> <files...>       queue → running → done → collapsed sidebar (+ sound check)
//   electron tools/snap.js extract <prefix> <files...>       queue with cleanup options → done
//   electron tools/snap.js trim <prefix> <file>              loaded → selection → exporting → done
//   electron tools/snap.js download <prefix> <url>           analyze → preview → downloading → done → yt-dlp missing
// Page errors and warnings are printed, so a broken script never hides behind a nice screenshot.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const [mode, out, ...args] = process.argv.slice(2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// A test window covered by other windows stops painting on Windows; keep it rendering for captures.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.on('web-contents-created', (_e, wc) => wc.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') console.log(`[page ${e.level}] ${e.message}`); }));

if (mode === 'installer-art') {
  // NSIS wants 24-bit BMPs of exact sizes: render the HTML, then convert with the bundled FFmpeg.
  const { FFMPEG } = require('../src/convert');
  const { execFileSync } = require('child_process');
  app.whenReady().then(async () => {
    for (const [part, w, h] of [['sidebar', 164, 314], ['header', 150, 57]]) {
      const win = new BrowserWindow({ width: w, height: h, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
      await win.loadFile(path.join(__dirname, '..', 'build', 'installer-art.html'), { hash: part });
      await wait(500);
      const png = path.join(__dirname, '..', 'build', `installer-${part}.png`);
      fs.writeFileSync(png, (await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h })).resize({ width: w, height: h }).toPNG());
      const bmp = path.join(__dirname, '..', 'build', `installer${part[0].toUpperCase()}${part.slice(1)}.bmp`);
      execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', png, '-pix_fmt', 'bgr24', bmp]);
      fs.rmSync(png);
      console.log(path.basename(bmp), fs.statSync(bmp).size, 'bytes');
    }
    app.quit();
  });
} else if (mode === 'icon') {
  app.whenReady().then(async () => {
    const w = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', webPreferences: { offscreen: true } });
    await w.loadFile(path.join(__dirname, '..', 'build', 'icon.svg'));
    await wait(300);
    fs.writeFileSync(out, (await w.webContents.capturePage()).toPNG());
    app.quit();
  });
} else {
  require('../src/main.js');
  app.on('browser-window-created', (_e, w) => w.webContents.once('did-finish-load', async () => {
    const js = (s) => w.webContents.executeJavaScript(s);
    const save = async (name) => { w.webContents.invalidate(); await wait(120); fs.writeFileSync(`${out}-${name}.png`, (await w.webContents.capturePage()).toPNG()); };
    const until = (cond) => js(`new Promise((r) => { const t = setInterval(() => { if (${cond}) { clearInterval(t); r(); } }, 150); })`);
    const go = (id) => js(`document.querySelector('#nav [data-id=${id}]').click()`);
    const rows = () => js(`[...document.querySelectorAll('.tool:not([hidden]) .row')].map((r) => r.className + ' | ' + r.querySelector('.spec').textContent).join('\\n')`);
    const reload = async () => { const done = new Promise((r) => w.webContents.once('did-finish-load', r)); w.webContents.reload(); await done; await wait(700); };
    try {
      if (mode === 'tour') {
        await js(`localStorage.setItem('lang', ${JSON.stringify(args[0])})`);
        await reload();
        for (const id of ['convert', 'download', 'trim', 'extract']) {
          await go(id); await wait(900); await save(id);
          console.log(id, '→', await js(`document.querySelector('h1').textContent + ' | ' + document.querySelector('.tool:not([hidden])').innerText.replace(/\\s+/g, ' ').slice(0, 90)`));
        }
        await js(`localStorage.removeItem('lang'); localStorage.setItem('tool', 'convert')`);
      } else if (mode === 'convert') {
        await go('convert'); await wait(600);
        await js(`Tools.convert.addFiles(${JSON.stringify(args)})`);
        await wait(2500); await save('1-queue');
        await js(`const s = document.querySelector('.tool-convert .row select'); s.value = 'webm'; s.onchange({ target: s }); Tools.convert.runAll(); 0`);
        await wait(4000); await save('2-running');
        await until(`document.querySelector('.tool-convert .stop').hidden`);
        await wait(700); await save('3-done');
        await js(`document.querySelector('#collapse').click()`); await wait(800); await save('4-collapsed');
        await js(`document.querySelector('#collapse').click()`);
        console.log(await rows());
        console.log('sfx peaks', JSON.stringify(await js('Sfx.peaks()')));
        console.log('live audio', await js(`(Sfx.play('tap'), 'ok')`));
      } else if (mode === 'extract') {
        await go('extract'); await wait(700); await save('1-empty');
        await js(`Tools.extract.addFiles(${JSON.stringify(args)})`);
        await wait(1500);
        await js(`const s = document.querySelector('.opts select'); s.value = '-14'; s.onchange(); document.querySelector('.opts [data-opt=denoise]').click()`);
        await wait(600); await save('2-queue');
        await js('Tools.extract.runAll()');
        await wait(700); await save('3-done');
        console.log(await rows());
        await js(`['extract.loudness', 'extract.denoise'].forEach((k) => localStorage.removeItem(k))`);
      } else if (mode === 'trim') {
        await go('trim'); await wait(700); await save('1-empty');
        await js(`Tools.trim.open(${JSON.stringify(args.slice(0, 1))})`);
        await until(`!document.querySelector('.tl').classList.contains('loading')`);
        await wait(900); await save('2-loaded');
        await js(`Tools.trim.setIn(8); Tools.trim.setOut(24); Tools.trim.seek(13.5); 0`);
        await wait(700); await save('3-selection');
        await js(`document.querySelector('.tool-trim .seg [data-mode=precise]').click(); Tools.trim.exportClip(); 0`);
        await wait(1500); await save('4-exporting');
        await until(`document.querySelector('.tool-trim .stop').hidden`);
        await wait(600); await save('5-done');
        console.log('status', await js(`document.querySelector('#toast').textContent`));
        console.log('controls', await js(`['.go', '.last', '.stop'].map((s) => s + (document.querySelector('.tool-trim ' + s).hidden ? ' hidden' : ' visible')).join(', ') + ' | mode ' + document.querySelector('.tool-trim .seg .on').dataset.mode`));
        await js(`localStorage.removeItem('trim.precise')`);
      } else if (mode === 'download') {
        await go('download'); await until(`document.querySelector('#ytdlp-ver').textContent`);
        await wait(500); await save('1-empty');
        js(`Tools.download.analyze(${JSON.stringify(args[0])})`);
        await wait(500); await save('2-analyzing');
        await until(`document.querySelector('.dl-preview.ready, .dl-preview.error')`);
        await wait(1200); await save('3-preview');
        await js('Tools.download.start()');
        await until(`(parseInt(document.querySelector('.row.run .pct')?.textContent) > 5) || document.querySelector('.tool-download .row.done, .tool-download .row.error')`);
        await save('4-running');
        await until(`document.querySelector('.tool-download .row.done, .tool-download .row.error')`);
        await wait(800); await save('5-done');
        console.log(await rows());
        await js(`localStorage.setItem('ytdlp', 'C:/missing/yt-dlp.exe'); document.querySelector('#dl-recheck').click()`);
        await wait(1500); await save('6-missing');
        await js(`localStorage.removeItem('ytdlp')`);
      }
      await js(`localStorage.setItem('tool', 'convert')`);
    } catch (e) { console.log('[snap error]', e.message); }
    app.quit();
  }));
}
