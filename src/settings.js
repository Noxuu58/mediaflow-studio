// Settings panel (sidebar ⚙ or Ctrl+,): AI graphics card, video encoder, Vulkan version, keep the PC awake.
// Choices are stored by App (localStorage) and applied in the main process through App.setPref.
const Settings = (() => {
  const { t } = I18n;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ENCODERS = [['nvenc', 'NVIDIA NVENC'], ['qsv', 'Intel Quick Sync'], ['amf', 'AMD AMF']];
  let el, hw, lastFocus;

  function build() {
    el = document.createElement('div');
    el.id = 'settings';
    el.className = 'modal';
    el.hidden = true;
    el.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="set-title">
        <header class="modal-head"><h2 id="set-title">${t('set.title')}</h2>
          <button class="icon set-close" type="button" title="${esc(t('common.close'))}">${App.icons.x}</button></header>
        <section class="set-group">
          <h3>${t('set.gpu')}</h3>
          <label class="set-row"><span><b>${t('set.aiGpu')}</b><small>${t('set.aiGpuSub')}</small></span><select id="set-aigpu"></select></label>
          <div class="set-ai"><span class="chip" id="set-aistatus"></span><button class="ghost sm" id="set-test" type="button">${t('set.test')}</button></div>
          <div class="ai-alert" id="set-aihelp" hidden></div>
          <label class="set-row"><span><b>${t('set.encoder')}</b><small>${t('set.encoderSub')}</small></span><select id="set-encoder"></select></label>
          <div class="set-row"><span><b>${t('set.vulkan')}</b><small>${t('set.vulkanSub')}</small></span><span class="chip" id="set-vulkan">…</span></div>
        </section>
        <section class="set-group">
          <h3>${t('set.jobs')}</h3>
          <div class="set-row"><span><b>${t('set.awake')}</b><small>${t('set.awakeSub')}</small></span>
            <button class="switch" id="set-awake" type="button" role="switch" aria-label="${esc(t('set.awake'))}"><i></i></button></div>
        </section>
        <footer class="modal-foot"><small id="set-version"></small><button class="ghost sm" id="set-rescan" type="button">${App.icons.retry}${t('set.rescan')}</button></footer>
      </div>`;
    document.body.append(el);
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); }); // click outside the card
    el.querySelector('.set-close').onclick = close;
    $('#set-aigpu').onchange = (e) => App.setPref('pref.aiGpu', e.target.value).then(() => testAi(false));
    $('#set-encoder').onchange = (e) => App.setPref('pref.encoder', e.target.value);
    $('#set-test').onclick = () => testAi(true);
    $('#set-rescan').onclick = () => load(true);
    $('#set-awake').onclick = () => { const on = !App.prefs().keepAwake; App.setPref('pref.awake', on ? '1' : '0'); awakeSwitch(); };
    window.api.version().then((v) => { $('#set-version').textContent = t('set.version', { v: `v${v}` }); });
  }

  const awakeSwitch = () => $('#set-awake').setAttribute('aria-checked', String(App.prefs().keepAwake));

  // Hardware list (cached in the main process; fresh = re-scan) → the two selects and the Vulkan chip.
  async function load(fresh = false) {
    $('#set-vulkan').textContent = '…';
    hw = await window.api.hardware(fresh);
    const p = App.prefs();
    const kind = (d) => ({ discrete_gpu: t('set.dedicated'), integrated_gpu: t('set.integrated') })[d.type];
    const devs = hw.ai.devices;
    $('#set-aigpu').innerHTML = [`<option value="auto">${esc(t('set.auto'))}</option>`,
      ...devs.map((d) => `<option value="${d.id}">${esc([d.name, kind(d)].filter(Boolean).join(' · '))}</option>`)].join('');
    $('#set-aigpu').value = devs.some((d) => d.id === p.aiGpu) ? p.aiGpu : 'auto';
    $('#set-aigpu').disabled = !devs.length;
    // The saved card is gone (eGPU unplugged, driver removed…): back to Auto instead of failing every job.
    if (devs.length && p.aiGpu !== 'auto' && !devs.some((d) => d.id === p.aiGpu)) await App.setPref('pref.aiGpu', 'auto');

    const found = new Set(hw.encoders.map((e) => e.id));
    $('#set-encoder').innerHTML = [
      `<option value="auto">${esc(hw.encoders[0] ? t('set.autoIs', { v: hw.encoders[0].vendor }) : t('set.autoCpu'))}</option>`,
      ...ENCODERS.map(([id, name]) => `<option value="${id}"${found.has(id) ? '' : ' disabled'}>${esc(found.has(id) ? name : t('set.notFound', { v: name }))}</option>`),
      `<option value="cpu">${esc(t('set.cpu'))}</option>`].join('');
    $('#set-encoder').value = p.encoder === 'cpu' || found.has(p.encoder) ? p.encoder : 'auto';

    const vk = $('#set-vulkan');
    const api = devs.find((d) => d.id === $('#set-aigpu').value)?.api || devs[0]?.api;
    vk.textContent = !hw.ai.vulkan ? t('set.vulkanNone') : hw.ai.version ? `${hw.ai.version}${api && api !== hw.ai.version ? ` · GPU ${api}` : ''}` : t('set.vulkanUnknown');
    vk.className = `chip ${hw.ai.vulkan ? 'ok' : 'bad'}`;
    testAi(fresh);
  }

  // Runs the 1-second AI test on the chosen card and explains what to do when it fails.
  async function testAi(fresh) {
    const chip = $('#set-aistatus'), help = $('#set-aihelp');
    chip.className = 'chip';
    chip.textContent = t('set.testing');
    $('#set-test').disabled = true;
    const a = await window.api.aiInfo(fresh);
    $('#set-test').disabled = false;
    chip.className = `chip ${a.available ? 'ok' : 'bad'}`;
    chip.textContent = a.available ? t('set.aiOk', { v: a.gpu || 'Vulkan' }) : t('ai.none');
    help.hidden = a.available;
    if (!a.available) fillHelp(help, a.reason, hw?.vendors || [], false);
  }

  // Shared with the AI Enhance tool: the reason in plain words + a driver button per graphics vendor present.
  function fillHelp(box, reason, vendors, withSettings = true) {
    const code = reason === 'ENGINES' ? 'AI_MISSING' : `AI_${reason}`;
    const names = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel' };
    const showDrivers = reason !== 'ENGINES' && reason !== 'GPU_GONE';
    box.innerHTML = `<span class="ai-alert-icon">${App.icons.warn}</span>
      <div><b>${esc(t('ai.cantRun'))}</b><p>${esc(t(`err.${code}`))}</p>
      <div class="ai-alert-actions">${showDrivers ? vendors.map((v) => `<button class="ghost sm" type="button" data-vendor="${v}">${esc(t('ai.drivers'))} · ${names[v]}</button>`).join('') : ''}
      ${withSettings ? `<button class="ghost sm" type="button" data-settings>${esc(t('ai.openSettings'))}</button>` : ''}</div></div>`;
    box.querySelectorAll('[data-vendor]').forEach((b) => b.onclick = () => window.api.driverPage(b.dataset.vendor));
    box.querySelector('[data-settings]')?.addEventListener('click', open);
  }

  function open() {
    if (!el) build();
    if (!el.hidden) return;
    lastFocus = document.activeElement;
    el.hidden = false;
    document.body.classList.add('modal-open');
    awakeSwitch();
    load(false);
    el.querySelector('.set-close').focus();
  }
  function close() {
    if (!el || el.hidden) return;
    el.hidden = true;
    document.body.classList.remove('modal-open');
    lastFocus?.focus?.();
  }

  addEventListener('DOMContentLoaded', () => { $('#settings-open').onclick = open; });
  addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === ',') { e.preventDefault(); open(); }
    else if (e.key === 'Escape' && el && !el.hidden) { e.stopImmediatePropagation(); close(); }
  }, true);

  return { open, close, fillHelp };
})();
