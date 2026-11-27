// GIF & Stickers: a video passage → GIF (palette made for the clip, no grain) or animated WebP — or a still image
// (PNG / JPEG / WebP) brought to life with a looping motion, for stickers. A queue tool; the engine is src/gif.js.
(() => {
  const I = App.icons, { t } = I18n, F = App.fmt;
  Tools.gif = QueueTool({
    id: 'gif', icon: I.gif,
    label: 'gif.label', subtitle: 'gif.subtitle', go: 'gif.go', notify: 'gif.notify',
    hero: {
      cards: ['video', 'image', 'video'], title: 'gif.hero',
      groups: [['video', 'gif.g.in', 'MP4 · MOV · PNG · JPG · WebP'], ['image', 'gif.g.out', 'GIF · WebP'], ['audio', 'gif.g.quality', 'gif.g.qualityList', 'sparkles']],
    },
    accept: (info) => info.kind === 'video' || info.kind === 'image',
    targets: () => ['gif', 'webp'],
    targetLabel: (x) => t(`gif.t.${x}`),
    defaultTarget: (it, last) => (it.targets.includes(last) ? last : 'gif'),
    allowSame: true, // a still WebP can become an animated WebP
    options: [
      { id: 'start', label: 'gif.start', type: 'text', value: '0:00', placeholder: '0:00' },
      { id: 'length', label: 'gif.length', type: 'select', value: '5',
        choices: [['3', '3 s'], ['5', '5 s'], ['10', '10 s'], ['15', '15 s'], ['30', '30 s'], ['0', 'gif.length.all']] },
      // Still images: how the picture moves, and how long one loop lasts.
      { id: 'style', label: 'gif.style', type: 'select', value: 'bounce',
        choices: ['bounce', 'float', 'pulse', 'sway', 'shake', 'spin', 'sparkle'].map((x) => [x, `gif.style.${x}`]) },
      { id: 'seconds', label: 'gif.seconds', type: 'select', value: '2', choices: [['1', '1 s'], ['2', '2 s'], ['3', '3 s'], ['4', '4 s'], ['6', '6 s']] },
      { id: 'fps', label: 'gif.fps', type: 'select', value: '15', choices: [['10', '10 fps'], ['12', '12 fps'], ['15', '15 fps'], ['20', '20 fps'], ['24', '24 fps'], ['30', '30 fps']] },
      { id: 'height', label: 'gif.size', type: 'select', value: '480', choices: [['240', '240p'], ['320', 'gif.size.sticker'], ['360', '360p'], ['480', '480p'], ['720', '720p'], ['source', 'adv.source']] },
      { id: 'loop', label: 'gif.loop', type: 'toggle', value: '1' },
    ],
    // Only the settings the files use: start / length for videos, motion / loop length for images.
    shownOptions(list) {
      const has = (k) => list.some((it) => it.kind === k);
      return new Set(['fps', 'height', 'loop', ...(has('video') ? ['start', 'length'] : []), ...(has('image') ? ['style', 'seconds'] : [])]);
    },
    // The passage each video will give (checked against its length); the motion each image will get.
    hints(it, p, o) {
      if (it.kind === 'image') return [{ text: `${t(`gif.style.${o.style}`)} · ${o.seconds} s`, pro: true }];
      const start = F.parseTc(o.start);
      if (start == null || (p.duration && start >= p.duration)) return [{ text: t('gif.startBad') }];
      const end = Number(o.length) ? Math.min(p.duration || Infinity, start + Number(o.length)) : p.duration;
      return end ? [{ text: `${F.tc(start)} → ${F.tc(end)}`, pro: true }] : [];
    },
    run({ id, src, target, outDir, options: o }) {
      const loop = { format: target, fps: o.fps, height: o.height, loop: o.loop };
      if (/\.(png|jpe?g|webp)$/i.test(src)) return window.api.gif({ id, src, outDir, options: { ...loop, style: o.style, seconds: o.seconds } });
      const start = F.parseTc(o.start);
      if (start == null) return Promise.reject(new Error('BAD_RANGE'));
      return window.api.gif({ id, src, outDir, options: { format: target, start, length: o.length, fps: o.fps, height: o.height, loop: o.loop } });
    },
  });
})();
