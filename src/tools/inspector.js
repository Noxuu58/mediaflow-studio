// Inspector: everything a media file says about itself (ffprobe + photo EXIF), with the private details flagged,
// and a one-click clean copy without them (src/inspect.js: remux for media, byte-level for photos).
(() => {
  const { t } = I18n, F = App.fmt, I = App.icons;
  let root, report = null, cleaned = null, busy = false, ticket = 0;
  const JOB = 'inspect:clean';
  const q = (s) => root.querySelector(s);
  const rate = (b) => (b ? (b >= 1e6 ? `${F.num(b / 1e6, 1)} Mb/s` : `${Math.round(b / 1e3)} kb/s`) : null);
  // "2026-11-20T14:03:00Z" (video) or "2026:11:20 14:03:00" (EXIF) → a date in the user's language.
  const when = (s) => {
    const d = new Date(String(s).replace(/^(\d{4}):(\d\d):(\d\d) /, '$1-$2-$3T'));
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString(I18n.lang, { dateStyle: 'long', timeStyle: 'short' });
  };
  const colour = (v) => [v.range, v.primaries, v.transfer, v.space].filter(Boolean).join(' · ') || null;

  async function open(paths) {
    const [src] = paths || [];
    if (!src || busy) return;
    const my = ++ticket;
    root.classList.add('loaded');
    cleaned = null;
    q('.ins-body').innerHTML = `<div class="ins-loading"><span class="spinner"></span>${t('ins.loading')}</div>`;
    try {
      const r = await window.api.inspect(src);
      if (my !== ticket) return;
      report = r;
      render();
      App.sfx('pop');
    } catch (e) {
      if (my !== ticket) return;
      report = null;
      q('.ins-body').innerHTML = `<div class="ai-alert"><span class="ai-alert-icon">${I.warn}</span><div><b>${F.esc(t('ins.cantRead'))}</b><p>${F.esc(I18n.error(e))}</p></div></div>`;
      App.sfx('error');
    }
  }

  // A section: title + [label, value] rows (empty values are left out).
  const section = (title, rows, extra = '') => {
    const list = rows.filter(([, v]) => v != null && v !== '' && v !== false);
    return list.length || extra ? `<section class="ins-card"><h3>${F.esc(title)}</h3><dl>${list.map(([k, v]) => `<dt>${F.esc(t(k))}</dt><dd>${F.esc(v)}</dd>`).join('')}</dl>${extra}</section>` : '';
  };

  function render() {
    const r = report;
    const priv = r.private > 0;
    const exifVal = (tag) => (tag.scope === 'EXIF' && tag.key === 'GPS' ? t('ins.gpsYes') : tag.value);
    const tags = r.tags.length
      ? `<table class="ins-tags"><tbody>${r.tags.map((tag) => `<tr class="${tag.private ? 'private' : ''}"><td>${F.esc(tag.scope === 'file' ? t('ins.file') : tag.scope)}</td><td>${F.esc(tag.key)}</td><td>${F.esc(exifVal(tag))}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted">${t('ins.noTags')}</p>`;
    q('.ins-body').innerHTML = `
      <header class="ins-head">
        <div class="thumb ${r.kind || 'video'}">${r.kind === 'image' ? `<img src="${F.esc(F.fileUrl(r.path))}" alt="">` : I[r.kind] || I.video}</div>
        <div class="meta"><div class="name" title="${F.esc(r.path)}">${F.esc(r.name)}</div>
          <div class="spec">${F.esc([r.container, F.size(r.size), r.duration && r.kind !== 'image' ? F.clock(r.duration) : null].filter(Boolean).join(' · '))}</div></div>
        <button class="ghost sm ins-copy" type="button">${t('ins.copy')}</button>
        <button class="ghost sm ins-open" type="button">${I.plus}${t('ins.open')}</button>
      </header>
      <div class="ins-privacy ${priv ? 'warn' : 'ok'}">
        <span class="ins-privacy-icon">${priv ? I.warn : I.check}</span>
        <div><b>${F.esc(priv ? t('ins.private', { n: r.private }) : t('ins.noPrivate'))}</b>
          <p>${F.esc(t(priv ? 'ins.privateSub' : 'ins.noPrivateSub'))}</p></div>
        <button class="primary ins-clean" type="button"${busy ? ' disabled' : ''}>${I.sparkles}${t('ins.clean')}</button>
      </div>
      <div class="ins-result" hidden></div>
      <div class="ins-grid">
        ${section(t('ins.file'), [['ins.f.container', r.container], ['ins.f.size', F.size(r.size)], ['ins.f.duration', r.duration && r.kind !== 'image' ? F.clock(r.duration) : null],
          ['ins.f.bitrate', rate(r.bitrate)], ['ins.f.created', r.created && when(r.created)], ['ins.f.chapters', r.chapters || null]])}
        ${r.video.map((v) => section(`${t(v.cover ? 'ins.cover' : 'ins.video')} #${v.index}`, [['ins.f.codec', v.codec], ['ins.f.profile', [v.profile, v.level && `L${v.level}`].filter(Boolean).join(' · ')],
          ['ins.f.resolution', v.width && `${v.width} × ${v.height}`], ['ins.f.aspect', [v.dar, v.sar && v.sar !== '1:1' && `SAR ${v.sar}`].filter(Boolean).join(' · ')],
          ['ins.f.fps', r.kind !== 'image' && v.fps ? `${v.fps} fps` : null], ['ins.f.pixfmt', v.pixFmt], ['ins.f.depth', v.depth && `${v.depth} bits`],
          ['ins.f.color', colour(v)], ['ins.f.rotation', v.rotation ? `${v.rotation}°` : null], ['ins.f.bitrate', rate(v.bitrate)],
          ['ins.f.frames', v.frames], ['ins.f.language', v.language]])).join('')}
        ${r.audio.map((a) => section(`${t('ins.audio')} #${a.index}`, [['ins.f.codec', a.codec], ['ins.f.profile', a.profile], ['ins.f.rate', a.rate && `${F.num(a.rate / 1000, a.rate % 1000 ? 1 : 0)} kHz`],
          ['ins.f.channels', [a.channels, a.layout].filter(Boolean).join(' · ')], ['ins.f.depth', a.depth && `${a.depth} bits`], ['ins.f.bitrate', rate(a.bitrate)], ['ins.f.language', a.language]])).join('')}
        ${r.other.map((o) => section(`${t('ins.other')} #${o.index}`, [['ins.f.type', o.type], ['ins.f.codec', o.codec], ['ins.f.language', o.language], ['ins.f.title', o.title]])).join('')}
        ${r.blocks.length ? section(t('ins.photo'), [['ins.f.blocks', r.blocks.join(' · ')]]) : ''}
      </div>
      <section class="ins-card ins-wide"><h3>${t('ins.tags')} <span class="q-count">${r.tags.length || ''}</span></h3>${tags}</section>`;
    q('.ins-open').onclick = pick;
    q('.ins-clean').onclick = cleanIt;
    q('.ins-copy').onclick = () => navigator.clipboard.writeText(text()).then(() => App.toast(t('ins.copied')));
    if (cleaned) showResult();
  }

  // Plain-text report (for a support message or a client).
  function text() {
    const r = report;
    const lines = [`${r.name}`, `${r.container} · ${F.size(r.size)}${r.duration && r.kind !== 'image' ? ` · ${F.clock(r.duration)}` : ''}`, ''];
    root.querySelectorAll('.ins-card').forEach((c) => {
      lines.push(`[${c.querySelector('h3').firstChild.textContent.trim()}]`);
      c.querySelectorAll('dt').forEach((dt) => lines.push(`${dt.textContent}: ${dt.nextElementSibling.textContent}`));
      c.querySelectorAll('tr').forEach((tr) => lines.push([...tr.children].map((td) => td.textContent).join(' · ')));
      lines.push('');
    });
    return lines.join('\n');
  }

  async function cleanIt() {
    if (!report || busy) return;
    busy = true;
    q('.ins-clean').disabled = true;
    try {
      cleaned = await window.api.clean({ id: JOB, src: report.path });
      showResult();
      App.toast(t('ins.cleaned', { name: F.base(cleaned) }));
      App.sfx('success');
    } catch (e) {
      if (!/CANCELLED/.test(String(e?.message))) { App.toast(I18n.error(e), true); App.sfx('error'); }
    }
    busy = false;
    if (q('.ins-clean')) q('.ins-clean').disabled = false;
  }

  function showResult() {
    const box = q('.ins-result');
    box.hidden = false;
    box.className = 'ins-result';
    box.draggable = true;
    box.title = t('q.dragTip');
    box.innerHTML = `<span class="badge ok">${I.check}${t('q.done')}</span><span class="name">${F.esc(F.base(cleaned))}</span>
      <button class="ghost sm ins-again" type="button">${t('ins.inspectClean')}</button>
      <button class="icon reveal" type="button" title="${F.esc(t('common.reveal'))}">${I.folder}</button>`;
    box.ondragstart = (e) => { e.preventDefault(); window.api.startDrag(cleaned); };
    box.querySelector('.reveal').onclick = () => window.api.reveal(cleaned);
    box.querySelector('.ins-again').onclick = () => open([cleaned]);
  }

  const pick = async () => open(await window.api.pickFiles());

  function mount(el) {
    root = el;
    el.innerHTML = `
      <button class="hero ins-empty" type="button">
        <span class="stack"><span class="card image">${I.image}</span><span class="card video">${I.inspect}</span><span class="card audio">${I.audio}</span></span>
        <span class="hero-title">${t('ins.hero')}</span>
        <span class="hero-sub">${t('common.browse')} <kbd>Ctrl</kbd><kbd>O</kbd></span>
        <span class="groups"><span><b class="video">${I.inspect}${t('ins.g.what')}</b>${t('ins.g.whatList')}</span><span><b class="audio">${I.sparkles}${t('ins.g.clean')}</b>${t('ins.g.cleanList')}</span><span><b class="image">${I.layers}${t('ins.g.files')}</b>${t('ins.g.filesList')}</span></span>
      </button>
      <div class="ins-body"></div>`;
    q('.ins-empty').onclick = pick;
  }

  App.register({
    id: 'inspect', label: t('ins.label'), icon: I.inspect, title: t('ins.label'), subtitle: t('ins.subtitle'),
    mount, onDrop: open, isBusy: () => busy,
    onKey(e) {
      if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); pick(); }
      else if (e.key === 'Escape' && busy && !e.target.closest?.('select')) window.api.cancel(JOB);
    },
  });
  Tools.inspect = { open };
})();
