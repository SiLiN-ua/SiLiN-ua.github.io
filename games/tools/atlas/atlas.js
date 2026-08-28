// tools/atlas/atlas.js
// ATLAS — location & professional-record lookup surface.
// Session 5.4 scope: geographic evidence exhibit for claim detail.
// This is a corroboration layer, not a map app. Absence of a record is not
// proof of a false claim — the note copy in each detail makes that explicit.

import { isInEvidence } from '../../engine/state.js';
import { emit as emitAction } from '../../engine/actions.js';
import { t, pick } from '../../engine/i18n.js';
import { resolveAsset } from '../../engine/case-loader.js';

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
    // S7.3.6 — case-scoped trigger list per VIDEO_EVIDENCE_SPEC §13 Q1.
    // No fuzzy scoring, no synonym engine — exact match against authored triggers.
    if (Array.isArray(art.triggers)) {
      for (const trig of art.triggers) {
        if (normalize(trig) === needle) return art;
      }
    }
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
        ${view.submitted ? renderResultList(search, caseData) : ''}
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
    // S7.4a — emit search action per ACTION_BUS_CONTRACT §2.2.
    const hit = findSearchByQuery(caseData, view.query);
    emitAction('search', {
      tool: 'atlas',
      query: view.query,
      resultCount: hit && Array.isArray(hit.results) ? hit.results.length : 0,
    });
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

function renderResultList(search, caseData) {
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
      ${results.map(r => {
        // Hydrate row with subject-name/avatar from the target claim artifact
        // so the results list reads like TRACE (face + name + handle).
        const claim = caseData.artifacts[r.id] || {};
        const avatarSrc = claim.avatar ? resolveAsset(caseData, claim.avatar) : '';
        const subjectName = pick(claim, 'subject_name') || claim.subject || r.subject;
        return `
        <li class="atlas-result" data-open-claim="${esc(r.id)}" role="button" tabindex="0">
          <div class="atlas-result__face">
            ${avatarSrc ? `<img src="${esc(avatarSrc)}" alt="">` : ''}
          </div>
          <div class="atlas-result__body">
            <div class="atlas-result__title">
              <span class="atlas-result__name">${esc(subjectName)}</span>
              <span class="atlas-result__handle">${esc(r.subject)}</span>
            </div>
            <div class="atlas-result__status">${esc(r.status)}</div>
            <div class="atlas-result__line">${esc(pick(r, 'line'))}</div>
          </div>
          <div class="atlas-result__action">
            <span class="atlas-inspect" aria-hidden="true">${t('atlas.results.inspect')}</span>
          </div>
        </li>
      `;
      }).join('')}
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
  const subjectName = pick(claim, 'subject_name') || claim.subject;
  const avatarSrc = claim.avatar ? resolveAsset(caseData, claim.avatar) : '';
  const mapSrc = claim.map_source ? resolveAsset(caseData, claim.map_source) : '';
  const insetSrc = claim.inset ? resolveAsset(caseData, claim.inset) : '';
  const insetCaption = pick(claim, 'inset_caption') || '';
  const pin = claim.map_pin || null;

  const recordsHtml = (claim.records_searched || []).map(r => `
    <li class="atlas-record">
      <span class="atlas-record__name">${esc(pick(r, 'name'))}</span>
      <span class="atlas-record__result">${esc(pick(r, 'result'))}</span>
    </li>
  `).join('');

  // LEFT column: map (or nothing if not authored).
  const mapHtml = mapSrc ? `
    <div class="atlas-map" style="background-image:url('${esc(mapSrc)}')">
      ${pin ? `<div class="atlas-map__pin" style="left:${(pin.x * 100).toFixed(2)}%;top:${(pin.y * 100).toFixed(2)}%"></div>` : ''}
    </div>
  ` : '';

  // RIGHT column: face + subject + status + records + note.
  const factsHtml = `
    <div class="atlas-facts">
      <div class="atlas-facts__head">
        ${avatarSrc ? `<div class="atlas-facts__avatar"><img src="${esc(avatarSrc)}" alt=""></div>` : ''}
        <div class="atlas-facts__head-text">
          <div class="atlas-facts__name">${esc(subjectName)}</div>
          <div class="atlas-facts__location">${esc(locationClaimed)}</div>
        </div>
      </div>
      <div class="atlas-facts__status-row">
        <span class="atlas-facts__k">${t('atlas.claim.field.status')}</span>
        <span class="atlas-facts__status">${esc(claim.status)}</span>
      </div>
      <div class="atlas-facts__records">
        <div class="atlas-facts__k">${t('atlas.claim.field.records')}</div>
        <ul class="atlas-records">${recordsHtml}</ul>
      </div>
      ${note ? `<div class="atlas-facts__note">${esc(note)}</div>` : ''}
    </div>
  `;

  // Inset — small facade card below map/facts. No explanatory copy about
  // continuity with post_01. Composition is the argument.
  const insetHtml = insetSrc ? `
    <div class="atlas-claim__inset-row">
      <div class="atlas-inset">
        <div class="tx-letterbox tx-letterbox--doc">
          <img src="${esc(insetSrc)}" alt="">
        </div>
        ${insetCaption ? `<div class="atlas-inset__caption">${esc(insetCaption)}</div>` : ''}
      </div>
    </div>
  ` : '';

  paneEl.innerHTML = `
    <div class="atlas-claim atlas-claim--exhibit">
      <div class="trace__breadcrumb">
        <button class="link-back" data-action="back-to-search">← ${t('atlas.breadcrumb')}</button>
        <span class="trace__breadcrumb-sep">/</span>
        <span>${esc(subjectName)} · ${esc(locationClaimed)}</span>
      </div>

      <div class="atlas-claim__title">${t('atlas.claim.title')}</div>

      <div class="atlas-claim__exhibit">
        ${mapHtml ? `<div class="atlas-claim__map-col">${mapHtml}</div>` : ''}
        <div class="atlas-claim__facts-col">${factsHtml}</div>
      </div>

      ${insetHtml}

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
