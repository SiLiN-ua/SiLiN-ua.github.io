// tools/atlas/atlas.js
// ATLAS — location & professional-record lookup surface.
// Session 5 scope: two authored queries, results list, claim detail view.
// This is a corroboration layer, not a map. Absence of a record is not proof
// of a false claim — the copy in each detail makes that explicit.
// (Deliberately not reusing FRAME / CHAT / ARCHIVE renderers; each surface has
//  its own field set and the difference is part of what the player is learning.)

import { addEvidence, isInEvidence } from '../../engine/state.js';

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
        <div class="atlas__label">ATLAS · location &amp; professional record lookup</div>
        <form class="atlas__form" data-form="atlas-search" autocomplete="off">
          <input class="atlas__input" type="text" name="q"
                 placeholder="Search a city (e.g. Prague, Manchester)…"
                 value="${esc(view.query)}">
          <button class="btn-primary" type="submit">Search</button>
        </form>
        <div class="atlas__hint">
          Public records only. Absence of a record is not proof of a false claim.
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
      view.activeClaimId = btn.dataset.openClaim;
      renderAtlas(paneEl, caseData, ctx);
    });
  });
}

function renderResultList(search) {
  if (!search) {
    return `
      <div class="atlas__empty">
        <div class="atlas__empty-title">No results</div>
        <div class="atlas__empty-note">No public record indexed for this location.</div>
      </div>
    `;
  }
  const results = search.results || [];
  return `
    <div class="atlas__meta">
      ${results.length} subject${results.length === 1 ? '' : 's'} associated with
      <b>${esc(search.query)}</b>
    </div>
    <ul class="atlas__list">
      ${results.map(r => `
        <li class="atlas-result">
          <div class="atlas-result__body">
            <div class="atlas-result__subject">${esc(r.subject)}</div>
            <div class="atlas-result__status">${esc(r.status)}</div>
            <div class="atlas-result__line">${esc(r.line)}</div>
          </div>
          <div class="atlas-result__action">
            <button class="btn-ghost" data-open-claim="${esc(r.id)}">Inspect →</button>
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

  const recordsHtml = (claim.records_searched || []).map(r => `
    <li class="atlas-record">
      <span class="atlas-record__name">${esc(r.name)}</span>
      <span class="atlas-record__result">${esc(r.result)}</span>
    </li>
  `).join('');

  paneEl.innerHTML = `
    <div class="atlas-claim">
      <div class="trace__breadcrumb">
        <button class="link-back" data-action="back-to-search">← ATLAS results</button>
        <span class="trace__breadcrumb-sep">/</span>
        <span>${esc(claim.subject)} · ${esc(claim.location_claimed)}</span>
      </div>

      <div class="atlas-claim__title">ATLAS RECORD</div>

      <div class="atlas-claim__grid">
        <div class="atlas-claim__field">
          <div class="atlas-claim__label">SUBJECT</div>
          <div class="atlas-claim__value">${esc(claim.subject)}</div>
        </div>
        <div class="atlas-claim__field">
          <div class="atlas-claim__label">LOCATION CLAIMED</div>
          <div class="atlas-claim__value">${esc(claim.location_claimed)}</div>
        </div>
        <div class="atlas-claim__field">
          <div class="atlas-claim__label">STATUS</div>
          <div class="atlas-claim__value atlas-claim__status">${esc(claim.status)}</div>
        </div>
      </div>

      <div class="atlas-claim__records">
        <div class="atlas-claim__label">RECORDS SEARCHED</div>
        <ul class="atlas-records">${recordsHtml}</ul>
      </div>

      <div class="atlas-claim__note">
        <div class="atlas-claim__label">NOTE</div>
        <div class="atlas-claim__note-body">${esc(claim.note || '')}</div>
      </div>

      <div class="frame-actions">
        <button class="btn-primary" data-action="add-to-case" ${already ? 'disabled' : ''}>
          ${already ? '✓ In evidence' : '+ Add to evidence'}
        </button>
        <button class="btn-ghost" data-action="back-to-search">← Back to search</button>
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
    const ev = addEvidence(claim);
    if (ev) {
      addBtn.disabled = true;
      addBtn.textContent = '✓ In evidence';
      ctx.onEvidenceAdded && ctx.onEvidenceAdded(ev);
    }
  });
}
