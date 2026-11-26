// Converter: one-click presets (Simple mode) or any format, with Pro settings in the Advanced panel.
// Presets and their technical settings live in src/convert.js (PRESETS); see queue.js for the config shape.
(() => {
  const I = App.icons, { t } = I18n, F = App.fmt;
  const PRESETS = ['@tiktok', '@youtube', '@proxy', '@audio'];
  const sel = (id, label, choices) => ({ id, label, type: 'select', value: 'auto', choices: [['auto', 'adv.auto'], ...choices] });

  // ---- Personal presets: the Advanced settings under a name, kept in this window and shared as .json files
  // (checked by the main process, src/presets.js).
  const MINE = 'convert.mine';
  const mine = () => { try { const v = JSON.parse(App.store.get(MINE)); return Array.isArray(v) ? v : []; } catch { return []; } };
  const keep = (list) => App.store.set(MINE, JSON.stringify(list));
  const merge = (list, add) => [...list.filter((p) => !add.some((a) => a.name === p.name)), ...add];

  function presetBar(root) {
    const bar = Object.assign(document.createElement('div'), { className: 'mine', title: t('pre.tip') });
    root.querySelector('.adv-head').append(bar);
    const draw = (picked = '') => {
      const list = mine();
      bar.innerHTML = `
        <select class="mine-pick" aria-label="${F.esc(t('pre.mine'))}"><option value="">${F.esc(t('pre.pick'))}</option>
          ${list.map((p, i) => `<option value="${i}"${p.name === picked ? ' selected' : ''}>${F.esc(p.name)}</option>`).join('')}</select>
        <input class="mine-name tcode" type="text" maxlength="60" spellcheck="false" placeholder="${F.esc(t('pre.name'))}" aria-label="${F.esc(t('pre.name'))}" hidden>
        <button class="ghost sm mine-save" type="button">${I.plus}${t('pre.save')}</button>
        <button class="icon mine-del" type="button" title="${F.esc(t('pre.delete'))}" aria-label="${F.esc(t('pre.delete'))}"${picked ? '' : ' disabled'}>${I.x}</button>
        <button class="ghost sm mine-import" type="button">${t('pre.import')}</button>
        <button class="ghost sm mine-export" type="button"${list.length ? '' : ' disabled'}>${t('pre.export')}</button>`;
      const pick = bar.querySelector('.mine-pick'), name = bar.querySelector('.mine-name');
      pick.onchange = () => {
        const p = list[pick.value];
        bar.querySelector('.mine-del').disabled = !p;
        if (!p) return;
        Tools.convert.setAdvanced(p.options);
        App.toast(t('pre.applied', { name: p.name }));
      };
      const commit = () => {
        const n = name.value.trim();
        name.hidden = true;
        if (!n) return;
        const options = Object.fromEntries(Object.entries(Tools.convert.advancedValues()).filter(([, v]) => v && v !== 'auto'));
        keep(merge(mine(), [{ name: n, options }]));
        draw(n);
        App.toast(t('pre.saved', { name: n }));
      };
      bar.querySelector('.mine-save').onclick = () => {
        if (name.hidden) { name.hidden = false; name.value = list[pick.value]?.name || ''; name.focus(); } else commit();
      };
      name.onkeydown = (e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') { e.stopPropagation(); name.hidden = true; }
      };
      bar.querySelector('.mine-del').onclick = () => { keep(list.filter((_, i) => String(i) !== pick.value)); draw(); };
      bar.querySelector('.mine-import').onclick = async () => {
        try {
          const add = await window.api.presets.import();
          if (!add) return;
          keep(merge(mine(), add));
          draw(add.length === 1 ? add[0].name : '');
          App.toast(t('pre.imported', { n: add.length }));
        } catch (e) { App.toast(I18n.error(e), true); }
      };
      bar.querySelector('.mine-export').onclick = async () => {
        try { if (await window.api.presets.export(mine())) App.toast(t('pre.exported')); } catch (e) { App.toast(I18n.error(e), true); }
      };
    };
    draw();
  }

  Tools.convert = QueueTool({
    id: 'convert', icon: I.convert,
    label: 'conv.label', subtitle: 'conv.subtitle', go: 'conv.go', notify: 'conv.notify',
    hero: {
      cards: ['image', 'video', 'audio'], title: 'conv.hero',
      groups: [['image', 'kind.image', 'PNG · JPG · WebP'], ['audio', 'kind.audio', 'MP3 · WAV · FLAC · M4A · OGG'], ['video', 'kind.video', 'MP4 · MKV · MOV · WebM · AVI']],
    },
    presets: [
      { id: '@tiktok', icon: I.phone },
      { id: '@youtube', icon: I.screen },
      { id: '@proxy', icon: I.layers },
      { id: '@audio', icon: I.audio },
    ],
    showGpu: true,
    accept: () => true,
    targets: (info) => (info.kind === 'video' ? [...PRESETS, ...info.targets] : info.kind === 'audio' ? ['@audio', ...info.targets] : info.targets),
    defaultTarget(it, last) {
      if (it.targets.includes(last)) return last; // the editor's last choice wins
      const e = App.fmt.ext(it.path);
      if (it.kind === 'video') return '@youtube';
      const pref = { webp: 'png', png: 'webp', jpg: 'png', jpeg: 'png', mp3: 'wav' }[e] || (it.kind === 'audio' ? 'mp3' : 'png');
      const differs = (x) => x !== e && !(e === 'jpeg' && x === 'jpg') && !x.startsWith('@');
      return it.targets.find((x) => x === pref && differs(x)) || it.targets.find(differs);
    },
    // Friendly warning in Simple mode; technical tags only in Advanced mode.
    hints(it, p) {
      const v = p.video, out = [];
      if (v?.vfr) out.push({ text: t('hint.vfr'), tip: t('hint.vfrTip') });
      if (v?.hdr) out.push({ text: 'HDR', tip: v.color.transfer, pro: true });
      if (v && v.depth > 8) out.push({ text: t('hint.bits', { n: v.depth }), pro: true });
      if (p.audios?.length > 1) out.push({ text: t('hint.tracks', { n: p.audios.length }), pro: true });
      if (p.timecode) out.push({ text: `TC ${p.timecode}`, pro: true });
      return out;
    },
    advanced: [
      sel('codec', 'adv.codec', [['h264', 'H.264'], ['hevc', 'HEVC (H.265)'], ['prores_proxy', 'ProRes 422 Proxy'], ['prores_lt', 'ProRes 422 LT'],
        ['prores', 'ProRes 422'], ['prores_hq', 'ProRes 422 HQ'], ['dnxhr_lb', 'DNxHR LB'], ['dnxhr_sq', 'DNxHR SQ'], ['dnxhr_hq', 'DNxHR HQ'], ['dnxhr_hqx', 'DNxHR HQX (10-bit)']]),
      sel('container', 'adv.container', [['mp4', 'MP4'], ['mov', 'MOV'], ['mkv', 'MKV'], ['mxf', 'MXF']]),
      sel('depth', 'adv.depth', [['8', 'adv.bits.8'], ['10', 'adv.bits.10']]),
      sel('fps', 'adv.fps', [['fix', 'adv.fps.fix'], ['keep', 'adv.fps.keep'], ['24', '24'], ['25', '25'], ['30', '30'], ['50', '50'], ['60', '60']]),
      sel('height', 'adv.height', [['source', 'adv.source'], ['2160', '2160p (4K)'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p']]),
      sel('audio', 'adv.audio', [['aac192', 'AAC 192 kb/s'], ['aac320', 'AAC 320 kb/s'], ['pcm16', 'adv.pcm16'], ['pcm24', 'adv.pcm24'], ['copy', 'adv.copy']]),
      sel('tracks', 'adv.tracks', [['first', 'adv.tracks.first'], ['all', 'adv.tracks.all'], ['mix', 'adv.tracks.mix']]),
      sel('gpu', 'adv.gpu', [['on', 'adv.on'], ['off', 'adv.gpu.off']]),
    ], // AI upscaling / interpolation has its own tool: tools/enhancer.js
    onMount: presetBar,
    run: ({ id, src, target, outDir, options }) => window.api.convert({ id, src, target, outDir, advanced: options }),
  });
})();
