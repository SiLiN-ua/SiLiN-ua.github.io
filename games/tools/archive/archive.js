// tools/archive/archive.js
// ARCHIVE — historical snapshots of a public URL / handle.
// Snapshots render as reconstructed cached web pages (S5.2), not ledger cards.

import { isInEvidence } from '../../engine/state.js';
import { emit as emitAction } from '../../engine/actions.js';
import { resolveAsset } from '../../engine/case-loader.js';
import { t, pick } from '../../engine/i18n.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtCapturedUtc(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function fmtNumber(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return v.toLocaleString('en-US').replace(/,/g, ' ');
  return String(v);
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
      const id = btn.dataset.openSnapshot;
      view.activeSnapshotId = id;
      emitAction('open_artifact', { artifactId: id, tool: 'archive' });
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
  const snaps = (search.snapshots || []).slice();
  const source = search.source_url || search.query;
  const metaKey = snaps.length === 1 ? 'archive.meta.one' : 'archive.meta.many';
  const meta = t(metaKey, { n: snaps.length, source: `<b>${esc(source)}</b>` });
  const capturedLabel = t('archive.snapshot.captured');
  return `
    <div class="archive__meta">${meta}</div>
    <ul class="archive__list">
      ${snaps.map(s => `
        <li class="archive-item">
          <div class="archive-item__date">
            <span class="archive-item__captured">${esc(capturedLabel)}</span>
            <span class="archive-item__stamp">${esc(fmtCapturedUtc(s.captured_at_iso) || s.captured_at)}</span>
          </div>
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
  const capturedUtc = fmtCapturedUtc(snap.captured_at_iso) || snap.captured_at || '';
  const url = snap.source_url || '';
  const prof = snap.profile_snapshot || null;

  const bodyHtml = prof
    ? renderProfileBody(caseData, prof, capturedUtc)
    : renderLegacyBody(caseData, snap);

  paneEl.innerHTML = `
    <div class="snapshot">
      <div class="trace__breadcrumb">
        <button class="link-back" data-action="back-to-snapshots">← ${t('archive.breadcrumb')}</button>
        <span class="trace__breadcrumb-sep">/</span>
        <span>${esc(capturedUtc)}</span>
      </div>

      <div class="tx-browser-chrome archive-chrome">
        <div class="tx-browser-chrome__bar">
          <span class="tx-browser-chrome__nav" aria-hidden="true">&lsaquo;&nbsp;&rsaquo;</span>
          <span class="tx-browser-chrome__dots"><i></i></span>
          <span class="tx-browser-chrome__url">${esc(url)}</span>
          <span class="tx-browser-chrome__tag archive-cached-tag">
            ${t('archive.detail.chrome_tag')} · ${esc(capturedUtc)}
          </span>
        </div>
        <div class="tx-browser-chrome__body archive-body">
          ${bodyHtml}
        </div>
      </div>

      <div class="frame-actions archive-actions">
        <button class="btn-primary" data-action="add-to-case" data-artifact-id="${esc(snap.id)}" ${already ? 'disabled' : ''}>
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
    emitAction('add_to_case', { artifactId: snap.id, tool: 'archive' });
    if (isInEvidence(snap.id)) {
      addBtn.disabled = true;
      addBtn.textContent = t('frame.actions.saved');
      ctx.onEvidenceAdded && ctx.onEvidenceAdded();
    }
  });
}

function renderProfileBody(caseData, prof, capturedUtc) {
  const avatarSrc = prof.avatar ? resolveAsset(caseData, prof.avatar) : '';
  const bio = pick(prof, 'bio') || '';
  const joined = pick(prof, 'joined') || '';
  const location = pick(prof, 'location') || '';
  const posts = Array.isArray(prof.posts) ? prof.posts : [];

  const stats = `
    <ul class="archive-body__stats">
      <li><b>${fmtNumber(prof.posts_count)}</b> <span>${t('frame.stats.posts')}</span></li>
      <li><b>${fmtNumber(prof.followers_count)}</b> <span>${t('frame.stats.followers')}</span></li>
      <li><b>${fmtNumber(prof.following_count)}</b> <span>${t('frame.stats.following')}</span></li>
    </ul>
  `;

  const postsHtml = posts.length
    ? `<div class="archive-body__grid">
         ${posts.map(p => {
           const src = p.cover ? resolveAsset(caseData, p.cover) : '';
           const cap = pick(p, 'caption') || '';
           return `<figure class="archive-body__tile">
             <div class="tx-letterbox tx-letterbox--square">
               ${src ? `<img src="${esc(src)}" alt="${esc(cap)}" loading="lazy">` : ''}
             </div>
           </figure>`;
         }).join('')}
       </div>`
    : `<div class="archive-body__empty">${t('archive.snapshot.no_posts')}</div>`;

  return `
    <div class="archive-body__stamp">${esc(capturedUtc)}</div>

    <header class="archive-body__header">
      <div class="archive-body__avatar tx-letterbox tx-letterbox--square">
        ${avatarSrc ? `<img src="${esc(avatarSrc)}" alt="">` : ''}
      </div>
      <div class="archive-body__meta">
        <div class="archive-body__handle">@${esc(prof.username || '')}</div>
        <div class="archive-body__name">${esc(prof.display_name || '')}</div>
        ${bio ? `<div class="archive-body__bio">${esc(bio).replace(/\n/g,'<br>')}</div>` : ''}
        <div class="archive-body__footer">
          ${location ? `<span>${esc(location)}</span>` : ''}
          ${joined ? `<span>${esc(joined)}</span>` : ''}
        </div>
      </div>
    </header>

    ${stats}

    <section class="archive-body__posts">
      ${postsHtml}
    </section>
  `;
}

function renderLegacyBody(caseData, snap) {
  const previewSrc = snap.preview ? resolveAsset(caseData, snap.preview) : '';
  const note = pick(snap, 'note');
  const caption = pick(snap, 'caption');
  return `
    <div class="archive-body__legacy">
      ${previewSrc ? `<div class="snapshot__preview">
        <img src="${esc(previewSrc)}" alt="archive snapshot preview">
        ${caption ? `<div class="snapshot__preview-caption">${esc(caption)}</div>` : ''}
      </div>` : ''}
      <div class="snapshot__note">
        <div class="snapshot__note-body">${esc(note)}</div>
      </div>
    </div>
  `;
}
