// Credits / attribution panel: data-driven from the build-generated credits-data.js (single source of
// truth = client/assets/CREDITS.md). Opened from the Settings overlay; a scrollable, closeable overlay.
// Chrome labels are i18n; attribution content (authors/titles/URLs/licenses) is literal legal text.
// A leaf module: self-inits its listeners at import; the only export is the localize hook (called on a
// language switch). Every data field is set via textContent (no innerHTML with data) to avoid injection.
import { CREDITS } from './credits-data.js';
import { t } from './i18n.js';

const overlay = document.getElementById('credits-overlay');
const list = document.getElementById('credits-list');

document.getElementById('credits-open').addEventListener('click', () => { render(); overlay.classList.add('on'); });
document.getElementById('credits-close').addEventListener('click', () => overlay.classList.remove('on'));
overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('on'); }); // backdrop closes

// External link with the literal `text`, opening in a new tab and severing the opener reference.
function extLink(href, text) {
  const a = document.createElement('a');
  a.href = href; a.target = '_blank'; a.rel = 'noopener';
  a.textContent = text;
  return a;
}

// One credit row: bold name, "by {author}", a Source link (if a.url), a license link/label, and a
// "Modified" chip (CC-BY derivatives only).
function assetRow(a) {
  const row = document.createElement('div');
  row.className = 'credit-item';

  const name = document.createElement('span');
  name.className = 'credit-name';
  name.textContent = a.name;
  row.appendChild(name);

  const by = document.createElement('span');
  by.className = 'credit-by';
  by.textContent = t('ui.credits.by', { author: a.author });
  row.appendChild(by);

  const meta = document.createElement('span');
  meta.className = 'credit-meta';
  if (a.url) meta.appendChild(extLink(a.url, t('ui.credits.source')));
  // License: a link when we have a license URL (CC-BY), else plain literal text (CC0 / Pixabay).
  const lic = a.licenseUrl ? extLink(a.licenseUrl, a.license) : document.createElement('span');
  if (!a.licenseUrl) lic.textContent = a.license;
  lic.classList.add('credit-license');
  meta.appendChild(lic);
  if (a.modified) {
    const chip = document.createElement('span');
    chip.className = 'credit-modified';
    chip.textContent = t('ui.credits.modified');
    meta.appendChild(chip);
  }
  row.appendChild(meta);
  return row;
}

function section(titleKey, assets) {
  const title = document.createElement('div');
  title.className = 'credit-section-title';
  title.textContent = t(titleKey);
  list.appendChild(title);
  assets.forEach((a) => list.appendChild(assetRow(a)));
}

function render() {
  list.innerHTML = '';
  section('ui.credits.models', CREDITS.models);
  section('ui.credits.sounds', CREDITS.sounds);
}

// Re-render the open panel on a language switch (chrome labels change; data stays literal).
export function localizeCredits() { if (overlay.classList.contains('on')) render(); }
