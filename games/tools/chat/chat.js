// tools/chat/chat.js
// CHAT — messenger handle lookup surface.
// Session 4 scope: two hard-coded queries, results list, compact profile detail.
// CHAT profile is presented as a public-metadata document — NOT a full messenger UI.
// (Deliberately not reusing renderFrameProfile or the archive snapshot layout:
//  each surface has its own field set and the difference is part of the learning.)

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
  activeProfileId: null,
};

function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

function findSearchByQuery(caseData, q) {
  const needle = normalize(q);
  if (!needle) return null;
  for (const key of Object.keys(caseData.artifacts)) {
    const art = caseData.artifacts[key];
    if (art.type !== 'chat_search') continue;
    if (normalize(art.query) === needle) return art;
  }
  return null;
}

export function renderChat(paneEl, caseData, ctx) {
  if (view.activeProfileId) {
    renderProfileDetail(paneEl, caseData, ctx);
  } else {
    renderSearch(paneEl, caseData, ctx);
  }
}

function renderSearch(paneEl, caseData, ctx) {
  const search = view.submitted ? findSearchByQuery(caseData, view.query) : null;

  paneEl.innerHTML = `
    <div class="chat">
      <div class="chat__header">
        <div class="chat__label">CHAT · public handle lookup</div>
        <form class="chat__form" data-form="chat-search" autocomplete="off">
          <input class="chat__input" type="text" name="q"
                 placeholder="Search a handle or a name…"
                 value="${esc(view.query)}">
          <button class="btn-primary" type="submit">Search</button>
        </form>
        <div class="chat__hint">
          Public profile only — no messages, no phone numbers.
        </div>
      </div>

      <div class="chat__results">
        ${view.submitted ? renderResultList(search) : ''}
      </div>
    </div>
  `;

  const form = paneEl.querySelector('[data-form="chat-search"]');
  const input = form.querySelector('input[name="q"]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    view.query = input.value.trim();
    view.submitted = true;
    view.activeProfileId = null;
    renderChat(paneEl, caseData, ctx);
  });

  paneEl.querySelectorAll('[data-open-profile]').forEach(btn => {
    btn.addEventListener('click', () => {
      view.activeProfileId = btn.dataset.openProfile;
      renderChat(paneEl, caseData, ctx);
    });
  });
}

function renderResultList(search) {
  if (!search) {
    return `
      <div class="chat__empty">
        <div class="chat__empty-title">No profiles</div>
        <div class="chat__empty-note">Nothing indexed for this query. Try a handle or a name exactly as you saw it.</div>
      </div>
    `;
  }
  const results = search.results || [];
  return `
    <div class="chat__meta">${results.length} profile${results.length === 1 ? '' : 's'} for <b>"${esc(search.query)}"</b></div>
    <ul class="chat__list">
      ${results.map(r => `
        <li class="chat-result">
          <div class="chat-result__handle">@${esc(r.handle)}</div>
          <div class="chat-result__body">
            <div class="chat-result__name">${esc(r.display_name)}</div>
            <div class="chat-result__joined">Joined ${esc(r.joined)}</div>
          </div>
          <div class="chat-result__action">
            <button class="btn-ghost" data-open-profile="${esc(r.id)}">Inspect →</button>
          </div>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderProfileDetail(paneEl, caseData, ctx) {
  const p = caseData.artifacts[view.activeProfileId];
  if (!p) {
    view.activeProfileId = null;
    renderChat(paneEl, caseData, ctx);
    return;
  }
  const already = isInEvidence(p.id);

  const field = (label, value) => `
    <div class="chat-field">
      <div class="chat-field__label">${esc(label)}</div>
      <div class="chat-field__value">${value && String(value).length ? esc(value) : '—'}</div>
    </div>
  `;

  paneEl.innerHTML = `
    <div class="chat-profile">
      <div class="trace__breadcrumb">
        <button class="link-back" data-action="back-to-search">← CHAT results</button>
        <span class="trace__breadcrumb-sep">/</span>
        <span>${esc(p.url)}</span>
      </div>

      <div class="chat-profile__title">CHAT PROFILE</div>

      <div class="chat-profile__fields">
        ${field('HANDLE',       '@' + p.handle)}
        ${field('DISPLAY NAME', p.display_name)}
        ${field('BIO',          p.bio)}
        ${field('LOCATION',     p.location)}
        ${field('JOINED',       p.joined)}
        ${field('LAST SEEN',    p.last_seen)}
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
      view.activeProfileId = null;
      renderChat(paneEl, caseData, ctx);
    });
  });

  const addBtn = paneEl.querySelector('[data-action="add-to-case"]');
  addBtn.addEventListener('click', () => {
    if (addBtn.disabled) return;
    const ev = addEvidence(p);
    if (ev) {
      addBtn.disabled = true;
      addBtn.textContent = '✓ In evidence';
      ctx.onEvidenceAdded && ctx.onEvidenceAdded(ev);
    }
  });
}
