// Trimmer: preview a video (or audio) file, set in/out points on a filmstrip timeline, export the clip.
// Keys: Space play/pause · I / O set in/out · ← → step one frame (Shift: one second) · Ctrl+Enter export.
(() => {
  const { t } = I18n, F = App.fmt, I = App.icons;
  const JOB = 'trim';
  let root, file = null, info = null, dur = 0, pos = 0, inP = 0, outP = 0, busy = false, last = null;
  let precise = App.store.get('trim.precise') === '1', outDir = App.store.get('trim.outDir');
  const q = (s) => root.querySelector(s);
  const v = () => q('video');
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const frame = () => 1 / (info?.video?.fps || 30);

  const { tc, parseTc: parse } = F; // 75.25 ↔ "1:15.25" (App.fmt)

  // ---- loading -------------------------------------------------------------------------------------
  async function open(paths) {
    if (busy || !paths?.length) return;
    const [inf] = await window.api.info(paths.slice(0, 1));
    if (!inf?.kind || inf.kind === 'image') return App.toast(t('trim.unsupported'), true);
    v().pause();
    file = inf;
    info = await window.api.probe(inf.path);
    dur = info.duration || 0;
    inP = 0; outP = dur; pos = 0;
    root.classList.add('loaded');
    root.classList.toggle('audio', inf.kind === 'audio');
    root.classList.remove('no-prev');
    q('.f-name').textContent = F.base(inf.path);
    q('.f-spec').textContent = [info.video && `${info.video.width}×${info.video.height}`, info.video?.fps && `${+info.video.fps.toFixed(2)} ${t('spec.fps')}`,
      dur && F.clock(dur), F.size(inf.size)].filter(Boolean).join(' · ');
    v().src = F.fileUrl(inf.path);
    const strip = q('.tl-strip');
    strip.style.backgroundImage = '';
    q('.tl').classList.add('loading');
    window.api.strip(inf.path, dur).then((img) => {
      if (file !== inf) return;
      if (img) strip.style.backgroundImage = `url("${img}")`;
      q('.tl').classList.remove('loading');
    });
    replay(q('.trim-work'), 'enter');
    App.sfx('pop');
    update();
  }
  const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

  // ---- playback ------------------------------------------------------------------------------------
  function seek(s) {
    pos = clamp(s, 0, dur);
    if (v().readyState) v().currentTime = pos;
    update();
  }
  function togglePlay() {
    if (!file) return;
    if (v().paused) {
      if (pos >= outP - 0.05 || pos < inP) seek(inP); // play the selection
      v().play().catch(() => root.classList.add('no-prev'));
    } else v().pause();
  }
  function tick() {
    if (v().paused) return update();
    pos = v().currentTime;
    if (pos >= outP) { v().pause(); pos = outP; }
    update();
    requestAnimationFrame(tick);
  }
  const setIn = (s) => { inP = clamp(s, 0, outP - 0.05); update(); };
  const setOut = (s) => { outP = clamp(s, inP + 0.05, dur); update(); };

  // ---- rendering -----------------------------------------------------------------------------------
  function update() {
    if (!file || !dur) return controls();
    const pc = (x) => `${(x / dur) * 100}%`;
    q('.tl-range').style.left = pc(inP);
    q('.tl-range').style.width = pc(outP - inP);
    q('.tl-shade.l').style.width = pc(inP);
    q('.tl-shade.r').style.width = pc(dur - outP);
    q('.tl-head').style.left = pc(pos);
    q('.cur').textContent = tc(pos);
    q('.total').textContent = `/ ${tc(dur)}`;
    if (document.activeElement !== q('.t-in')) q('.t-in').value = tc(inP);
    if (document.activeElement !== q('.t-out')) q('.t-out').value = tc(outP);
    q('.len').textContent = `${t('trim.length')} ${tc(outP - inP)}`;
    q('.play').innerHTML = v().paused ? I.play : I.pause;
    controls();
  }
  function controls() {
    q('.go').hidden = busy;
    q('.stop').hidden = !busy;
    q('.go').disabled = !file || !(outP > inP);
    q('.global').classList.toggle('on', busy);
    q('.dest').disabled = busy;
    q('.open').disabled = busy;
    q('.dest-label').textContent = outDir || t('common.outputSource');
    q('.dest-reset').hidden = !outDir || busy;
    q('.last').hidden = !last || busy;
    q('.seg').hidden = file?.kind === 'audio'; // audio is always cut losslessly
    root.querySelectorAll('.seg button').forEach((b) => { const on = (b.dataset.mode === 'precise') === precise; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }

  // Timeline: drag the in/out handles, or click/drag anywhere else to scrub.
  function bindTimeline() {
    const tl = q('.tl');
    const at = (e) => clamp((e.clientX - tl.getBoundingClientRect().left) / tl.getBoundingClientRect().width, 0, 1) * dur;
    tl.onpointerdown = (e) => {
      if (!file || !dur) return;
      const what = e.target.closest('.h-in') ? 'in' : e.target.closest('.h-out') ? 'out' : 'head';
      tl.setPointerCapture(e.pointerId);
      tl.classList.add(`drag-${what}`);
      v().pause();
      const move = (ev) => {
        const s = at(ev);
        if (what === 'in') { setIn(s); seek(inP); } else if (what === 'out') { setOut(s); seek(outP); } else seek(s);
      };
      move(e);
      tl.onpointermove = move;
      tl.onpointerup = () => { tl.onpointermove = null; tl.classList.remove(`drag-${what}`); };
    };
  }

  // ---- export --------------------------------------------------------------------------------------
  async function exportClip() {
    if (busy || !file || !(outP > inP)) return;
    busy = true;
    v().pause();
    q('.global-label').textContent = t('trim.exporting', { name: F.base(file.path) });
    q('.global .bar i').style.width = '0%';
    controls();
    try {
      last = await window.api.trim({ id: JOB, src: file.path, range: { start: inP, end: outP, precise: precise && file.kind === 'video' }, outDir });
      q('.global .bar i').style.width = '100%';
      App.toast(t('trim.saved', { name: F.base(last) }));
      App.sfx('success');
      App.notify(t('trim.notify'), F.base(last));
    } catch (e) {
      const msg = I18n.error(e);
      const wasCancel = msg === t('err.CANCELLED');
      App.toast(msg, !wasCancel);
      if (!wasCancel) App.sfx('error');
    }
    busy = false;
    window.api.taskbar(-1);
    controls();
  }

  window.api.onProgress(({ id, p }) => {
    if (id !== JOB || !busy) return;
    q('.global .bar i').style.width = `${p * 100}%`;
    q('.global-label').textContent = `${t('trim.exporting', { name: F.base(file.path) })} ${Math.round(p * 100)} %`;
    window.api.taskbar(p);
  });

  const pick = async () => open(await window.api.pickFiles());

  function mount(el) {
    root = el;
    el.innerHTML = `
      <button class="hero trim-empty" type="button">
        <span class="dl-empty-icon">${I.scissors}</span>
        <span class="hero-title">${t('trim.empty')}</span>
        <span class="hero-sub">${t('common.browse')} <kbd>Ctrl</kbd><kbd>O</kbd></span>
        <span class="muted">${t('trim.emptySub')}</span>
      </button>
      <div class="trim-work">
        <div class="viewer">
          <video preload="auto" playsinline></video>
          <div class="audio-art">${I.audio}</div>
          <div class="no-preview">${I.warn}<span>${t('trim.noPreview')}</span></div>
        </div>
        <div class="transport">
          <button class="round play" type="button" title="${F.esc(t('trim.play'))}">${I.play}</button>
          <div class="tc"><b class="cur">0:00.00</b><span class="total"></span></div>
          <div class="spacer"></div>
          <button class="ghost sm set-in" type="button" title="${F.esc(t('trim.setIn'))}">${t('trim.in')} <kbd>I</kbd></button>
          <input class="t-in tcode" spellcheck="false" aria-label="${F.esc(t('trim.in'))}">
          <span class="io-sep">→</span>
          <input class="t-out tcode" spellcheck="false" aria-label="${F.esc(t('trim.out'))}">
          <button class="ghost sm set-out" type="button" title="${F.esc(t('trim.setOut'))}">${t('trim.out')} <kbd>O</kbd></button>
          <span class="len chip"></span>
        </div>
        <div class="tl">
          <div class="tl-strip"></div>
          <div class="tl-shade l"></div><div class="tl-shade r"></div>
          <div class="tl-range"><span class="h-in"></span><span class="h-out"></span></div>
          <div class="tl-head"></div>
        </div>
        <div class="file-line">
          <span class="f-name"></span><span class="f-spec"></span>
          <button class="ghost sm open" type="button">${I.retry}${t('trim.open')}</button>
        </div>
      </div>
      <footer class="actionbar">
        <div class="dest-wrap">
          <button class="ghost dest" type="button" title="${F.esc(t('common.outputTip'))}">${I.folder}<span class="dest-label"></span></button>
          <button class="icon dest-reset" type="button" title="${F.esc(t('common.outputReset'))}">${I.x}</button>
        </div>
        <div class="global"><span class="global-label"></span><div class="bar"><i></i></div></div>
        <div class="seg" title="${F.esc(t('trim.modeTip'))}">
          <button type="button" data-mode="fast">${t('trim.fast')}</button>
          <button type="button" data-mode="precise">${t('trim.precise')}</button>
        </div>
        <button class="ghost last" type="button" hidden>${I.folder}${t('trim.showLast')}</button>
        <button class="primary go" type="button">${I.scissors}${t('trim.export')}<kbd>Ctrl</kbd><kbd>↵</kbd></button>
        <button class="danger stop" type="button" hidden>${t('common.cancel')} <kbd>${t('common.esc')}</kbd></button>
      </footer>`;
    const vid = v();
    vid.addEventListener('play', () => { update(); requestAnimationFrame(tick); });
    vid.addEventListener('pause', update);
    vid.addEventListener('loadedmetadata', () => {
      if (!dur && Number.isFinite(vid.duration)) { dur = outP = vid.duration; update(); }
      if (file?.kind === 'video' && !vid.videoWidth) root.classList.add('no-prev');
    });
    vid.addEventListener('error', () => root.classList.add('no-prev'));
    q('.trim-empty').onclick = pick;
    q('.open').onclick = pick;
    q('.play').onclick = togglePlay;
    q('.viewer').onclick = togglePlay;
    q('.set-in').onclick = () => setIn(pos);
    q('.set-out').onclick = () => setOut(pos);
    for (const [sel, set] of [['.t-in', setIn], ['.t-out', setOut]]) {
      const input = q(sel);
      input.onchange = () => { const s = parse(input.value); if (s != null) set(s); input.blur(); update(); };
      input.onkeydown = (e) => { if (e.key === 'Enter') input.onchange(); if (e.key === 'Escape') { input.blur(); update(); } };
    }
    root.querySelectorAll('.seg button').forEach((b) => b.onclick = () => {
      precise = b.dataset.mode === 'precise';
      App.store.set('trim.precise', precise ? '1' : '0');
      controls();
    });
    q('.go').onclick = exportClip;
    q('.stop').onclick = () => window.api.cancel(JOB);
    q('.last').onclick = () => last && window.api.reveal(last);
    q('.dest').onclick = async () => { const d = await window.api.pickDir(); if (d) { outDir = d; App.store.set('trim.outDir', d); controls(); } };
    q('.dest-reset').onclick = () => { outDir = null; App.store.set('trim.outDir', null); controls(); };
    bindTimeline();
    controls();
  }

  App.register({
    id: 'trim', label: t('trim.label'), icon: I.scissors, title: t('trim.label'), subtitle: t('trim.subtitle'),
    mount, onDrop: open, isBusy: () => busy,
    onKey(e) {
      if (e.target.matches?.('input')) return; // typing a timecode
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === 'o') { e.preventDefault(); pick(); }
      else if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); exportClip(); }
      else if (e.key === 'Escape' && busy && !e.target.closest?.('select')) window.api.cancel(JOB);
      else if (!file || e.ctrlKey || e.altKey) return;
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (k === 'i') setIn(pos);
      else if (k === 'o') setOut(pos);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        seek(pos + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : frame()));
      }
    },
  });
  Tools.trim = { open, exportClip, setIn, setOut, seek, togglePlay };
})();
