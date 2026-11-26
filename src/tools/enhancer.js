// AI Enhance: two modes on the GPU — Upscaling (Real-ESRGAN) and Interpolation (RIFE).
// A queue tool (see queue.js); the AI stage itself lives in src/ai.js, driven by the 'upscale' / 'interpolate'
// presets of src/convert.js with the target taken from the options below.
(() => {
  const I = App.icons, { t } = I18n;
  Tools.enhance = QueueTool({
    id: 'enhance', icon: I.sparkles,
    label: 'enh.label', subtitle: 'enh.subtitle', go: 'enh.go', notify: 'enh.notify',
    hero: {
      cards: ['image', 'video', 'audio'], title: 'enh.hero',
      groups: [['image', 'preset.upscale', 'enh.upList', 'screen'], ['video', 'preset.interpolate', 'enh.interpList', 'video'], ['audio', 'enh.local', 'enh.localList', 'sparkles']],
    },
    presets: [
      { id: '@upscale', icon: I.screen },
      { id: '@interpolate', icon: I.video },
    ],
    // Videos: both modes. Images: Upscaling only (×2 / ×3 / ×4, saved in their own format).
    accept: (info) => info.kind === 'video' || info.kind === 'image',
    targets: (info) => (info.kind === 'image' ? ['@upscale'] : ['@upscale', '@interpolate']),
    defaultTarget: (it, last) => (it.targets.includes(last) ? last : '@upscale'),
    allowSame: true,
    options: [
      { section: 'enh.status', sub: 'enh.statusSub', icon: 'sparkles', status: 'ai-status' },
      { id: 'aiHeight', label: 'enh.res', type: 'select', value: '1080',
        choices: [['720', '720p (HD)'], ['1080', '1080p (Full HD)'], ['1440', '1440p (2K)'], ['2160', '2160p (4K)']] },
      { id: 'aiScale', label: 'enh.scale', type: 'select', value: '4', choices: [['2', '×2'], ['3', '×3'], ['4', '×4']] },
      // Real-ESRGAN x4plus (real footage) first: the anime model barely changes filmed video.
      { id: 'aiModel', label: 'adv.ai.model', type: 'select', value: 'quality', choices: [['quality', 'adv.ai.quality'], ['fast', 'adv.ai.fast']] },
      { id: 'aiFps', label: 'enh.fps', type: 'select', value: '60', choices: [['24', '24'], ['25', '25'], ['30', '30'], ['50', '50'], ['60', '60'], ['120', '120'], ['180', '180'], ['240', '240']] },
    ],
    // Only the settings that apply to the files in the queue: video size for videos in Upscaling, ×2/×3/×4 for
    // images, the frame rate for videos in Interpolation, and the AI model for anything upscaled.
    shownOptions: (list) => {
      const img = (it) => it.kind === 'image', up = list.filter((it) => it.target === '@upscale');
      return new Set([
        up.some((it) => !img(it)) && 'aiHeight', up.some(img) && 'aiScale', up.length && 'aiModel',
        list.some((it) => it.target === '@interpolate') && 'aiFps',
      ].filter(Boolean));
    },
    // What each file will become, checked against its own size / frame rate before anything runs.
    hints: (it, p, o) => {
      if (!p.video) return [];
      if (it.kind === 'image') {
        const w = p.video.width * o.aiScale, h = p.video.height * o.aiScale, big = Math.max(w, h) > 16383; // ai.MAX_SIDE
        return [{ text: `→ ${w}×${h}`, pro: !big, tip: big ? I18n.error({ message: 'IMAGE_TOO_BIG:16383' }) : t('enh.outSize') }];
      }
      const turned = Math.abs(p.video.rotation || 0) % 180 === 90;
      const h = turned ? p.video.width : p.video.height, fps = p.video.baseFps || p.video.fps;
      if (it.target === '@upscale') {
        const to = Number(o.aiHeight);
        return [{ text: `${h}p → ${to}p · ${t(to > h ? 'enh.hintUp' : 'enh.hintRestore')}`, pro: true, tip: t('enh.statusSub') }];
      }
      const to = Number(o.aiFps), same = to <= fps + 0.01;
      return [{ text: same ? t('enh.hintFpsLow', { v: +fps.toFixed(2) }) : `${+fps.toFixed(2)} → ${to} fps`, pro: !same }];
    },
    // Each mode only uses its own target: resolution for Upscaling, frame rate for Interpolation.
    run: ({ id, src, target, outDir, options }) => window.api.convert({
      id, src, target, outDir,
      advanced: target !== '@upscale' ? { aiFps: options.aiFps }
        : /\.(png|jpe?g|webp)$/i.test(src) ? { aiScale: options.aiScale, aiModel: options.aiModel }
          : { aiHeight: options.aiHeight, aiModel: options.aiModel },
    }),
    // Show which GPU runs the AI (tested once, ≈1 s). Without a usable Vulkan GPU, a callout explains why and
    // offers the driver download + Settings. Re-checked when the AI graphics card is changed in Settings.
    onMount(root) {
      const chip = root.querySelector('.ai-status');
      const alert = document.createElement('div');
      alert.className = 'ai-alert';
      alert.hidden = true;
      root.prepend(alert); // above the drop zone and the queue: visible before any file is added
      const check = async () => {
        chip.className = 'chip ai-status';
        chip.textContent = t('ai.checking');
        await App.prefsReady;
        const [a, hw] = await Promise.all([window.api.aiInfo(), window.api.hardware()]);
        chip.textContent = a.available ? t('ai.ready', { v: a.gpu || 'Vulkan' }) : t('ai.none');
        chip.classList.add(a.available ? 'ok' : 'off');
        alert.hidden = a.available;
        if (!a.available) Settings.fillHelp(alert, a.reason, hw.vendors);
      };
      check();
      addEventListener('mf-prefs', check);
    },
  });
})();
