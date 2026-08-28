// tools/trace/trace.js
// TRACE — face-search / reverse-image lookup surface.
// Editorial-forensic composition: real portraits command the eye,
// results read as documents in an index (hairline-separated bands),
// not cards in a grid.

import { isInEvidence } from '../../engine/state.js';
import { emit as emitAction } from '../../engine/actions.js';
import { resolveAsset } from '../../engine/case-loader.js';
import { t, pick, getLang } from '../../engine/i18n.js';
import { formatJoined } from '../../engine/dates.js';

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

function findSearchByCandidate(caseData, candidateId) {
  for (const key of Object.keys(caseData.artifacts)) {
    const art = caseData.artifacts[key];
    if (art.type !== 'trace_search') continue;
    const hit = (art.results || []).find(r => r.id === candidateId);
    if (hit) return { search: art, result: hit };
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
        <div class="trace__label">${t('trace.label')}</div>
        <form class="trace__form" data-form="trace-search" autocomplete="off">
          <input class="trace__input" type="text" name="q" placeholder="${esc(t('trace.placeholder'))}" value="${esc(view.query)}">
          <button class="btn-primary" type="submit">${t('trace.button.search')}</button>
        </form>
        <div class="trace__hint">${t('trace.hint')}</div>
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
    // S7.4a — emit search action per ACTION_BUS_CONTRACT §2.2.
    // resultCount reflects the authored search artifact (0 if no match).
    const hit = findSearchByQuery(caseData, view.query);
    emitAction('search', {
      tool: 'trace',
      query: view.query,
      resultCount: hit && Array.isArray(hit.results) ? hit.results.length : 0,
    });
    renderTrace(paneEl, caseData, ctx);
  });

  paneEl.querySelectorAll('[data-open-candidate]').forEach(row => {
    const openIt = () => {
      const id = row.dataset.openCandidate;
      view.activeCandidateId = id;
      emitAction('open_artifact', { artifactId: id, tool: 'trace' });
      renderTrace(paneEl, caseData, ctx);
    };
    row.addEventListener('click', openIt);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); }
    });
  });
}

function renderResultsBlock(search, caseData) {
  if (!search) {
    return `
      <div class="trace__empty">
        <div class="trace__empty-title">${t('trace.empty.title')}</div>
        <div class="trace__empty-note">${t('trace.empty.note')}</div>
      </div>
    `;
  }
  const results = search.results || [];
  const metaKey = results.length === 1 ? 'trace.meta.one' : 'trace.meta.many';
  const meta = t(metaKey, { n: results.length, query: esc(search.query) });
  return `
    <div class="trace__meta">${meta}</div>
    <ul class="trace__list">
      ${results.map(r => renderResultRow(r, caseData)).join('')}
    </ul>
  `;
}

