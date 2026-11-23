// MediaFlow Studio shell: sidebar, navigation, language, drag & drop, toasts, UI sounds, shared helpers.
// Adding a tool = one file in src/tools/ that calls App.register({...}) + one <script> tag in index.html:
//   id, label, icon (svg markup), title, subtitle   (already translated strings, use I18n.t)
//   mount(root)       called once, the first time the tool is shown
//   onDrop(paths)     optional, files dropped anywhere on the window
//   onDropText(text)  optional, a link or text dropped (e.g. dragged from a browser)
//   onKey(event)      optional, keyboard shortcuts while the tool is active
//   isBusy()          optional, true while jobs run (blocks the language switch, which reloads the page)
// Feedback: App.toast(msg, isError), App.notify(title, body), App.sfx('pop'|'success'|'error').
const App = (() => {
  const $ = (s) => document.querySelector(s);
  const { t } = I18n;
  const tools = [];
  let active = null;

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  const icons = {
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/></svg>',
    audio: '<svg viewBox="0 0 24 24"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>',
    video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="14" height="14" rx="3"/><path d="m17 10 4-2.5v9L17 14"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    retry: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    convert: '<svg viewBox="0 0 24 24"><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/></svg>',
    scissors: '<svg viewBox="0 0 24 24"><circle cx="6" cy="7" r="2.6"/><circle cx="6" cy="17" r="2.6"/><path d="M8.2 8.4 20 17M8.2 15.6 20 7"/></svg>',
    extract: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="11" height="10" rx="2.5"/><path d="m13.5 8.5 3-2v7l-3-2"/><path d="M17 17.5v-4M20 19v-7M14 19v-2"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5v14M17 5v14" stroke-width="3.2"/></svg>',
  };

  // Formatting helpers shared by every tool (locale-aware numbers and units).
  const num = (v, d) => v.toLocaleString(I18n.lang, { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt = {
    esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`),
    ext: (p) => p.split('.').pop().toLowerCase(),
    base: (p) => p.split(/[\\/]/).pop(),
    fileUrl: (p) => 'file:///' + p.replace(/\\/g, '/').split('/').map((s, i) => (i ? encodeURIComponent(s) : s)).join('/'),
    size: (b) => (b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} ${t('unit.kb')}` : b < 1e9 ? `${num(b / 1e6, 1)} ${t('unit.mb')}` : `${num(b / 1e9, 2)} ${t('unit.gb')}`),
    speed: (b) => (b >= 1e6 ? `${num(b / 1e6, 1)} ${t('unit.mb')}/s` : `${Math.round(b / 1e3)} ${t('unit.kb')}/s`),
    clock: (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; },
    secs: (s) => (s < 60 ? `${num(s, 1)} s` : fmt.clock(s)),
    num,
  };

  let muted = store.get('muted') === '1';
  const sfx = (name) => { if (!muted) try { Sfx.play(name); } catch {} }; // sound is a nicety, never an error

  const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

  function moveGlider() {
    const btn = $('#nav .nav-item.active');
    const g = $('.nav-glider');
    if (!btn) return;
    g.style.transform = `translateY(${btn.offsetTop}px)`;
    g.style.height = `${btn.offsetHeight}px`;
    g.classList.add('on');
  }

  function show(id) {
    const tool = tools.find((x) => x.id === id) || tools[0];
    if (tool === active) return;
    active = tool;
    store.set('tool', tool.id);
    document.querySelectorAll('#nav .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.id === tool.id));
    moveGlider();
    $('#title').textContent = tool.title;
    $('#subtitle').textContent = tool.subtitle;
    replay($('.topbar'), 'enter');
    for (const x of tools) if (x.root) x.root.hidden = x !== tool;
    if (!tool.root) {
      tool.root = Object.assign(document.createElement('section'), { className: `tool tool-${tool.id}` });
      $('#view').append(tool.root);
      tool.mount(tool.root);
    }
    replay(tool.root, 'enter');
  }

  let toastTimer;
  function toast(msg, err = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast show${err ? ' err' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
  }
  const notify = (title, body) => { if (!document.hasFocus()) new Notification(title, { body, silent: true }); };

  function setMuted(m) {
    muted = m;
    store.set('muted', m ? '1' : '0');
    document.body.classList.toggle('muted', m);
    $('#sound').setAttribute('aria-pressed', String(!m));
  }

  // shortcut: switching language reloads the window (queues are lost), so it is refused while jobs run.
  function switchLang() {
    if (tools.some((x) => x.isBusy?.())) return toast(t('app.langBusy'), true);
    const codes = Object.keys(I18n.LANGS);
    store.set('lang', codes[(codes.indexOf(I18n.lang) + 1) % codes.length]);
    document.body.classList.add('leaving');
    setTimeout(() => location.reload(), 220);
  }

  // ---- Auto-update banner (events come from electron-updater in main.js) -------------------------
  let manualCheck = false;
  const busy = () => tools.some((x) => x.isBusy?.());
  function banner(state, { title, sub = '', action = '', onAction, progress = 0 }) {
    const box = $('#update');
    if (box.hidden) { box.hidden = false; replay(box, 'enter'); }
    box.dataset.state = state;
    box.querySelector('.up-icon').innerHTML = state === 'ready' ? icons.check : state === 'error' ? icons.warn : icons.download;
    box.querySelector('.up-title').textContent = title;
    box.querySelector('.up-sub').textContent = sub;
    const btn = box.querySelector('.up-action');
    btn.hidden = !action;
    btn.textContent = action;
    btn.onclick = onAction;
    box.querySelector('.bar i').style.width = `${progress}%`;
  }
  function checkUpdates(manual) {
    manualCheck = manual;
    if (manual) toast(t('up.checking'));
    window.api.update.check();
  }
  function onUpdate(d) {
    $('#updates').classList.toggle('has-update', ['available', 'downloading', 'ready'].includes(d.state));
    const manual = manualCheck;
    manualCheck = false;
    if (d.state === 'latest' || d.state === 'dev') { if (manual) toast(t(`up.${d.state}`, { v: d.version })); return; }
    if (d.state === 'available') {
      banner('available', { title: t('up.available', { v: d.version }), sub: t(d.portable ? 'up.availablePortable' : 'up.availableSub'),
        action: t(d.portable ? 'up.download' : 'up.get'), onAction: () => window.api.update.download() });
      sfx('pop');
    } else if (d.state === 'downloading') {
      banner('downloading', { title: t('up.downloading'), sub: `${Math.round(d.percent)} % · ${fmt.speed(d.speed)}`, progress: d.percent });
    } else if (d.state === 'ready') {
      banner('ready', { title: t('up.ready', { v: d.version }), sub: t('up.readySub'), action: t('up.restart'),
        onAction: () => (busy() ? toast(t('up.busy'), true) : window.api.update.install()) });
      sfx('success');
      notify(t('up.ready', { v: d.version }), t('up.readySub'));
    } else if (d.state === 'error' && (manual || $('#update').dataset.state === 'downloading')) {
      banner('error', { title: t('up.error'), sub: d.message, action: t('common.retry'), onAction: () => checkUpdates(true) });
      sfx('error');
    } // a silent startup check that fails (offline…) stays silent
  }

  function start() {
    I18n.apply(document);
    $('#nav').setAttribute('aria-label', t('app.tools'));
    for (const x of tools) {
      const b = document.createElement('button');
      b.className = 'nav-item'; b.type = 'button'; b.dataset.id = x.id; b.title = x.label;
      b.innerHTML = `<span class="nav-icon">${x.icon}</span><span class="nav-text">${x.label}</span>`;
      b.onclick = () => show(x.id);
      $('#nav').append(b);
    }
    $('#lang-label').textContent = I18n.LANGS[I18n.lang];
    $('#lang').onclick = switchLang;
    document.body.classList.toggle('collapsed', store.get('collapsed') === '1');
    $('#collapse').onclick = () => store.set('collapsed', document.body.classList.toggle('collapsed') ? '1' : '0');
    $('#sound').onclick = () => { setMuted(!muted); if (!muted) sfx('toggle'); };
    setMuted(muted);
    window.api.update.onStatus(onUpdate);
    $('#updates').onclick = () => checkUpdates(true);
    $('.up-close').onclick = () => { $('#update').hidden = true; }; // a download keeps going in the background
    window.api.version().then((v) => { $('#updates').title = `${t('up.check')} · v${v}`; });
    setTimeout(() => checkUpdates(false), 4000); // quietly, once the window has settled
    show(store.get('tool'));
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
  }

  // Every enabled button answers with a soft click; toggles get a lighter tick. (#sound plays its own.)
  addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.id === 'sound') return;
    sfx(b.matches('.seg button, .pill, .nav-item, .up-close') ? 'toggle' : 'tap');
  }, true);

  // Liquid-glass spotlight: controls light up where the pointer is.
  addEventListener('pointermove', (e) => {
    const b = e.target.closest?.('.ghost, .primary, .danger, .pill, .hero, .nav-item, .round');
    if (!b) return;
    const r = b.getBoundingClientRect();
    b.style.setProperty('--mx', `${e.clientX - r.left}px`);
    b.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });

  // Drag & drop anywhere in the window goes to the active tool.
  let depth = 0;
  addEventListener('dragenter', (e) => { e.preventDefault(); if ((active?.onDrop || active?.onDropText) && ++depth === 1) document.body.classList.add('dragging'); });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
    const paths = [...e.dataTransfer.files].map(window.api.pathOf).filter(Boolean);
    if (paths.length) active?.onDrop?.(paths);
    else active?.onDropText?.(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'));
  });
  addEventListener('keydown', (e) => active?.onKey?.(e));
  addEventListener('resize', moveGlider);
  addEventListener('DOMContentLoaded', start);

  return { register: (x) => tools.push(x), toast, notify, store, sfx, icons, fmt };
})();
