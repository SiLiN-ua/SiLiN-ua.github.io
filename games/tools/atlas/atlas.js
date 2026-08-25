// tools/atlas/atlas.js
// ATLAS — location & professional-record lookup surface.
// Session 5 scope: two authored queries, results list, claim detail view.
// This is a corroboration layer, not a map. Absence of a record is not proof
// of a false claim — the copy in each detail makes that explicit.
// (Deliberately not reusing FRAME / CHAT / ARCHIVE renderers; each surface has
//  its own field set and the difference is part of what the player is learning.)

import { isInEvidence } from '../../engine/state.js';
import { emit as emitAction } from '../../engine/actions.js';
import { t, pick } from '../../engine/i18n.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Per-tool navigation state. Runtime only — not persisted across reloads.
const view = {
  query: '',
  submitted: false,
  activeClaimId: null,
};

function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

function findSearchByQuery(caseData, q) {
  const needle = normalize(q);
  if (!needle) return null;
  for (const key of Object.keys(caseData.artifacts)) {
    const art = caseData.artifacts[key];
    if (art.type !== 'atlas_search') continue;
    if (normalize(art.query) === needle) return art;
  }
  return null;
}

export function renderAtlas(paneEl, caseData, ctx) {
  if (view.activeClaimId) {
    renderClaimDetail(paneEl, caseData, ctx);
  } else {
    renderSearch(paneEl, caseData, ctx);
  }
}

function renderSearch(paneEl, caseData, ctx) {
  const search = view.submitted ? findSearchByQuery(caseData, view.query) : null;

  paneEl.innerHTML = `
    <div class="atlas">
      <div class="atlas__header">
        <div class="atlas__label">${t('atlas.label')}</div>
        <form class="atlas__form" data-form="atlas-search" autocomplete="off">
          <input class="atlas__input" type="text" name="q"
                 placeholder="${esc(t('atlas.placeholder'))}"
                 value="${esc(view.query)}">
          <button class="btn-primary" type="submit">${t('atlas.button.search')}</button>
        </form>
        <div class="atlas__hint">
          ${t('atlas.hint')}
        </div>
      </div>

      <div class="atlas__results">
        ${view.submitted ? renderResultList(search) : ''}
      </div>
    </div>
  `;

  const form = paneEl.querySelector('[data-form="atlas-search"]');
  const input = form.querySelector('input[name="q"]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    view.query = input.value.trim();
    view.submitted = true;
    view.activeClaimId = null;
    renderAtlas(paneEl, caseData, ctx);
  });

  paneEl.querySelectorAll('[data-open-claim]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.openClaim;
      view.activeClaimId = id;
      emitAction('open_artifact', { artifactId: id, tool: 'atlas' });
      renderAtlas(paneEl, caseData, ctx);
    });
  });
}

function renderResultList(search) {
  if (!search) {
    return `
      <div class="atlas__empty">
        <div class="atlas__empty-title">${t('atlas.empty.title')}</div>
        <div class="atlas__empty-note">${t('atlas.empty.note')}</div>
      </div>
    `;
  }
  const results = search.results || [];
  const metaKey = results.length === 1 ? 'atlas.meta.one' : 'atlas.meta.many';
  const meta = t(metaKey, { n: results.length, location: `<b>${esc(search.query)}</b>` });
  return `
    <div class="atlas__meta">${meta}</div>
    <ul class="atlas__list">
      ${results.map(r => `
        <li class="atlas-result">
          <div class="atlas-result__body">
            <div class="atlas-result__subject">${esc(r.subject)}</div>
            <div class="atlas-result__status">${esc(r.status)}</div>
            <div class="atlas-result__line">${esc(pick(r, 'line'))}</div>
          </div>
          <div class="atlas-result__action">
            <button class="btn-ghost" data-open-claim="${esc(r.id)}">${t('atlas.results.inspect')}</button>
          </div>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderClaimDetail(paneEl, caseData, ctx) {
  const claim = caseData.artifacts[view.activeClaimId];
  if (!claim) {
    view.activeClaimId = null;
    renderAtlas(paneEl, caseData, ctx);
    return;
  }
  const already = isInEvidence(claim.id);
  const locationClaimed = pick(claim, 'location_claimed');
  const note = pick(claim, 'note');

  const recordsHtml = (claim.records_searched || []).map(r => `
    <li class="atlas-record">
      <span class="atlas-record__name">${esc(pick(r, 'name'))}</span>
      <span class="atlas-record__result">${esc(pick(r, 'result'))}</span>
    </li>
  `).join('');

  paneEl.innerHTML = `
    <div class="atlas-claim">
      <div class="trace__breadcrumb">
        <button class="link-back" data-action="back-to-search">← ${t('atlas.breadcrumb')}</button>
        <span class="trace__breadcrumb-sep">/</span>
        <span>${esc(claim.subject)} · ${esc(locationClaimed)}</span>
      </div>

      <div class="atlas-claim__title">${t('atlas.claim.title')}</div>

      <div class="atlas-claim__grid">
        <div class="atlas-claim__field">
          <div class="atlas-claim__label">${t('atlas.claim.field.subject')}</div>
          <div class="atlas-claim__value">${esc(claim.subject)}</div>
        </div>
        <div class="atlas-claim__field">
          <div class="atlas-claim__label">${t('atlas.claim.field.location_claimed')}</div>
          <div class="atlas-claim__value">${esc(locationClaimed)}</div>
        </div>
        <div class="atlas-claim__field">
          <div class="atlas-claim__label">${t('atlas.claim.field.status')}</div>
          <div class="atlas-claim__value atlas-claim__status">${esc(claim.status)}</div>
        </div>
      </div>

      <div class="atlas-claim__records">
        <div class="atlas-claim__label">${t('atlas.claim.field.records')}</div>
        <ul class="atlas-records">${recordsHtml}</ul>
      </div>

      <div class="atlas-claim__note">
        <div class="atlas-claim__label">${t('atlas.claim.field.note')}</div>
        <div class="atlas-claim__note-body">${esc(note)}</div>
      </div>

      <div class="frame-actions">
        <button class="btn-primary" data-action="add-to-case" data-artifact-id="${esc(claim.id)}" ${already ? 'disabled' : ''}>
          ${already ? t('frame.actions.saved') : t('atlas.actions.add')}
        </button>
        <button class="btn-ghost" data-action="back-to-search">${t('atlas.actions.back')}</button>
      </div>
    </div>
  `;

  paneEl.querySelectorAll('[data-action="back-to-search"]').forEach(btn => {
    btn.addEventListener('click', () => {
      view.activeClaimId = null;
      renderAtlas(paneEl, caseData, ctx);
    });
  });

  const addBtn = paneEl.querySelector('[data-action="add-to-case"]');
  addBtn.addEventListener('click', () => {
    if (addBtn.disabled) return;
    emitAction('add_to_case', { artifactId: claim.id, tool: 'atlas' });
    if (isInEvidence(claim.id)) {
      addBtn.disabled = true;
      addBtn.textContent = t('frame.actions.saved');
      ctx.onEvidenceAdded && ctx.onEvidenceAdded();
    }
  });
}
