// Reusable file-queue tool: drop files, pick an output format per file, run FFmpeg jobs one at a time
// with per-file progress + ETA, a global bar, cancel, and optional processing options.
// Converter and Audio Extractor are both configs of it:
//
// QueueTool({
//   id, icon,                                         icon = svg markup
//   label, title, subtitle, go, notify,               i18n keys (go/notify get { n })
//   hero: { cards: [kind, kind, kind], title, groups: [[kind, titleKey, 'PNG · JPG', iconName?], ...] },
//   accept(info) -> bool                              which files belong here (info.kind: image|audio|video)
//   targets(info) -> ['mp3', ...]                     output formats offered for that file
//   defaultTarget(item, last) -> 'mp3'                initial choice (last = the format picked most recently)
//   allowSame                                         also offer the source's own format
//   options: [{ id, label, type: 'select'|'toggle', choices: [[value, labelKey]], value }]   always visible
//   shownOptions(items) -> Set of option ids          optional: only these options are shown (the others don't apply)
//   advanced: [same shape]                            "Advanced" panel, collapsed by default (Pro settings)
//   presets: [{ id: '@name', icon, kinds: ['video'] }] one-click bar; labels from i18n 'preset.<name>' / 'preset.<name>.sub'
//   hints(item, probe, options) -> [{ text, tip, pro }]  small tags on a row (pro ones only show in Advanced mode)
//   showGpu                                           GPU chip in the action bar
//   run({ id, src, target, outDir, options }) -> Promise<outputPath>
// })
function QueueTool(cfg) {
  const { t } = I18n, F = App.fmt, I = App.icons;
  const CODEC = { h264: 'H.264', hevc: 'HEVC', vp9: 'VP9', vp8: 'VP8', av1: 'AV1', prores: 'ProRes', mpeg4: 'MPEG-4', dnxhd: 'DNxHD',
    aac: 'AAC', mp3: 'MP3', flac: 'FLAC', opus: 'Opus', vorbis: 'Vorbis', alac: 'ALAC', ac3: 'AC-3' };
  const key = (k) => `${cfg.id}.${k}`;
  const items = new Map(); // id -> item
  let root, outDir = App.store.get(key('outDir')), busy = false, cancelled = false, nextId = 0, probeChain = Promise.resolve();
  let run = null; // { total, done, start, current } while the queue runs
  const allOptions = [...(cfg.options || []), ...(cfg.advanced || [])].filter((o) => o.id); // section headers have no id
  const opts = Object.fromEntries(allOptions.map((o) => [o.id, App.store.get(key(o.id)) ?? o.value]));
  const isPreset = (x) => x.startsWith('@');
  const label = (x) => (isPreset(x) ? t(`preset.${x.slice(1)}`) : x);
  const optionsHtml = (list) => {
    const presets = list.filter(isPreset), formats = list.filter((x) => !isPreset(x));
    const opt = (x, sel) => `<option value="${x}"${x === sel ? ' selected' : ''}>${F.esc(label(x))}</option>`;
    return (sel) => (presets.length
      ? `<optgroup label="${F.esc(t('q.presets'))}">${presets.map((x) => opt(x, sel)).join('')}</optgroup><optgroup label="${F.esc(t('q.formats'))}">${formats.map((x) => opt(x, sel)).join('')}</optgroup>`
      : formats.map((x) => opt(x, sel)).join(''));
  };
  const q = (s) => root.querySelector(s);
  const same = (a, b) => a === b || (a === 'jpeg' && b === 'jpg');
  const eta = (elapsed, p) => (p > 0.02 && elapsed > 1 ? F.clock(elapsed * (1 - p) / p) : null);

  function codec(c) {
    const pcm = /^pcm_[suf]?(\d+)/.exec(c);
    return pcm ? t('spec.pcm', { bits: pcm[1] }) : CODEC[c] || c.toUpperCase();
  }
  function spec(it, p) {
    const parts = [];
    if (it.kind === 'image') parts.push(F.ext(it.path).toUpperCase(), p.video && `${p.video.width}×${p.video.height}`);
    if (p.video && it.kind === 'video') parts.push(codec(p.video.codec), `${p.video.width}×${p.video.height}`, p.video.fps && `${+p.video.fps.toFixed(2)} ${t('spec.fps')}`);
    if (p.audio && (it.kind === 'audio' || !p.video)) parts.push(codec(p.audio.codec), `${F.num(p.audio.rate / 1000, p.audio.rate % 1000 ? 1 : 0)} kHz`,
      { stereo: t('spec.stereo'), mono: t('spec.mono') }[p.audio.layout] || p.audio.layout);
    if (p.duration && it.kind !== 'image') parts.push(F.clock(p.duration));
    parts.push(F.size(it.size));
    return parts.filter(Boolean).join(' · ');
  }

  // ---- rendering ---------------------------------------------------------------------------------
  function setState(it, state, label = '', detail = '') {
    it.state = state;
    it.el.className = `row ${state}`;
    const st = it.el.querySelector('.state');
    st.innerHTML = state === 'done'
      ? `<span class="badge ok">${I.check}${t('q.done')}</span><button class="icon reveal" type="button" title="${F.esc(t('common.reveal'))}">${I.folder}</button>`
      : `<span class="pct">${label}</span><span class="eta">${F.esc(detail)}</span>`;
    st.querySelector('.reveal')?.addEventListener('click', () => window.api.reveal(it.out));
    it.el.querySelector('select').disabled = state === 'run';
    it.el.querySelector('.remove').disabled = state === 'run';
    if (state !== 'run' && state !== 'done') it.el.querySelector('.bar i').style.width = '0%';
  }
  const waiting = (it) => setState(it, busy ? 'queued' : 'idle', t(busy ? 'q.queued' : 'q.ready'));

  function refresh() {
    const list = [...items.values()];
    root.classList.toggle('has-files', list.length > 0);
    const pending = list.filter((it) => it.state !== 'done').length;
    q('.q-count').textContent = list.length ? `${t('q.files', { n: list.length })} · ${F.size(list.reduce((a, it) => a + it.size, 0))}` : '';
    q('.go').hidden = busy;
    q('.stop').hidden = !busy;
    q('.go').disabled = !pending;
    q('.go-label').textContent = t(cfg.go, { n: pending });
    q('.clean').disabled = !list.some((it) => it.state === 'done');
    q('.clear').disabled = busy || !list.length;
    q('.dest').disabled = busy;
    q('.all').disabled = !list.length;
    const all = [...new Set(list.flatMap((it) => it.targets))];
    q('.all').innerHTML = '<option value="">—</option>' + optionsHtml(all)('');
    q('.dest-label').textContent = outDir || t('common.outputSource');
    q('.dest').title = outDir || t('common.outputTip');
    q('.dest-reset').hidden = !outDir || busy;
    q('.global').classList.toggle('on', busy);
    if (cfg.shownOptions) {
      const shown = cfg.shownOptions(list);
      q('.opts').querySelectorAll('[data-opt]').forEach((el) => { (el.closest('.opt') || el).hidden = !shown.has(el.dataset.opt); });
    }
    // A preset chip is "on" when every file it applies to uses it.
    root.querySelectorAll('.preset').forEach((b) => {
      const fits = list.filter((it) => it.targets.includes(b.dataset.preset));
      b.classList.toggle('on', fits.length > 0 && fits.every((it) => it.target === b.dataset.preset));
      b.disabled = !fits.length || busy;
    });
  }

  function applyTarget(x) {
    for (const it of items.values()) {
      const sel = it.el.querySelector('select');
      if (it.state !== 'run' && it.state !== 'done' && [...sel.options].some((o) => o.value === x)) {
        sel.value = x; sel.onchange({ target: sel });
      }
    }
  }

  function addRow(info) {
    const id = `${cfg.id}:${nextId++}`; // progress events are shared by all tools: keep ids unique
    const it = { ...info, id, name: F.base(info.path), targets: cfg.targets(info) };
    it.target = cfg.defaultTarget(it, App.store.get(key('last')));
    const el = document.createElement('div');
    const offered = it.targets.filter((x) => cfg.allowSame || !same(F.ext(it.path), x));
    el.innerHTML = `
      <div class="thumb ${it.kind}">${it.kind === 'image' ? `<img src="${F.esc(F.fileUrl(it.path))}" alt="">` : I[it.kind]}</div>
      <div class="meta">
        <div class="name" title="${F.esc(it.path)}">${F.esc(it.name)}</div>
        <div class="spec">${F.size(it.size)}</div>
        <div class="tags"></div>
      </div>
      <div class="route">
        <span class="fmt ${it.kind}">${F.ext(it.path)}</span>
        <svg class="route-arrow" viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>
        <select class="${offered.some(isPreset) ? 'wide' : ''}" aria-label="${F.esc(t('q.outFmt', { name: it.name }))}">${optionsHtml(offered)(it.target)}</select>
      </div>
      <div class="state"></div>
      <button class="icon remove" type="button" title="${F.esc(t('q.remove'))}">${I.x}</button>
      <div class="bar"><i></i></div>`;
    it.el = el;
    el.querySelector('select').onchange = (e) => {
      it.target = e.target.value;
      App.store.set(key('last'), it.target);
      if (it.state !== 'run') waiting(it);
      tags(it);
      refresh();
    };
    el.querySelector('.remove').onclick = () => {
      el.classList.add('leaving');
      if (run && it.state === 'queued') run.total--;
      items.delete(id);
      setTimeout(() => { el.remove(); refresh(); }, 280);
    };
    q('.list').append(el);
    items.set(id, it);
    waiting(it);
    if (run) run.total++;
    // Probe one file at a time so a big drop doesn't spawn dozens of ffmpeg processes.
    probeChain = probeChain.then(() => window.api.probe(it.path)).then((p) => {
      el.querySelector('.spec').textContent = spec(it, p);
      if (p.thumb) el.querySelector('.thumb').innerHTML = `<img src="${p.thumb}" alt="">`;
      it.probe = p;
      tags(it);
    }).catch(() => {});
  }

  // Hint tags under the file name (VFR, HDR, output size…); redrawn when an option they depend on changes.
  function tags(it) {
    if (!it.probe) return;
    it.el.querySelector('.tags').innerHTML = (cfg.hints?.(it, it.probe, options()) || [])
      .map((h) => `<span class="tag${h.pro ? ' pro' : ' warn'}" title="${F.esc(h.tip || '')}">${F.esc(h.text)}</span>`).join('');
  }

  async function addFiles(paths) {
    const known = new Set([...items.values()].map((it) => it.path));
    const infos = await window.api.info(paths.filter((p) => !known.has(p)));
    const added = infos.filter((i) => i.kind && cfg.accept(i));
    added.forEach(addRow);
    if (added.length) App.sfx('pop');
    const skipped = infos.length - added.length;
    if (skipped) App.toast(t('q.skipped', { n: skipped }), true);
    refresh();
  }

  // ---- the queue -----------------------------------------------------------------------------------
  function overall(p) {
    const frac = Math.min(1, (run.done + p) / Math.max(1, run.total));
    const left = eta((performance.now() - run.start) / 1000, frac);
    q('.global-label').textContent = t('q.overall', { i: Math.min(run.done + 1, run.total), n: run.total, left });
    q('.global .bar i').style.width = `${frac * 100}%`;
    window.api.taskbar(frac);
  }

  window.api.onProgress(({ id, p, stage }) => {
    const it = items.get(id);
    if (!it || it.state !== 'run') return;
    it.el.querySelector('.bar i').style.width = `${p * 100}%`;
    it.el.querySelector('.pct').textContent = `${Math.round(p * 100)} %`;
    const left = eta((performance.now() - it.start) / 1000, p);
    // Long AI jobs say which step they're on: "AI upscaling · 2:10 left".
    it.el.querySelector('.eta').textContent = [stage && t(`ai.${stage}`), left ? t('common.left', { t: left }) : !stage && t('common.estimating')].filter(Boolean).join(' · ');
    it.el.classList.toggle('ai-run', Boolean(stage) && stage !== 'encode');
    overall(p);
  });

  // Advanced settings only apply while Advanced mode is on: Simple mode always means "the preset, as is".
  const advancedIds = new Set((cfg.advanced || []).map((o) => o.id));
  const options = () => Object.fromEntries(allOptions
    .filter((o) => !advancedIds.has(o.id) || root.classList.contains('adv-on'))
    .map((o) => [o.id, o.type === 'toggle' ? opts[o.id] === '1' : opts[o.id]]));

  async function runAll() {
    if (busy) return;
    busy = true; cancelled = false;
    for (const it of items.values()) if (it.state !== 'done') setState(it, 'queued', t('q.queued'));
    run = { total: [...items.values()].filter((it) => it.state === 'queued').length, done: 0, start: performance.now() };
    refresh(); overall(0);
    let ok = 0, ko = 0;
    for (const it of items.values()) { // a Map iterator also visits files added while the queue runs
      if (cancelled) break;
      if (it.state !== 'queued' || !items.has(it.id)) continue;
      it.start = performance.now();
      run.current = it.id;
      setState(it, 'run', '0 %', t('q.starting'));
      try {
        it.out = await cfg.run({ id: it.id, src: it.path, target: it.target, outDir, options: options() });
        it.el.querySelector('.bar i').style.width = '100%';
        setState(it, 'done');
        it.el.querySelector('.spec').textContent = t('q.took', { name: F.base(it.out), time: F.secs((performance.now() - it.start) / 1000) });
        ok++;
      } catch (e) {
        if (cancelled) setState(it, 'cancelled', t('q.cancelled'));
        else { const msg = I18n.error(e); setState(it, 'error', t('q.failed')); it.el.querySelector('.spec').textContent = msg; it.el.title = msg; ko++; }
      }
      run.done++;
    }
    for (const it of items.values()) if (it.state === 'queued') setState(it, 'idle', t('q.ready'));
    busy = false; run = null;
    window.api.taskbar(-1);
    refresh();
    if (cancelled) return App.toast(t('q.cancelledToast'));
    const msg = t('q.result', { ok, ko });
    App.toast(msg, ko > 0);
    App.sfx(ko ? 'error' : 'success');
    App.notify(t(cfg.notify), msg);
  }

  function cancel() {
    if (!busy) return;
    cancelled = true;
    window.api.cancel(run.current); // only this tool's running job
  }

  const pick = async () => addFiles(await window.api.pickFiles());

  // Entries are selects, toggles, or section headers ({ section, sub, icon, status }) spanning the whole row.
  function renderOptions(box, list) {
    box.innerHTML = list.map((o) => (o.section
      ? `<div class="adv-section">${I[o.icon] || ''}<b>${t(o.section)}</b><span>${t(o.sub)}</span>${o.status ? `<span class="chip ${o.status}"></span>` : ''}</div>`
      : o.type === 'select'
        ? `<label class="opt">${t(o.label)} <select data-opt="${o.id}">${o.choices.map(([v, k]) => `<option value="${v}"${v === opts[o.id] ? ' selected' : ''}>${t(k)}</option>`).join('')}</select></label>`
        : `<button type="button" class="pill toggle${opts[o.id] === '1' ? ' on' : ''}" data-opt="${o.id}">${I.check}${t(o.label)}</button>`)).join('');
    box.querySelectorAll('select[data-opt]').forEach((s) => s.onchange = () => { opts[s.dataset.opt] = s.value; App.store.set(key(s.dataset.opt), s.value); items.forEach(tags); });
    box.querySelectorAll('button[data-opt]').forEach((b) => b.onclick = () => {
      const id = b.dataset.opt;
      opts[id] = opts[id] === '1' ? '0' : '1';
      App.store.set(key(id), opts[id]);
      b.classList.toggle('on', opts[id] === '1');
    });
  }

  function mount(el) {
    root = el;
    const h = cfg.hero;
    el.innerHTML = `
      <button class="hero" type="button">
        <span class="stack">${h.cards.map((k) => `<span class="card ${k}">${I[k]}</span>`).join('')}</span>
        <span class="hero-title">${t(h.title)}</span>
        <span class="hero-sub">${t('common.browse')} <kbd>Ctrl</kbd><kbd>O</kbd></span>
        <span class="groups">${h.groups.map(([k, title, list, icon]) => `<span><b class="${k}">${I[icon || k]}${t(title)}</b>${t(list)}</span>`).join('')}</span>
      </button>
      <div class="queue">
        <div class="queue-head">
          <div class="q-title">${t('q.queue')} <span class="q-count"></span></div>
          <button class="ghost sm add" type="button">${I.plus}${t('q.add')}</button>
          <button class="ghost sm clean" type="button">${t('q.cleanDone')}</button>
          <button class="ghost sm clear" type="button">${t('q.clear')}</button>
          ${cfg.advanced ? `<button class="ghost sm adv-toggle" type="button" aria-expanded="false">${I.sliders}${t('adv.toggle')}</button>` : ''}
        </div>
        ${cfg.presets ? `<div class="presets">${cfg.presets.map((p) => `
          <button class="preset" type="button" data-preset="${p.id}" title="${F.esc(t(`preset.${p.id.slice(1)}.sub`))}">
            <span class="preset-icon ${p.id.slice(1)}">${p.icon}</span>
            <span class="preset-text"><b>${t(`preset.${p.id.slice(1)}`)}</b><small>${t(`preset.${p.id.slice(1)}.sub`)}</small></span>
          </button>`).join('')}</div>` : ''}
        ${cfg.options ? '<div class="opts"></div>' : ''}
        ${cfg.advanced ? `<div class="adv-panel"><div class="adv-head">${I.sliders}<b>${t(cfg.advancedTitle || 'adv.title')}</b>${cfg.showGpu ? '<span class="adv-gpu chip"></span>' : ''}</div><div class="adv-grid"></div></div>` : ''}
        <div class="list" aria-live="polite"></div>
      </div>
      <footer class="actionbar">
        <div class="dest-wrap">
          <button class="ghost dest" type="button">${I.folder}<span class="dest-label"></span></button>
          <button class="icon dest-reset" type="button" title="${F.esc(t('common.outputReset'))}">${I.x}</button>
        </div>
        <div class="global"><span class="global-label"></span><div class="bar"><i></i></div></div>
        <label class="all-wrap">${t('q.allTo')} <select class="all"></select></label>
        <button class="primary go" type="button"><span class="go-label"></span><kbd>Ctrl</kbd><kbd>↵</kbd></button>
        <button class="danger stop" type="button" hidden>${t('common.cancel')} <kbd>${t('common.esc')}</kbd></button>
      </footer>`;
    q('.hero').onclick = pick;
    q('.add').onclick = pick;
    q('.go').onclick = runAll;
    q('.stop').onclick = cancel;
    q('.clean').onclick = () => { for (const it of items.values()) if (it.state === 'done') it.el.querySelector('.remove').click(); };
    q('.clear').onclick = () => { items.clear(); q('.list').innerHTML = ''; refresh(); };
    q('.all').onchange = (e) => { if (e.target.value) applyTarget(e.target.value); e.target.value = ''; };
    root.querySelectorAll('.preset').forEach((b) => b.onclick = () => applyTarget(b.dataset.preset));
    if (cfg.advanced) {
      const toggle = q('.adv-toggle');
      let advMounted = false;
      const setOpen = (open) => {
        root.classList.toggle('adv-on', open);
        toggle.setAttribute('aria-expanded', String(open));
        App.store.set(key('adv.open'), open ? '1' : '0');
        if (open && !advMounted) { advMounted = true; cfg.onAdvancedMount?.(q('.adv-grid')); } // lazy: first open only
      };
      renderOptions(q('.adv-grid'), cfg.advanced);
      setOpen(App.store.get(key('adv.open')) === '1');
      toggle.onclick = () => setOpen(!root.classList.contains('adv-on'));
      if (cfg.showGpu) window.api.gpu().then((g) => { q('.adv-gpu').textContent = g ? t('gpu.on', { v: g.vendor }) : t('gpu.off'); q('.adv-gpu').classList.toggle('ok', Boolean(g)); });
    }
    q('.dest').onclick = async () => {
      const d = await window.api.pickDir();
      if (d) { outDir = d; App.store.set(key('outDir'), d); refresh(); }
    };
    q('.dest-reset').onclick = () => { outDir = null; App.store.set(key('outDir'), null); refresh(); };
    if (cfg.options) renderOptions(q('.opts'), cfg.options);
    cfg.onMount?.(root);
    refresh();
  }

  App.register({
    id: cfg.id, label: t(cfg.label), icon: cfg.icon, title: t(cfg.label), subtitle: t(cfg.subtitle),
    mount, onDrop: addFiles, isBusy: () => busy,
    onKey(e) {
      if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); pick(); }
      else if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); if (!q('.go').disabled && !busy) runAll(); }
      else if (e.key === 'Escape') cancel();
    },
  });
  return { addFiles, runAll, cancel };
}

window.Tools = {}; // tools expose their actions here for tools/snap.js screenshots
