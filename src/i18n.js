// Translations: one file per language in src/locales/ (loaded before this one), English is the reference and
// the fallback for any missing key. The choice is stored in localStorage ('lang').
// A value is a string with {placeholders} or a function of the vars (for plurals).
// To add a language: copy src/locales/en.js, translate it, add its <script> line in index.html and its code to ORDER.
const I18n = (() => {
  const ORDER = ['en', 'fr', 'es', 'de', 'pt', 'it', 'zh', 'ja', 'ko']; // order shown in Settings
  const all = globalThis.MF_LOCALES || {};
  const codes = ORDER.filter((c) => all[c]);
  const dict = Object.fromEntries(codes.map((c) => [c, all[c].strings]));
  const LANGS = Object.fromEntries(codes.map((c) => [c, all[c].name])); // native names: English, Français, 日本語…
  const HTML_LANG = { zh: 'zh-CN' }; // lets CSS and fonts pick Simplified Chinese glyphs
  let lang = 'en';
  try { lang = dict[localStorage.getItem('lang')] ? localStorage.getItem('lang') : 'en'; } catch {}
  document.documentElement.lang = HTML_LANG[lang] || lang;

  function t(key, vars = {}) {
    const v = dict[lang][key] ?? dict.en[key] ?? key;
    return typeof v === 'function' ? v(vars) : v.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  }
  // Backend errors arrive as codes ("CANCELLED", "PLAYLIST:12"); anything else is shown as-is.
  function error(e) {
    const msg = String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    const [, code, arg] = /^([A-Z_]+)(?::(.*))?$/.exec(msg) || [];
    return code && dict.en[`err.${code}`] ? t(`err.${code}`, { n: arg }) : msg;
  }
  // Static markup: data-i18n (text), data-i18n-title (tooltip).
  function apply(root) {
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  }
  return { t, error, apply, LANGS, dict, get lang() { return lang; } };
})();
