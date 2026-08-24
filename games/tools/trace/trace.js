// tools/trace/trace.js
// TRACE — username / image search across the fake digital world.

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
function fmtNum(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(n);
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
        <div class="trace__hint">
          ${t('trace.hint')}
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
            <div class="trace-result__snippet">${esc(pick(r, 'snippet'))}</div>
            ${pick(r, 'signal') ? `<div class="trace-result__signal">${esc(pick(r, 'signal'))}</div>` : ''}
          </div>
          <div class="trace-result__action">
            <button class="btn-ghost" data-open-candidate="${esc(r.id)}">${t('trace.results.inspect')}</button>
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
  const bio = pick(artifact, 'bio');
  const postsHtml = (artifact.posts || []).map(p => {
    const caption = pick(p, 'caption');
    return `
      <div class="frame-post">
        <img src="${esc(resolveAsset(caseData, p.cover))}" alt="${esc(caption)}">
        <div class="frame-post__caption">${esc(caption)}</div>
      </div>
    `;
  }).join('');

  paneEl.innerHTML = `
    <div class="frame-profile">
      <div class="trace__breadcrumb">
        <button class="link-back" data-action="back-to-results">← ${t('trace.breadcrumb')}</button>
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
            <span><b>${fmtNum(artifact.stats.posts)}</b>${t('frame.stats.posts')}</span>
            <span><b>${fmtNum(artifact.stats.followers)}</b>${t('frame.stats.followers')}</span>
            <span><b>${fmtNum(artifact.stats.following)}</b>${t('frame.stats.following')}</span>
          </div>
          <div class="frame-bio">${esc(bio)}</div>
          <div class="frame-meta">${esc(pick(artifact, 'location'))} · ${t('frame.meta.joined')} ${esc(formatJoined(artifact.joined, getLang()))}</div>
        </div>
      </div>
      <div class="frame-actions">
        <button class="btn-primary" data-action="add-to-case" ${already ? 'disabled' : ''}>
          ${already ? t('frame.actions.saved') : t('frame.actions.add')}
        </button>
        <button class="btn-ghost" data-action="back-to-results">${t('frame.actions.back')}</button>
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
    emitAction('add_to_case', { artifactId: artifact.id, tool: 'trace' });
    if (isInEvidence(artifact.id)) {
      addBtn.disabled = true;
      addBtn.textContent = t('frame.actions.saved');
      ctx.onEvidenceAdded && ctx.onEvidenceAdded();
    }
  });
}
