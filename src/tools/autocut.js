// Auto-Cut: removes the silences of rushes, podcasts and tutorials — the cut file, or a timeline (XML / EDL) that
// Premiere Pro and DaVinci Resolve open with every cut in place. A queue tool; the engine is src/silence.js.
(() => {
  const I = App.icons, { t } = I18n;
  Tools.autocut = QueueTool({
    id: 'autocut', icon: I.silence,
    label: 'cut.label', subtitle: 'cut.subtitle', go: 'cut.go', notify: 'cut.notify',
    hero: {
      cards: ['video', 'audio', 'video'], title: 'cut.hero',
      groups: [['video', 'cut.g.in', 'MP4 · MOV · MKV · WAV · MP3'], ['audio', 'cut.g.how', 'cut.g.howList', 'silence'], ['image', 'cut.g.out', 'cut.g.outList', 'layers']],
    },
    accept: (info) => info.kind === 'video' || info.kind === 'audio',
    targets: () => ['@cut', '@xml', '@edl'],
    targetLabel: (x) => t(`cut.t.${x.slice(1)}`),
    defaultTarget: (it, last) => (it.targets.includes(last) ? last : '@cut'),
    allowSame: true,
    options: [
      { id: 'noise', label: 'cut.noise', type: 'select', value: '-30',
        choices: [['-20', 'cut.noise.20'], ['-25', '-25 dB'], ['-30', 'cut.noise.30'], ['-35', '-35 dB'], ['-40', '-40 dB'], ['-50', 'cut.noise.50']] },
      { id: 'min', label: 'cut.min', type: 'select', value: '0.6',
        choices: [['0.3', '0.3 s'], ['0.5', '0.5 s'], ['0.6', '0.6 s'], ['0.8', '0.8 s'], ['1', '1 s'], ['1.5', '1.5 s'], ['2', '2 s']] },
      { id: 'pad', label: 'cut.pad', type: 'select', value: '0.1',
        choices: [['0', 'cut.pad.0'], ['0.05', '0.05 s'], ['0.1', '0.1 s'], ['0.2', '0.2 s'], ['0.3', '0.3 s']] },
    ],
    hints: (it, p) => (p.audios?.length ? [] : [{ text: t('cut.noAudio') }]),
    run: ({ id, src, target, outDir, options }) => window.api.autocut({ id, src, outDir, target: target.slice(1), options }),
  });
})();
