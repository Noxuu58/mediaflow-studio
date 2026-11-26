// Personal presets of the Converter: a name + the Advanced settings, stored in the window and shared as JSON files.
// Files come from anywhere, so every value is checked against the lists the engine accepts (convert.js ADVANCED).
const { ADVANCED } = require('./convert');

const KEYS = ['codec', 'container', 'depth', 'fps', 'height', 'audio', 'tracks', 'gpu']; // the Converter's Advanced panel
const MAX = 100;
const invalid = () => new Error('PRESET_INVALID');

function clean(p) {
  const name = typeof p?.name === 'string' ? p.name.trim().slice(0, 60) : '';
  if (!name || !p.options || typeof p.options !== 'object' || Array.isArray(p.options)) throw invalid();
  const options = {};
  for (const [k, v] of Object.entries(p.options)) {
    if (!KEYS.includes(k) || !ADVANCED[k].includes(String(v))) throw invalid();
    options[k] = String(v);
  }
  return { name, options };
}

// File text → [{ name, options }]. Accepts a pack ({ presets: [...] }) or a single preset ({ name, options }).
function parse(text) {
  let json;
  try { json = JSON.parse(String(text)); } catch { throw invalid(); }
  const list = Array.isArray(json?.presets) ? json.presets : json?.name ? [json] : null;
  if (!list?.length || list.length > MAX) throw invalid();
  return list.map(clean);
}

const serialize = (list) => `${JSON.stringify({ app: 'MediaFlow Studio', type: 'presets', version: 1, presets: list.map(clean) }, null, 2)}\n`;

module.exports = { parse, serialize, clean, KEYS };
