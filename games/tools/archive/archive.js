// tools/archive/archive.js
// ARCHIVE — historical snapshots of a public URL / handle.
// Snapshots are presented as historical documents — NOT live profiles.

import { addEvidence, isInEvidence } from '../../engine/state.js';
import { resolveAsset } from '../../engine/case-loader.js';
import { t, pick } from '../../engine/i18n.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const view = {
  query: '',
  submitted: false,
  activeSnapshotId: null,
};

function findSearchByQuery(caseData, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return null;
  for (const key of Object.keys(caseData.artifacts)) {
    const art = caseData.artifacts[key];
    if (art.type !== 'archive_search') continue;
    const q1 = String(art.query || '').toLowerCase();
    const q2 = String(art.source_url || '').toLowerCase();
    if (q1 === needle || q2 === needle || q2.endsWith('/' + needle)) return art;
  }
  return null;
}

export function renderArchive(paneEl, caseData, ctx) {
  if (view.activeSnapshotId) {
    renderSnapshotDetail(paneEl, caseData, ctx);
  } else {
    renderSearch(paneEl, caseData, ctx);
  }
}

function renderSearch(paneEl, caseData, ctx) {
  const search = view.submitted ? findSearchByQuery(caseData, view.query) : null;

  paneEl.innerHTML = `
    <div class="archive">
      <div class="archive__header">
        <div class="archive__label">${t('archive.label')}</div>
        <form class="archive__form" data-form="archive-search" autocomplete="off">
          <input class="archive__input" type="text" name="q"
                 placeholder="${esc(t('archive.placeholder'))}"
                 value="${esc(view.query)}">
          <button class="btn-primary" type="submit">${t('archive.button.search')}</button>
        </form>
        <div class="archive__hint">
          ${t('archive.hint')}
        </div>
      </div>

      <div class="archive__results">
        ${view.submitted ? renderSnapshotList(search) : ''}
      </div>
    </div>
  `;

  const form = paneEl.querySelector('[data-form="archive-search"]');
  const input = form.querySelector('input[name="q"]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    view.query = input.value.trim();
    view.submitted = true;
    view.activeSnapshotId = null;
    renderArchive(paneEl, caseData, ctx);
  });

  paneEl.querySelectorAll('[data-open-snapshot]').forEach(btn => {
    btn.addEventListener('click', () => {
      view.activeSnapshotId = btn.dataset.openSnapshot;
      renderArchive(paneEl, caseData, ctx);
    });
  });
}

function renderSnapshotList(search) {
  if (!search) {
    return `
      <div class="archive__empty">
        <div class="archive__empty-title">${t('archive.empty.title')}</div>
        <div class="archive__empty-note">${t('archive.empty.note')}</div>
      </div>
    `;
  }
  const snaps = search.snapshots || [];
  const source = search.source_url || search.query;
  const metaKey = snaps.length === 1 ? 'archive.meta.one' : 'archive.meta.many';
  const meta = t(metaKey, { n: snaps.length, source: `<b>${esc(source)}</b>` });
  return `
    <div class="archive__meta">${meta}</div>
    <ul class="archive__list">
      ${snaps.map(s => `
        <li class="archive-item">
          <div class="archive-item__date">${esc(s.captured_at)}</div>
          <div class="archive-item__body">
            <div class="archive-item__url">${esc(source)}</div>
            <div class="archive-item__note">${esc(pick(s, 'note'))}</div>
          </div>
          <div class="archive-item__action">
            <button class="btn-ghost" data-open-snapshot="${esc(s.id)}">${t('archive.results.inspect')}</button>
          </div>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderSnapshotDetail(paneEl, caseData, ctx) {
  const snap = caseData.artifacts[view.activeSnapshotId];
  if (!snap) {
    view.activeSnapshotId = null;
    renderArchive(paneEl, caseData, ctx);
    return;
  }
  const already = isInEvidence(snap.id);
  const previewSrc = snap.preview ? resolveAsset(caseData, snap.preview) : '';
  const kindLabel = pick(snap, 'kind_label') || snap.kind || '—';
  const note = pick(snap, 'note');
  const caption = pick(snap, 'caption');

  paneEl.innerHTML = `
    <div class="snapshot">
      <div class="trace__breadcrumb">
        <button class="link-back" data-action="back-to-snapshots">← ${t('archive.breadcrumb')}</button>
        <span class="trace__breadcrumb-sep">/</span>
        <span>${esc(snap.captured_at)}</span>
      </div>

      <div class="snapshot__title">${t('archive.snapshot.title')}</div>

      <div class="snapshot__grid">
        <div class="snapshot__field">
          <div class="snapshot__field-label">${t('archive.snapshot.field.captured')}</div>
          <div class="snapshot__field-value">${esc(snap.captured_at)}</div>
        </div>
        <div class="snapshot__field">
          <div class="snapshot__field-label">${t('archive.snapshot.field.source')}</div>
          <div class="snapshot__field-value snapshot__field-value--mono">${esc(snap.source_url)}</div>
        </div>
        <div class="snapshot__field">
          <div class="snapshot__field-label">${t('archive.snapshot.field.kind')}</div>
          <div class="snapshot__field-value">${esc(kindLabel)}</div>
        </div>
      </div>

      ${previewSrc ? `
        <div class="snapshot__preview">
          <img src="${esc(previewSrc)}" alt="archive snapshot preview">
          ${caption ? `<div class="snapshot__preview-caption">${esc(caption)}</div>` : ''}
        </div>
      ` : ''}

      <div class="snapshot__note">
        <div class="snapshot__field-label">${t('archive.snapshot.field.note')}</div>
        <div class="snapshot__note-body">${esc(note)}</div>
      </div>

      <div class="frame-actions">
        <button class="btn-primary" data-action="add-to-case" ${already ? 'disabled' : ''}>
          ${already ? t('frame.actions.saved') : t('archive.actions.add')}
        </button>
        <button class="btn-ghost" data-action="back-to-snapshots">${t('archive.actions.back')}</button>
      </div>
    </div>
  `;

  paneEl.querySelectorAll('[data-action="back-to-snapshots"]').forEach(btn => {
    btn.addEventListener('click', () => {
      view.activeSnapshotId = null;
      renderArchive(paneEl, caseData, ctx);
    });
  });

  const addBtn = paneEl.querySelector('[data-action="add-to-case"]');
  addBtn.addEventListener('click', () => {
    if (addBtn.disabled) return;
    const ev = addEvidence(snap);
    if (ev) {
      addBtn.disabled = true;
      addBtn.textContent = t('frame.actions.saved');
      ctx.onEvidenceAdded && ctx.onEvidenceAdded(ev);
    }
  });
}
