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
    accept: (info) => info.kind === 'video',
    targets: () => ['@upscale', '@interpolate'],
    defaultTarget: (it, last) => (it.targets.includes(last) ? last : '@upscale'),
    allowSame: true,
    options: [
      { section: 'enh.status', sub: 'enh.statusSub', icon: 'sparkles', status: 'ai-status' },
      { id: 'aiHeight', label: 'enh.res', type: 'select', value: '1080',
        choices: [['720', '720p (HD)'], ['1080', '1080p (Full HD)'], ['1440', '1440p (2K)'], ['2160', '2160p (4K)']] },
      { id: 'aiFps', label: 'enh.fps', type: 'select', value: '60', choices: [['24', '24'], ['25', '25'], ['30', '30'], ['50', '50'], ['60', '60'], ['120', '120'], ['180', '180'], ['240', '240']] },
      { id: 'aiModel', label: 'adv.ai.model', type: 'select', value: 'fast', choices: [['fast', 'adv.ai.fast'], ['quality', 'adv.ai.quality']] },
    ],
    // Each mode only uses its own target: resolution for Upscaling, frame rate for Interpolation.
    run: ({ id, src, target, outDir, options }) => window.api.convert({
      id, src, target, outDir,
      advanced: target === '@upscale' ? { aiHeight: options.aiHeight, aiModel: options.aiModel } : { aiFps: options.aiFps },
    }),
    // Show which GPU runs the AI (tested once, ≈1 s); without a Vulkan GPU the tool says so.
    onMount(root) {
      const chip = root.querySelector('.ai-status');
      chip.textContent = t('ai.checking');
      window.api.aiInfo().then((a) => {
        chip.textContent = a.available ? t('ai.ready', { v: a.gpu || 'Vulkan' }) : t('ai.none');
        chip.classList.add(a.available ? 'ok' : 'off');
      });
    },
  });
})();