function renderResultRow(r, caseData) {
  const snippet = pick(r, 'snippet');
  const signal = pick(r, 'signal');
  return `
    <li class="trace-result" data-open-candidate="${esc(r.id)}" role="button" tabindex="0">
      <div class="trace-result__face">
        <img src="${esc(resolveAsset(caseData, r.avatar))}" alt="">
      </div>
      <div class="trace-result__body">
        <div class="trace-result__title">
          <span class="trace-result__name">${esc(r.display_name)}</span>
          <span class="trace-result__handle">@${esc(r.username)}</span>
        </div>
        <div class="trace-result__snippet">${esc(snippet)}</div>
        <div class="trace-result__signal">
          <span class="trace-result__source">${esc(r.url)}</span>
          ${signal ? `<span class="trace-result__sep">·</span><span>${esc(signal)}</span>` : ''}
        </div>
      </div>
      <div class="trace-result__action">
        <span class="trace-inspect" aria-hidden="true">${t('trace.results.inspect')}</span>
      </div>
    </li>
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
  const bio = pick(artifact, 'bio');
  const location = pick(artifact, 'location');
  const context = findSearchByCandidate(caseData, artifact.id);
  const contextSignal = context ? pick(context.result, 'signal') : '';
  const contextQuery = context ? context.search.query : '';

  paneEl.innerHTML = `
    <div class="trace-detail">
      <button class="trace-detail__back link-back" data-action="back-to-results">← ${t('trace.breadcrumb')}</button>

      <div class="trace-detail__body">
        <div class="trace-detail__portrait">
          <div class="tx-letterbox tx-letterbox--square">
            <img src="${esc(resolveAsset(caseData, artifact.avatar))}" alt="">
          </div>
        </div>
        <div class="trace-detail__meta">
          <div class="trace-detail__handle">@${esc(artifact.username)}</div>
          <div class="trace-detail__name">${esc(artifact.display_name)}</div>
          <div class="trace-detail__facts">
            <div><span class="trace-detail__k">${t('frame.meta.joined')}</span> ${esc(formatJoined(artifact.joined, getLang()))}</div>
            ${location ? `<div><span class="trace-detail__k">${t('trace.detail.location')}</span> ${esc(location)}</div>` : ''}
            <div><span class="trace-detail__k">${t('trace.detail.url')}</span> ${esc(artifact.url)}</div>
          </div>
          ${bio ? `<div class="trace-detail__bio">${esc(bio)}</div>` : ''}
        </div>
      </div>

      ${context ? `
        <div class="trace-detail__source">
          <div class="trace-detail__source-label">${t('trace.detail.source')}</div>
          <div class="trace-detail__source-line">
            <span>trace.dev/reverse?q=${esc(contextQuery)}</span>
            ${contextSignal ? `<span class="trace-result__sep">·</span><span>${esc(contextSignal)}</span>` : ''}
          </div>
        </div>
      ` : ''}

      <div class="trace-detail__actions">
        <button class="btn-primary" data-action="add-to-case" data-artifact-id="${esc(artifact.id)}" ${already ? 'disabled' : ''}>
          ${already ? t('frame.actions.saved') : t('frame.actions.add')}
        </button>
        ${(() => {
          // Compare affordance — surfaced only when there IS a comparable
          // FRAME-side profile in artifacts (§3 spec: no greyed-out button
          // when nothing to compare with). Label is a neutral action, not
          // a result — per §8 anti-tell rules.
          const framePrimary = caseData.artifacts.profile_001;
          if (!framePrimary || framePrimary.id === artifact.id) return '';
          return `<button class="btn-ghost" data-action="compare-with-frame" data-primary-id="${esc(framePrimary.id)}" data-secondary-id="${esc(artifact.id)}">${t('trace.detail.compare', { handle: esc(framePrimary.username) })}</button>`;
        })()}
        <button class="btn-ghost" data-action="back-to-results">${t('frame.actions.back')}</button>
      </div>
    </div>
  `;

  paneEl.querySelectorAll('[data-action="back-to-results"]').forEach(btn => {
    btn.addEventListener('click', () => {
      view.activeCandidateId = null;
      renderTrace(paneEl, caseData, ctx);
    });
  });

  const compareBtn = paneEl.querySelector('[data-action="compare-with-frame"]');
  if (compareBtn) {
    compareBtn.addEventListener('click', () => {
      emitAction('split_view', {
        tool: 'frame',
        primaryId: compareBtn.dataset.primaryId,
        secondaryId: compareBtn.dataset.secondaryId,
      });
    });
  }

  const addBtn = paneEl.querySelector('[data-action="add-to-case"]');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (addBtn.disabled) return;
      emitAction('add_to_case', { artifactId: artifact.id, tool: 'trace' });
      if (isInEvidence(artifact.id)) {
        addBtn.disabled = true;
        addBtn.textContent = t('frame.actions.saved');
        ctx.onEvidenceAdded && ctx.onEvidenceAdded();
      }
    });
  }
}
