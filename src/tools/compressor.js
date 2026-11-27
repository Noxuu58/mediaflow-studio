// Compressor: videos that fit a size limit (Discord, e-mail, web), as sharp as that size allows.
// A queue tool (see queue.js); each file picks its target size, the engine is src/compress.js (two passes).
(() => {
  const I = App.icons, { t } = I18n, F = App.fmt;
  // Sizes are decimal MB (src/compress.js keeps the file ≤ N × 10^6 bytes): 20 MB ≈ 19.07 MiB, under Discord's
  // 20 MB limit whichever way it is counted.
  const SIZES = { '@8': 8, '@20': 20, '@25': 25, '@50': 50, '@100': 100 };
  const sizeOf = (target, o) => SIZES[target] ?? Number(String(o.customSize || '').replace(',', '.'));

  Tools.compress = QueueTool({
    id: 'compress', icon: I.compress,
    label: 'cmp.label', subtitle: 'cmp.subtitle', go: 'cmp.go', notify: 'cmp.notify',
    hero: {
      cards: ['video', 'video', 'video'], title: 'cmp.hero',
      groups: [['video', 'cmp.g.targets', 'cmp.g.targetsList', 'compress'], ['audio', 'cmp.g.how', 'cmp.g.howList', 'sliders'], ['image', 'cmp.g.out', 'MP4 · H.264 · AAC', 'video']],
    },
    accept: (info) => info.kind === 'video',
    targets: () => [...Object.keys(SIZES), '@custom'],
    targetLabel: (x) => t(`cmp.t.${x.slice(1)}`),
    defaultTarget: (it, last) => (it.targets.includes(last) ? last : '@20'),
    allowSame: true,
    options: [{ id: 'customSize', label: 'cmp.custom', type: 'text', value: '15', placeholder: '15', unit: 'unit.mb' }],
    shownOptions: (list) => new Set(list.some((it) => it.target === '@custom') ? ['customSize'] : []),
    // The video bitrate this size leaves (same budget as src/compress.js: 3 % for the container, 128 kb/s of audio).
    hints(it, p, o) {
      if (!p.duration) return [];
      const mb = sizeOf(it.target, o);
      if (!(mb >= 1 && mb <= 4000)) return [{ text: t('cmp.badSize') }];
      const budget = (mb * 1e6 * 8 * 0.97) / p.duration / 1000 - (p.audio ? 128 : 0);
      if (budget < 80) return [{ text: t('cmp.tooSmall') }];
      const kbps = Math.min(budget, p.bitrate ? Math.max(80, p.bitrate / 1000) : Infinity); // never more than the source has
      return [{ text: `≈ ${kbps >= 1000 ? `${F.num(kbps / 1000, 1)} Mb/s` : `${Math.round(kbps)} kb/s`}`, pro: true, tip: t('cmp.hintTip') }];
    },
    run: ({ id, src, target, outDir, options }) => window.api.compress({ id, src, outDir, size: sizeOf(target, options) }),
  });
})();
