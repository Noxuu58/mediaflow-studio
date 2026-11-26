// Main-process log file (%APPDATA%/MediaFlow Studio/logs/main.log): uncaught errors and failed jobs with the
// tail of the FFmpeg / yt-dlp / AI output, so a problem can be understood after the fact. Local only, never sent.
const fs = require('fs');
const path = require('path');

const MAX = 2 * 2 ** 20; // past 2 MB the file becomes main.old.log (one generation kept)

function text(x) {
  if (!(x instanceof Error)) return typeof x === 'string' ? x : JSON.stringify(x);
  const out = x.stack || `${x.name}: ${x.message}`;
  return x.log ? `${out}\n  ┊ ${String(x.log).trim().slice(-1500).replace(/\r?\n/g, '\n  ┊ ')}` : out;
}

// file: path, or a function returning it (app.getPath('logs') is read on first use).
function createLog(file) {
  let target = null;
  return function log(level, ...parts) {
    try {
      if (!target) {
        target = typeof file === 'function' ? file() : file;
        fs.mkdirSync(path.dirname(target), { recursive: true });
      }
      if ((fs.statSync(target, { throwIfNoEntry: false })?.size || 0) > MAX) fs.renameSync(target, target.replace(/\.log$/, '.old.log'));
      fs.appendFileSync(target, `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${parts.map(text).join(' ')}\n`);
    } catch {} // logging must never break the app
  };
}

module.exports = { createLog };
