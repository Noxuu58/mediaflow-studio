// Converter: any supported media → another format, per-file choice (see queue.js for the config shape).
Tools.convert = QueueTool({
  id: 'convert', icon: App.icons.convert,
  label: 'conv.label', subtitle: 'conv.subtitle', go: 'conv.go', notify: 'conv.notify',
  hero: {
    cards: ['image', 'video', 'audio'], title: 'conv.hero',
    groups: [['image', 'kind.image', 'PNG · JPG · WebP'], ['audio', 'kind.audio', 'MP3 · WAV · FLAC · M4A · OGG'], ['video', 'kind.video', 'MP4 · MKV · MOV · WebM · AVI']],
  },
  accept: () => true,
  targets: (info) => info.targets,
  defaultTarget(it) {
    const e = App.fmt.ext(it.path);
    const pref = { webp: 'png', png: 'webp', jpg: 'png', jpeg: 'png', mp3: 'wav', mp4: 'mp3' }[e]
      || (it.kind === 'video' ? 'mp4' : it.kind === 'audio' ? 'mp3' : 'png');
    const differs = (x) => x !== e && !(e === 'jpeg' && x === 'jpg');
    return it.targets.find((x) => x === pref && differs(x)) || it.targets.find(differs);
  },
  run: (job) => window.api.convert(job),
});
