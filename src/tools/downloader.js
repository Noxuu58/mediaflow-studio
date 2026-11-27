// Downloader: paste a link, pick format + quality, yt-dlp downloads with live progress.
(() => {
  const { t } = I18n, F = App.fmt, I = App.icons;
  const VIDEO = ['mp4', 'mov', 'mkv'];
  const AUDIO = ['mp3', 'm4a', 'wav', 'flac', 'opus'];
  const LOSSLESS = ['wav', 'flac'];
  const BITRATES = ['320', '256', '192', '128'];
  const RES_LABEL = { 2160: '4K', 1440: '2K', 1080: 'Full HD', 720: 'HD' };
  const PLAYLIST_HEIGHTS = [2160, 1440, 1080, 720, 480, 360]; // each video gets the closest it has, never more

  const items = new Map();
  let root, info = null, outDir = App.store.get('dlDir'), nextId = 0, section = false;
  let last = null; // the link the preview is about: { url, state: 'loading' | 'ready' | 'error' }
  let line = Promise.resolve(); // playlist videos download one after another
  let mode = App.store.get('dlMode') || 'video';
  const fmt = { video: App.store.get('dlVideoFmt') || 'mp4', audio: App.store.get('dlAudioFmt') || 'mp3' };
  const q = (s) => root.querySelector(s);
  const qualityLabel = (m, qv) => (qv === 'best' ? t('dl.bestQuality') : m === 'video' ? `${qv}p` : `${qv} kb/s`);

  // ---- link analysis ---------------------------------------------------------------------------------
  // What Analyze does for a link: 'run' (a new link, or a retry after an error), 'busy' (this link is being read),
  // 'done' (this link is already on screen). Pasting the same link, or clicking Analyze again, never starts over.
  const nextStep = (prev, url) => (!prev || prev.url !== url || prev.state === 'error' ? 'run' : prev.state === 'loading' ? 'busy' : 'done');

  function analyzeButton(busy) {
    const b = q('#dl-analyze');
    b.disabled = busy;
    b.classList.toggle('busy', busy);
    b.setAttribute('aria-busy', String(busy));
    b.innerHTML = busy ? `<span class="spinner"></span>${t('dl.analyzeBusy')}` : t('dl.analyze');
  }

  async function analyze(text) {
    const url = (String(text || '').match(/https?:\/\/\S+/i) || [])[0];
    if (!url) return App.toast(t('dl.noLink'), true);
    q('#url').value = url;
    const step = nextStep(last, url);
    if (step !== 'run') return App.toast(t(step === 'busy' ? 'dl.inProgress' : 'dl.already'));
    const me = last = { url, state: 'loading' }; // a newer link wins over a slower, older analysis
    info = null;
    renderPreview('loading');
    analyzeButton(true);
    try {
      const res = await window.api.dl.analyze(url);
      if (me !== last) return;
      me.state = 'ready';
      info = res;
      if (!info.hasVideo) mode = 'audio';
      renderPreview('ready');
      App.sfx('pop');
    } catch (e) {
      if (me !== last) return;
      me.state = 'error';
      App.sfx('error');
      renderPreview('error', I18n.error(e));
    } finally {
      if (me === last) analyzeButton(false);
    }
  }

  // Emptying the link field is the explicit reset: the preview goes and the next link is read from scratch.
  function clearLink() {
    last = null; info = null; section = false;
    q('.dl-preview').hidden = true;
    analyzeButton(false);
    refresh();
  }

  function renderPreview(state, msg = '') {
    const box = q('.dl-preview');
    box.hidden = false;
    box.className = `dl-preview ${state}`;
    refresh();
    if (state === 'loading') {
      box.innerHTML = `<div class="dl-thumb skeleton"></div>
        <div class="dl-info"><span class="spinner"></span><b>${t('dl.analyzing')}</b><span class="muted">${t('dl.analyzingSub')}</span></div>`;
      return;
    }
    if (state === 'error') {
      box.innerHTML = `<div class="dl-thumb err">${I.warn}</div>
        <div class="dl-info"><b>${t('dl.cantRead')}</b><span class="muted err-msg">${F.esc(msg)}</span>
        <button class="ghost sm" id="dl-retry-an" type="button">${I.retry}${t('common.retry')}</button></div>`;
      q('#dl-retry-an').onclick = () => analyze(q('#url').value);
      return;
    }
    const pl = info.playlist;
    box.innerHTML = `
      <div class="dl-thumb">${info.thumbnail ? `<img src="${F.esc(info.thumbnail)}" alt="">` : I.video}
        ${info.duration ? `<span class="dur">${F.clock(info.duration)}</span>` : ''}</div>
      <div class="dl-info">
        <span class="dl-site">${F.esc(info.site)}${info.uploader ? ` · ${F.esc(info.uploader)}` : ''}${pl ? ` · ${F.esc(t('dl.playlist', { n: info.entries.length }))}` : ''}</span>
        <span class="dl-title" title="${F.esc(info.title)}">${F.esc(info.title)}</span>
        <div class="dl-opts">
          <div class="seg" role="group" aria-label="${F.esc(t('dl.mode'))}">
            <button type="button" data-mode="video" ${info.hasVideo ? '' : 'disabled'}>${I.video}${t('dl.video')}</button>
            <button type="button" data-mode="audio">${I.audio}${t('dl.audio')}</button>
          </div>
          <div class="pills"></div>
          <select id="dl-quality" aria-label="${F.esc(t('dl.quality'))}"></select>
          ${pl ? '' : `<button type="button" class="pill toggle dl-part${section ? ' on' : ''}" aria-pressed="${section}" title="${F.esc(t('dl.sectionTip'))}">${I.scissors}${t('dl.section')}</button>`}
          <button id="dl-go" class="primary" type="button">${I.download}${pl ? t('dl.downloadAll', { n: info.entries.length }) : t('dl.download')}</button>
        </div>
        ${pl ? '' : `<div class="dl-range"${section ? '' : ' hidden'}>
          <label>${t('dl.from')} <input id="dl-from" class="tcode" type="text" inputmode="decimal" spellcheck="false" value="0:00.00"></label>
          <label>${t('dl.to')} <input id="dl-to" class="tcode" type="text" inputmode="decimal" spellcheck="false" value="${F.tc(info.duration || 0)}"></label>
        </div>`}
      </div>`;
    box.querySelector('.dl-part')?.addEventListener('click', (e) => {
      section = !section;
      e.currentTarget.classList.toggle('on', section);
      e.currentTarget.setAttribute('aria-pressed', String(section));
      q('.dl-range').hidden = !section;
      if (section) q('#dl-from').focus();
    });
    box.querySelectorAll('.seg button').forEach((b) => b.onclick = () => { mode = b.dataset.mode; App.store.set('dlMode', mode); renderOptions(); });
    q('#dl-go').onclick = start;
    renderOptions();
  }

  function renderOptions() {
    root.querySelectorAll('.dl-preview .seg button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
    const list = mode === 'video' ? VIDEO : AUDIO;
    q('.pills').innerHTML = list.map((f) => `<button type="button" class="pill ${mode}${f === fmt[mode] ? ' on' : ''}" data-fmt="${f}" aria-pressed="${f === fmt[mode]}">${f}</button>`).join('');
    q('.pills').querySelectorAll('.pill').forEach((b) => b.onclick = () => {
      fmt[mode] = b.dataset.fmt; App.store.set(mode === 'video' ? 'dlVideoFmt' : 'dlAudioFmt', fmt[mode]); renderOptions();
    });
    const sel = q('#dl-quality');
    const opts = mode === 'video' ? (info.playlist ? PLAYLIST_HEIGHTS : info.heights.filter((h) => h >= 144)) : BITRATES;
    const saved = App.store.get(`dlQ-${mode}`);
    sel.innerHTML = `<option value="best">${t('dl.best')}</option>` + opts.map((o) =>
      `<option value="${o}">${mode === 'video' ? `${o}p${RES_LABEL[o] ? ` · ${RES_LABEL[o]}` : ''}` : `${o} kb/s`}</option>`).join('');
    sel.value = opts.map(String).includes(saved) ? saved : 'best';
    sel.disabled = mode === 'audio' && LOSSLESS.includes(fmt.audio);
    if (sel.disabled) sel.innerHTML = `<option value="best">${t('dl.lossless')}</option>`;
    sel.onchange = () => App.store.set(`dlQ-${mode}`, sel.value);
  }

  // ---- downloads -------------------------------------------------------------------------------------
  function setState(it, state, pct = '', detail = '') {
    it.state = state;
    it.el.className = `row ${state}`;
    const st = it.el.querySelector('.state');
    st.innerHTML = state === 'done'
      ? `<span class="badge ok">${I.check}${t('q.done')}</span><button class="icon reveal" type="button" title="${F.esc(t('common.reveal'))}">${I.folder}</button>`
      : state === 'error'
        ? `<button class="ghost sm retry" type="button">${I.retry}${t('common.retry')}</button>`
        : `<span class="pct">${pct}</span><span class="eta">${F.esc(detail)}</span>`;
    st.querySelector('.reveal')?.addEventListener('click', () => window.api.reveal(it.out));
    st.querySelector('.retry')?.addEventListener('click', () => run(it));
    it.el.draggable = state === 'done';
    if (state === 'done') it.el.title = t('q.dragTip');
    it.el.querySelector('.act').title = t(state === 'run' ? 'common.cancel' : 'dl.removeTip');
    if (state !== 'run' && state !== 'done') it.el.querySelector('.bar i').style.width = '0%';
    refresh();
  }

  async function run(it) {
    it.el.querySelector('.spec').textContent = it.spec;
    it.el.title = '';
    setState(it, 'run', '0 %', t('dl.connecting'));
    try {
      it.out = await window.api.dl.start({ id: it.id, url: it.url, fmt: it.fmt, quality: it.quality, section: it.section, outDir: outDir || await window.api.downloadsDir() });
      it.el.querySelector('.bar i').style.width = '100%';
      setState(it, 'done');
      it.el.querySelector('.spec').textContent = `→ ${F.base(it.out)}`;
      App.toast(t('dl.done', { title: it.title }));
      App.sfx('success');
      App.notify(t('dl.notify'), it.title);
    } catch (e) {
      const msg = I18n.error(e);
      if (msg === t('err.CANCELLED')) return setState(it, 'cancelled', t('q.cancelled'));
      setState(it, 'error');
      it.el.querySelector('.spec').textContent = msg;
      it.el.title = msg;
      App.toast(t('dl.failed'), true);
      App.sfx('error');
    }
  }

  // The part of the video to download ({ start, end } in seconds), null for all of it, false when the times are wrong.
  function readSection() {
    if (!section || info.playlist) return null;
    const start = F.parseTc(q('#dl-from').value), end = F.parseTc(q('#dl-to').value);
    const max = info.duration || Infinity;
    return start != null && end != null && end > start && start < max ? { start, end: Math.min(end, max) } : false;
  }

  function addRow(v, extra, atEnd = false) {
    const it = { id: `dl${nextId++}`, url: v.url, title: v.title, fmt: fmt[mode], quality: q('#dl-quality').value, mode, ...extra };
    const dur = it.section ? it.section.end - it.section.start : v.duration;
    it.spec = [info.site, qualityLabel(mode, it.quality), it.section && `${F.tc(it.section.start)} → ${F.tc(it.section.end)}`, dur && F.clock(dur)].filter(Boolean).join(' · ');
    const el = document.createElement('div');
    el.innerHTML = `
      <div class="thumb ${mode}">${v.thumbnail ? `<img src="${F.esc(v.thumbnail)}" alt="">` : I[mode]}</div>
      <div class="meta"><div class="name">${F.esc(it.title)}</div><div class="spec"></div></div>
      <div class="route"><span class="fmt ${mode}">${it.fmt}</span></div>
      <div class="state"></div>
      <button class="icon act" type="button">${I.x}</button>
      <div class="bar"><i></i></div>`;
    it.el = el;
    el.addEventListener('dragstart', (e) => { if (it.state !== 'done') return; e.preventDefault(); window.api.startDrag(it.out); });
    el.querySelector('.act').onclick = () => {
      if (it.state === 'run') return window.api.dl.cancel(it.id);
      el.classList.add('leaving'); items.delete(it.id);
      setTimeout(() => { el.remove(); refresh(); }, 280);
    };
    q('.list')[atEnd ? 'append' : 'prepend'](el); // newest single download on top, a playlist in its order
    items.set(it.id, it);
    return it;
  }

  function start() {
    if (!info) return;
    if (info.playlist) {
      for (const v of info.entries) {
        const it = addRow(v, {}, true);
        it.el.querySelector('.spec').textContent = it.spec;
        setState(it, 'queued', t('q.queued'));
        line = line.then(() => (items.has(it.id) && it.state === 'queued' ? run(it) : null));
      }
    } else {
      const part = readSection();
      if (part === false) return App.toast(t('dl.sectionBad'), true);
      run(addRow(info, { section: part || undefined }));
    }
    // Clear the composer so the next link can be pasted right away.
    q('#url').value = '';
    clearLink();
  }

  window.api.dl.onProgress(({ id, stage, p, speed, eta }) => {
    const it = items.get(id);
    if (!it || it.state !== 'run') return;
    it.el.querySelector('.bar i').style.width = `${p * 100}%`;
    if (stage === 'post') {
      it.el.querySelector('.pct').textContent = t('dl.finalizing');
      it.el.querySelector('.eta').textContent = t(it.mode === 'audio' ? 'dl.extracting' : 'dl.merging');
    } else {
      it.el.querySelector('.pct').textContent = `${Math.round(p * 100)} %`;
      it.el.querySelector('.eta').textContent = [speed && F.speed(speed), eta > 0 && t('common.left', { t: F.clock(eta) })].filter(Boolean).join(' · ');
    }
  });

  function refresh() {
    if (!root) return;
    const list = [...items.values()];
    root.classList.toggle('has-items', list.length > 0);
    root.classList.toggle('has-preview', !q('.dl-preview').hidden);
    q('.q-count').textContent = list.length ? `${list.length}` : '';
    q('#dl-clean').disabled = !list.some((it) => it.state === 'done');
    q('#dl-dest-label').textContent = outDir || t('dl.dest');
    q('#dl-dest').title = outDir || t('dl.destTip');
    q('#dl-dest-reset').hidden = !outDir;
  }

  // ---- yt-dlp binary ---------------------------------------------------------------------------------
  async function checkBinary() {
    const ver = await window.api.dl.version(App.store.get('ytdlp'));
    root.classList.toggle('missing', !ver);
    q('#ytdlp-ver').textContent = ver ? `yt-dlp ${ver}` : t('dl.missing');
    return ver;
  }

  function mount(el) {
    root = el;
    el.innerHTML = `
      <div class="dl-missing">
        <div class="dl-missing-icon">${I.warn}</div>
        <b>${t('dl.missing')}</b>
        <span class="muted">${t('dl.missingSub', { cmd: '<kbd>winget install yt-dlp</kbd>' })}</span>
        <div class="row-btns">
          <button id="dl-pick" class="primary" type="button">${t('dl.pick')}</button>
          <button id="dl-recheck" class="ghost" type="button">${I.retry}${t('common.retry')}</button>
        </div>
      </div>
      <div class="dl-bar">
        <span class="dl-bar-icon">${I.link}</span>
        <input id="url" type="url" spellcheck="false" autocomplete="off" placeholder="${F.esc(t('dl.placeholder'))}">
        <button id="dl-paste" class="ghost" type="button">${t('dl.paste')} <kbd>Ctrl</kbd><kbd>V</kbd></button>
        <button id="dl-analyze" class="primary" type="button">${t('dl.analyze')}</button>
      </div>
      <div class="dl-preview" hidden></div>
      <div class="dl-empty">
        <span class="dl-empty-icon">${I.download}</span>
        <b>${t('dl.emptyTitle')}</b>
        <span class="muted">${t('dl.emptySub')}</span>
      </div>
      <div class="queue">
        <div class="queue-head">
          <div class="q-title">${t('dl.list')} <span class="q-count"></span></div>
          <button id="dl-clean" class="ghost sm" type="button">${t('q.cleanDone')}</button>
        </div>
        <div class="list"></div>
      </div>
      <footer class="actionbar">
        <div class="dest-wrap">
          <button id="dl-dest" class="ghost" type="button">${I.folder}<span id="dl-dest-label"></span></button>
          <button id="dl-dest-reset" class="icon" type="button" title="${F.esc(t('dl.destReset'))}">${I.x}</button>
        </div>
        <div class="spacer"></div>
        <span id="ytdlp-ver" class="chip"></span>
        <button id="dl-update" class="ghost sm" type="button">${I.retry}${t('dl.update')}</button>
      </footer>`;
    q('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(q('#url').value); });
    q('#url').addEventListener('input', () => { if (!q('#url').value.trim()) clearLink(); });
    q('#url').addEventListener('paste', (e) => { e.preventDefault(); analyze(e.clipboardData.getData('text')); });
    q('#dl-paste').onclick = async () => analyze(await window.api.clipboard());
    q('#dl-analyze').onclick = () => analyze(q('#url').value);
    q('#dl-clean').onclick = () => { for (const it of items.values()) if (it.state === 'done') it.el.querySelector('.act').click(); };
    q('#dl-dest').onclick = async () => { const d = await window.api.pickDir(); if (d) { outDir = d; App.store.set('dlDir', d); refresh(); } };
    q('#dl-dest-reset').onclick = () => { outDir = null; App.store.set('dlDir', null); refresh(); };
    q('#dl-pick').onclick = async () => { const p = await window.api.dl.pickBinary(); if (p) { App.store.set('ytdlp', p); checkBinary(); } };
    q('#dl-recheck').onclick = checkBinary;
    q('#dl-update').onclick = async () => {
      const b = q('#dl-update'); b.disabled = true;
      App.toast(t('dl.updating'));
      try { App.toast(await window.api.dl.update()); } catch (e) { App.toast(I18n.error(e), true); }
      b.disabled = false; checkBinary();
    };
    refresh();
    checkBinary();
  }

  App.register({
    id: 'download', label: t('dl.label'), icon: I.download, title: t('dl.label'), subtitle: t('dl.subtitle'),
    mount,
    onDropText: analyze,
    isBusy: () => [...items.values()].some((it) => it.state === 'run' || it.state === 'queued'),
    onKey(e) {
      if (e.ctrlKey && e.key.toLowerCase() === 'v' && document.activeElement?.id !== 'url') {
        e.preventDefault(); window.api.clipboard().then(analyze);
      } else if (e.ctrlKey && e.key === 'Enter' && info) { e.preventDefault(); start(); }
    },
  });
  Tools.download = { analyze, start, nextStep };
})();
