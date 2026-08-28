// engine/i18n.js
// Localization runtime for Case Zero. Deliberately separate from the
// investigation state module (engine/state.js) — the active language is a
// display setting, never an investigation fact.
//
// Two APIs:
//   t(key, vars)         — resolve a UI-chrome string from games/i18n.json
//   pick(obj, base)      — read a localized field from a case-content object
//                          using the *_uk / *_en suffix convention
//
// Fallback chain for both:
//   current language → 'en' → legacy base (only in pick) → empty string
//
// Neither function throws. A missing key returns "[key]" so it's visible in
// UI without crashing the render. This keeps missing-string regressions
// loud but non-fatal.

const LANG_KEY = 'cz.lang.v1';
const DEFAULT_LANG = 'en';
const SUPPORTED = new Set(['en', 'uk']);

let currentLang = DEFAULT_LANG;
let dictionary = null;       // { en: {...}, uk: {...} }
const listeners = new Set();

// ---- language state ----

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (!SUPPORTED.has(lang) || lang === currentLang) return;
  currentLang = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
  for (const fn of listeners) {
    try { fn(lang); } catch (e) { console.warn('[i18n] listener error', e); }
  }
}

export function subscribeLang(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---- boot ----

export async function initI18n() {
  // Restore persisted language selection, if any.
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored && SUPPORTED.has(stored)) currentLang = stored;
  } catch { /* ignore */ }

  // Load dictionary once.
  try {
    const res = await fetch('i18n.json', { cache: 'no-cache' });
    if (res.ok) dictionary = await res.json();
    else dictionary = { en: {}, uk: {} };
  } catch (err) {
    console.warn('[i18n] dictionary load failed', err);
    dictionary = { en: {}, uk: {} };
  }
}

// ---- UI-chrome lookup ----

function lookup(key, lang) {
  const bag = dictionary && dictionary[lang];
  if (!bag) return undefined;
  return bag[key];
}

function interpolate(str, vars) {
  if (!vars) return str;
  return String(str).replace(/\{(\w+)\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : '{' + k + '}'
  );
}

export function t(key, vars) {
  if (!key) return '';
  let v = lookup(key, currentLang);
  if (v == null) v = lookup(key, 'en');
  if (v == null) return '[' + key + ']';
  return interpolate(v, vars);
}

// ---- case-content lookup ----

export function pick(obj, base) {
  if (!obj || !base) return '';
  const langKey = base + '_' + currentLang;
  if (obj[langKey] != null && obj[langKey] !== '') return obj[langKey];
  const enKey = base + '_en';
  if (obj[enKey] != null && obj[enKey] !== '') return obj[enKey];
  if (obj[base] != null) return obj[base];   // legacy fallback
  return '';
}
