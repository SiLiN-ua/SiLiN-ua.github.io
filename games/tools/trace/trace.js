// tools/trace/trace.js
// TRACE — username / image search across the fake digital world.
// Session 2 scope: one hard-coded query ("alex_miller") that surfaces 3 candidates.
// The player can inspect each result and add it to the case.

import { addEvidence, isInEvidence } from '../../engine/state.js';
import { resolveAsset } from '../../engine/case-loader.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function fmtNum(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(n);
}

// Per-tool view state. Not persisted (Session 2). Cleared on reload.
const view = {
  query: '',
  submitted: false,
  activeCandidateId: null,
};

function findSearchByQuery(caseData, q) {
  const normalized = String(q || '').trim().toLowerCase();
  if (!normalized) return null;
  for (const key of Object.keys(caseData.artifacts)) {
    const art = caseData.artifacts[key];
    if (art.type === 'trace_search' && String(art.query).toLowerCase() === normalized) {
      return art;
    }
  }
  return null;
}

export function renderTrace(paneEl, caseData, ctx) {
  if (view.activeCandidateId) {
    renderCandidate(paneEl, caseData, ctx);
  } else {
    renderSearch(paneEl, caseData, ctx);
  }
}

function renderSearch(paneEl, caseData, ctx) {
  const search = view.submitted ? findSearchByQuery(caseData, view.query) : null;

  paneEl.innerHTML = `
    <div class="trace">
      <div class="trace__header">
        <div class="trace__label">TRACE · username & image search</div>
        <form class="trace__form" data-form="trace-search" autocomplete="off">
          <input class="trace__input" type="text" name="q" placeholder="Search a username, handle or phrase…" value="${esc(view.query)}">
          <button class="btn-primary" type="submit">Search</button>
        </form>
        <div class="trace__hint">
          Try what you already know. Copy a handle from FRAME and paste it here.
        </div>
      </div>

      <div class="trace__results">
        ${view.submitted ? renderResultsBlock(search, caseData) : ''}
      </div>
    </div>
  `;

  const form = paneEl.querySelector('[data-form="trace-search"]');
  const input = form.querySelector('input[name="q"]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    view.query = input.value.trim();
    view.submitted = true;
    view.activeCandidateId = null;
    renderTrace(paneEl, caseData, ctx);
  });

  paneEl.querySelectorAll('[data-open-candidate]').forEach(btn => {
    btn.addEventListener('click', () => {
      view.activeCandidateId = btn.dataset.openCandidate;
      renderTrace(paneEl, caseData, ctx);
    });
  });
}

function renderResultsBlock(search, caseData) {
  if (!search) {
    return `
      <div class="trace__empty">
        <div class="trace__empty-title">No results</div>
        <div class="trace__empty-note">Nothing indexed for this query. Check the handle exactly as you saw it.</div>
      </div>
    `;
  }
  const results = search.results || [];
  return `
    <div class="trace__meta">${results.length} result${results.length === 1 ? '' : 's'} for <b>"${esc(search.query)}"</b></div>
    <ul class="trace__list">
      ${results.map(r => `
        <li class="trace-result">
          <div class="trace-result__avatar">
            <img src="${esc(resolveAsset(caseData, r.avatar))}" alt="">
          </div>
          <div class="trace-result__body">
            <div class="trace-result__url">${esc(r.url)}</div>
            <div class="trace-result__title">
              <b>@${esc(r.username)}</b>
              <span class="trace-result__name">${esc(r.display_name)}</span>
            </div>
            <div class="trace-result__snippet">${esc(r.snippet)}</div>
            ${r.signal ? `<div class="trace-result__signal">${esc(r.signal)}</div>` : ''}
          </div>
          <div class="trace-result__action">
            <button class="btn-ghost" data-open-candidate="${esc(r.id)}">Inspect →</button>
          </div>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderCandidate(paneEl, caseData, ctx) {
  const artifact = caseData.artifacts[view.activeCandidateId];
  if (!artifact) {
    view.activeCandidateId = null;
    renderTrace(paneEl, caseData, ctx);
    return;
  }
  const already = isInEvidence(artifact.id);
  const postsHtml = (artifact.posts || []).map(p => `
    <div class="frame-post">
      <img src="${esc(resolveAsset(caseData, p.cover))}" alt="${esc(p.caption)}">
      <div class="frame-post__caption">${esc(p.caption)}</div>
    </div>
  `).join('');

  paneEl.innerHTML = `
    <div class="frame-profile">
      <div class="trace__breadcrumb">
        <button class="link-back" data-action="back-to-results">← TRACE results</button>
        <span class="trace__breadcrumb-sep">/</span>
        <span>${esc(artifact.url)}</span>
      </div>
      <div class="frame-url">${esc(artifact.url)}</div>
      <div class="frame-header">
        <div class="frame-avatar"><img src="${esc(resolveAsset(caseData, artifact.avatar))}" alt=""></div>
        <div>
          <div class="frame-username">@${esc(artifact.username)}</div>
          <div class="frame-name">${esc(artifact.display_name)}</div>
          <div class="frame-stats">
            <span><b>${fmtNum(artifact.stats.posts)}</b>posts</span>
            <span><b>${fmtNum(artifact.stats.followers)}</b>followers</span>
            <span><b>${fmtNum(artifact.stats.following)}</b>following</span>
          </div>
          <div class="frame-bio">${esc(artifact.bio)}</div>
          <div class="frame-meta">${esc(artifact.location)} · Joined ${esc(artifact.joined)}</div>
        </div>
      </div>
      <div class="frame-actions">
        <button class="btn-primary" data-action="add-to-case" ${already ? 'disabled' : ''}>
          ${already ? '✓ In evidence' : '+ Add to case'}
        </button>
        <button class="btn-ghost" data-action="back-to-results">← Back to results</button>
      </div>
      <div class="frame-grid">${postsHtml}</div>
    </div>
  `;

  paneEl.querySelectorAll('[data-action="back-to-results"]').forEach(btn => {
    btn.addEventListener('click', () => {
      view.activeCandidateId = null;
      renderTrace(paneEl, caseData, ctx);
    });
  });

  const addBtn = paneEl.querySelector('[data-action="add-to-case"]');
  addBtn.addEventListener('click', () => {
    if (addBtn.disabled) return;
    const ev = addEvidence(artifact);
    if (ev) {
      addBtn.disabled = true;
      addBtn.textContent = '✓ In evidence';
      ctx.onEvidenceAdded && ctx.onEvidenceAdded(ev);
    }
  });
}
