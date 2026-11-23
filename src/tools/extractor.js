// Audio Extractor: first audio track of videos (or audio files) → clean audio file, with optional
// loudness normalization, noise reduction and low-cut (see queue.js for the config shape).
Tools.extract = QueueTool({
  id: 'extract', icon: App.icons.extract,
  label: 'ext.label', subtitle: 'ext.subtitle', go: 'ext.go', notify: 'ext.notify',
  hero: {
    cards: ['video', 'audio', 'video'], title: 'ext.hero',
    groups: [['video', 'ext.in', 'MP4 · MKV · MOV · WebM · AVI'], ['audio', 'ext.out', 'WAV · MP3 · FLAC · M4A'], ['image', 'ext.clean', 'ext.cleanList']],
  },
  accept: (info) => info.kind === 'video' || info.kind === 'audio',
  targets: () => ['wav', 'mp3', 'flac', 'm4a'],
  defaultTarget: (it, last) => (it.targets.includes(last) ? last : 'wav'), // WAV: what editors import without a second thought
  allowSame: true, // re-exporting a WAV with normalization is a valid use
  options: [
    { id: 'loudness', label: 'ext.loudness', type: 'select', value: '',
      choices: [['', 'ext.loud.off'], ['-14', 'ext.loud.14'], ['-16', 'ext.loud.16'], ['-23', 'ext.loud.23']] },
    { id: 'denoise', label: 'ext.denoise', type: 'toggle', value: '0' },
    { id: 'lowcut', label: 'ext.lowcut', type: 'toggle', value: '0' },
  ],
  run: ({ id, src, target, outDir, options }) => window.api.extract({ id, src, outDir, options: { ...options, format: target } }),
});
