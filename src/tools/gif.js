// GIF & Stickers: a video passage → GIF (palette made for the clip, no grain) or animated WebP.
// A queue tool; the engine is src/gif.js.
(() => {
  const I = App.icons, { t } = I18n, F = App.fmt;
  Tools.gif = QueueTool({
    id: 'gif', icon: I.gif,
    label: 'gif.label', subtitle: 'gif.subtitle', go: 'gif.go', notify: 'gif.notify',
    hero: {
      cards: ['video', 'image', 'video'], title: 'gif.hero',
      groups: [['video', 'gif.g.in', 'MP4 · MOV · MKV · WebM'], ['image', 'gif.g.out', 'GIF · WebP'], ['audio', 'gif.g.quality', 'gif.g.qualityList', 'sparkles']],
    },
    accept: (info) => info.kind === 'video',
    targets: () => ['gif', 'webp'],
    targetLabel: (x) => t(`gif.t.${x}`),
    defaultTarget: (it, last) => (it.targets.includes(last) ? last : 'gif'),
    options: [
      { id: 'start', label: 'gif.start', type: 'text', value: '0:00', placeholder: '0:00' },
      { id: 'length', label: 'gif.length', type: 'select', value: '5',
        choices: [['3', '3 s'], ['5', '5 s'], ['10', '10 s'], ['15', '15 s'], ['30', '30 s'], ['0', 'gif.length.all']] },
      { id: 'fps', label: 'gif.fps', type: 'select', value: '15', choices: [['10', '10 fps'], ['12', '12 fps'], ['15', '15 fps'], ['20', '20 fps'], ['24', '24 fps'], ['30', '30 fps']] },
      { id: 'height', label: 'gif.size', type: 'select', value: '480', choices: [['240', '240p'], ['360', '360p'], ['480', '480p'], ['720', '720p'], ['source', 'adv.source']] },
      { id: 'loop', label: 'gif.loop', type: 'toggle', value: '1' },
    ],
    // The passage each file will give, checked against its length.
    hints(it, p, o) {
      const start = F.parseTc(o.start);
      if (start == null || (p.duration && start >= p.duration)) return [{ text: t('gif.startBad') }];
      const end = Number(o.length) ? Math.min(p.duration || Infinity, start + Number(o.length)) : p.duration;
      return end ? [{ text: `${F.tc(start)} → ${F.tc(end)}`, pro: true }] : [];
    },
    run({ id, src, target, outDir, options: o }) {
      const start = F.parseTc(o.start);
      if (start == null) return Promise.reject(new Error('BAD_RANGE'));
      return window.api.gif({ id, src, outDir, options: { format: target, start, length: o.length, fps: o.fps, height: o.height, loop: o.loop } });
    },
  });
})();
