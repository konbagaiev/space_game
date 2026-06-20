// Client-side localization. English is the source of truth (`locales/source.json`); each
// language is a derived layer (`locales/<lang>.json`). Resolution happens entirely here —
// the DB/API stay language-agnostic (they carry stable keys, not display text). See DECISIONS §10.
//
// Pure helpers (normalizeLang/resolveLanguage/t) take their inputs explicitly so they're
// unit-testable without a browser; loadLanguage() is the only impure part (it fetches catalogs).

export const SUPPORTED = ['en', 'ru'];
export const DEFAULT_LANG = 'en';

let source = {}; // { key: { source, context } } — canonical English + translator notes
let bundle = {}; // { key: value } — active-language overrides (empty for English)
let current = DEFAULT_LANG;

// Test/seed hooks: set the catalogs directly (loadLanguage uses these under the hood).
export function setSource(src) { source = src || {}; }
export function setBundle(bnd) { bundle = bnd || {}; }
export function getLanguage() { return current; }

// Map a raw BCP-47 tag (e.g. 'ru-RU') to a supported code, falling back to English.
export function normalizeLang(tag) {
  const base = String(tag || '').toLowerCase().split('-')[0];
  return SUPPORTED.includes(base) ? base : DEFAULT_LANG;
}

// Resolution order: explicit local choice → server-stored preference → browser language → en.
// All inputs are passed in so this stays a pure function (the caller reads localStorage/navigator).
export function resolveLanguage({ explicit, server, browser } = {}) {
  if (explicit && SUPPORTED.includes(explicit)) return explicit;
  if (server && SUPPORTED.includes(server)) return server;
  return normalizeLang(browser);
}

// Resolve a key to the active language with simple {var} interpolation. Missing translation →
// English source → the key itself (a missing string degrades visibly, it never throws).
export function t(key, params) {
  let s = (bundle[key] != null) ? bundle[key]
        : (source[key] && source[key].source != null) ? source[key].source
        : key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, name) => (params[name] != null ? String(params[name]) : m));
  return s;
}

// Load the canonical source catalog (once) + the active language bundle. `fetchJson(url)` is
// injected (the client passes its own helper). English needs no bundle — it lives in source.json.
export async function loadLanguage(lang, fetchJson) {
  current = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
  if (!Object.keys(source).length) setSource(await fetchJson('locales/source.json'));
  setBundle(current === DEFAULT_LANG ? {} : await fetchJson(`locales/${current}.json`).catch(() => ({})));
  return current;
}
