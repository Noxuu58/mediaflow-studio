// Downloader: paste a link, pick format + quality, yt-dlp downloads with live progress.
(() => {
  const { t } = I18n, F = App.fmt, I = App.icons;
  const VIDEO = ['mp4', 'mov', 'mkv'];
  const AUDIO = ['mp3', 'm4a', 'wav', 'flac', 'opus'];
  const LOSSLESS = ['wav', 'flac'];
  const BITRATES = ['320', '256', '192', '128'];
  const RES_LABEL = { 2160: '4K', 1440: '2K', 1080: 'Full HD', 720: 'HD' };

  const items = new Map();
  let root, info = null, outDir = App.store.get('dlDir'), nextId = 0, analyzing = 0;
  let mode = App.store.get('dlMode') || 'video';
  const fmt = { video: App.store.get('dlVideoFmt') || 'mp4', audio: App.store.get('dlAudioFmt') || 'mp3' };
  const q = (s) => root.querySelector(s);
  const qualityLabel = (m, qv) => (qv === 'best' ? t('dl.bestQuality') : m === 'video' ? `${qv}p` : `${qv} kb/s`);

  // ---- link analysis ---------------------------------------------------------------------------------
  async function analyze(text) {
    const url = (String(text || '').match(/https?:\/\/\S+/i) || [])[0];
    if (!url) return App.toast(t('dl.noLink'), true);
    q('#url').value = url;
    const ticket = ++analyzing; // a newer paste wins over a slower, older analysis
    info = null;
    renderPreview('loading');
    try {
      const res = await window.api.dl.analyze(url);
      if (ticket !== analyzing) return;
      info = res;
      if (!info.hasVideo) mode = 'audio';
      renderPreview('ready');
      App.sfx('pop');
    } catch (e) {
      if (ticket !== analyzing) return;
      App.sfx('error');
      renderPreview('error', I18n.error(e));
    }
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
    box.innerHTML = `
      <div class="dl-thumb">${info.thumbnail ? `<img src="${F.esc(info.thumbnail)}" alt="">` : I.video}
        ${info.duration ? `<span class="dur">${F.clock(info.duration)}</span>` : ''}</div>
      <div class="dl-info">
        <span class="dl-site">${F.esc(info.site)}${info.uploader ? ` · ${F.esc(info.uploader)}` : ''}</span>
        <span class="dl-title" title="${F.esc(info.title)}">${F.esc(info.title)}</span>
        <div class="dl-opts">
          <div class="seg" role="tablist">
            <button type="button" data-mode="video" ${info.hasVideo ? '' : 'disabled'}>${I.video}${t('dl.video')}</button>
            <button type="button" data-mode="audio">${I.audio}${t('dl.audio')}</button>
          </div>
          <div class="pills"></div>
          <select id="dl-quality" aria-label="${F.esc(t('dl.quality'))}"></select>
          <button id="dl-go" class="primary" type="button">${I.download}${t('dl.download')}</button>
        </div>
      </div>`;
    box.querySelectorAll('.seg button').forEach((b) => b.onclick = () => { mode = b.dataset.mode; App.store.set('dlMode', mode); renderOptions(); });
    q('#dl-go').onclick = start;
    renderOptions();
  }

  function renderOptions() {
    root.querySelectorAll('.dl-preview .seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    const list = mode === 'video' ? VIDEO : AUDIO;
    q('.pills').innerHTML = list.map((f) => `<button type="button" class="pill ${mode}${f === fmt[mode] ? ' on' : ''}" data-fmt="${f}">${f}</button>`).join('');
    q('.pills').querySelectorAll('.pill').forEach((b) => b.onclick = () => {
      fmt[mode] = b.dataset.fmt; App.store.set(mode === 'video' ? 'dlVideoFmt' : 'dlAudioFmt', fmt[mode]); renderOptions();
    });
    const sel = q('#dl-quality');
    const opts = mode === 'video' ? info.heights.filter((h) => h >= 144) : BITRATES;
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
    it.el.querySelector('.act').title = t(state === 'run' ? 'common.cancel' : 'dl.removeTip');
    if (state !== 'run' && state !== 'done') it.el.querySelector('.bar i').style.width = '0%';
    refresh();
  }

  async function run(it) {
    it.el.querySelector('.spec').textContent = it.spec;
    it.el.title = '';
    setState(it, 'run', '0 %', t('dl.connecting'));
    try {
      it.out = await window.api.dl.start({ id: it.id, url: it.url, fmt: it.fmt, quality: it.quality, outDir: outDir || await window.api.downloadsDir() });
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

  function start() {
    if (!info) return;
    const it = { id: `dl${nextId++}`, url: info.url, title: info.title, fmt: fmt[mode], quality: q('#dl-quality').value, mode };
    it.spec = [info.site, qualityLabel(mode, it.quality), info.duration && F.clock(info.duration)].filter(Boolean).join(' · ');
    const el = document.createElement('div');
    el.innerHTML = `
      <div class="thumb ${mode}">${info.thumbnail ? `<img src="${F.esc(info.thumbnail)}" alt="">` : I[mode]}</div>
      <div class="meta"><div class="name">${F.esc(it.title)}</div><div class="spec"></div></div>
      <div class="route"><span class="fmt ${mode}">${it.fmt}</span></div>
      <div class="state"></div>
      <button class="icon act" type="button">${I.x}</button>
      <div class="bar"><i></i></div>`;
    it.el = el;
    el.querySelector('.act').onclick = () => {
      if (it.state === 'run') return window.api.dl.cancel(it.id);
      el.classList.add('leaving'); items.delete(it.id);
      setTimeout(() => { el.remove(); refresh(); }, 280);
    };
    q('.list').prepend(el);
    items.set(it.id, it);
    run(it);
    // Clear the composer so the next link can be pasted right away.
    q('#url').value = ''; info = null; q('.dl-preview').hidden = true; refresh();
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
        <div class="list" aria-live="polite"></div>
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
    isBusy: () => [...items.values()].some((it) => it.state === 'run'),
    onKey(e) {
      if (e.ctrlKey && e.key.toLowerCase() === 'v' && document.activeElement?.id !== 'url') {
        e.preventDefault(); window.api.clipboard().then(analyze);
      } else if (e.ctrlKey && e.key === 'Enter' && info) { e.preventDefault(); start(); }
    },
  });
  Tools.download = { analyze, start };
})();
