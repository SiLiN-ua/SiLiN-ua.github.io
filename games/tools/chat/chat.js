// tools/chat/chat.js
// CHAT — messaging-app public profile lookup.
// Search results: [avatar | name/handle/snippet | Inspect]
// Profile detail: messaging-app public profile card
// (avatar circle, display name, @handle, bio, meta, concrete last-seen,
// decorative message glyph). NOT an Instagram appbar, NOT a field ledger.

import { isInEvidence } from '../../engine/state.js';
import { emit as emitAction } from '../../engine/actions.js';
import { t, pick, getLang } from '../../engine/i18n.js';
import { formatJoined } from '../../engine/dates.js';
import { resolveAsset } from '../../engine/case-loader.js';

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
  activeProfileId: null,
};

function normalize(s) { return String(s || '').trim().toLowerCase(); }

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

// Case-consistent ISO → "YYYY-MM-DD HH:MM" (UTC parts, mono display).
function formatLastSeen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
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
        <div class="chat__label">${t('chat.label')}</div>
        <form class="chat__form" data-form="chat-search" autocomplete="off">
          <input class="chat__input" type="text" name="q"
                 placeholder="${esc(t('chat.placeholder'))}"
                 value="${esc(view.query)}">
          <button class="btn-primary" type="submit">${t('chat.button.search')}</button>
        </form>
        <div class="chat__hint">
          ${t('chat.hint')}
        </div>
      </div>

      <div class="chat__results">
        ${view.submitted ? renderResultList(caseData, search) : ''}
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
    // S7.4a — emit search action per ACTION_BUS_CONTRACT §2.2.
    const hit = findSearchByQuery(caseData, view.query);
    emitAction('search', {
      tool: 'chat',
      query: view.query,
      resultCount: hit && Array.isArray(hit.results) ? hit.results.length : 0,
    });
    renderChat(paneEl, caseData, ctx);
  });

  paneEl.querySelectorAll('[data-open-profile]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.openProfile;
      view.activeProfileId = id;
      emitAction('open_artifact', { artifactId: id, tool: 'chat' });
      renderChat(paneEl, caseData, ctx);
    });
  });
}

function renderResultList(caseData, search) {
  if (!search) {
    return `
      <div class="chat__empty">
        <div class="chat__empty-title">${t('chat.empty.title')}</div>
        <div class="chat__empty-note">${t('chat.empty.note')}</div>
      </div>
    `;
  }
  const results = search.results || [];
  const metaKey = results.length === 1 ? 'chat.meta.one' : 'chat.meta.many';
  const meta = t(metaKey, { n: results.length, query: esc(search.query) });
  return `
    <div class="chat__meta">${meta}</div>
    <ul class="chat__list">
      ${results.map(r => {
        const snippet = pick(r, 'snippet');
        const avatarSrc = r.avatar ? resolveAsset(caseData, r.avatar) : '';
        const alt = t('chat.results.avatar_alt', { handle: esc(r.handle) });
        return `
        <li class="chat-result">
          <div class="chat-avatar chat-avatar--sm" aria-hidden="${avatarSrc ? 'false' : 'true'}">
            ${avatarSrc ? `<img src="${esc(avatarSrc)}" alt="${esc(alt)}">` : ''}
          </div>
          <div class="chat-result__body">
            <div class="chat-result__name">${esc(r.display_name)}</div>
            <div class="chat-result__handle">@${esc(r.handle)}</div>
            ${snippet ? `<div class="chat-result__snippet">${esc(snippet)}</div>` : ''}
          </div>
          <div class="chat-result__action">
            <button class="btn-ghost" data-open-profile="${esc(r.id)}">${t('chat.results.inspect')}</button>
          </div>
        </li>
        `;
      }).join('')}
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
  const avatarSrc = p.avatar ? resolveAsset(caseData, p.avatar) : '';
  const alt = t('chat.results.avatar_alt', { handle: esc(p.handle) });

  const bio       = pick(p, 'bio');
  const location  = pick(p, 'location');
  const joined    = formatJoined(p.joined, getLang());
  const lastSeen  = formatLastSeen(p.last_seen_iso);
  const metaLine  = location
    ? t('chat.profile.meta', { location: esc(location), joined: esc(joined) })
    : t('chat.profile.meta.no_location', { joined: esc(joined) });

  paneEl.innerHTML = `
    <div class="chat-profile">
      <div class="chat-profile__topbar">
        <button class="link-back" data-action="back-to-search">← ${t('chat.breadcrumb')}</button>
      </div>

      <article class="chat-profile__card" role="group">
        <div class="chat-avatar chat-avatar--lg" aria-hidden="${avatarSrc ? 'false' : 'true'}">
          ${avatarSrc ? `<img src="${esc(avatarSrc)}" alt="${esc(alt)}">` : ''}
        </div>
        <div class="chat-profile__name">${esc(p.display_name)}</div>
        <div class="chat-profile__handle">@${esc(p.handle)}</div>
        ${bio ? `<div class="chat-profile__bio">${esc(bio)}</div>` : ''}
        <div class="chat-profile__meta">${metaLine}</div>
        ${lastSeen ? `<div class="chat-last-seen">${t('chat.profile.last_seen', { when: esc(lastSeen) })}</div>` : ''}
        <div class="chat-message-glyph" aria-label="${esc(t('chat.profile.message'))}">
          <span aria-hidden="true">⌇</span>
        </div>
      </article>

      <div class="frame-actions">
        <button class="btn-primary" data-action="add-to-case" data-artifact-id="${esc(p.id)}" ${already ? 'disabled' : ''}>
          ${already ? t('frame.actions.saved') : t('chat.actions.add')}
        </button>
        <button class="btn-ghost" data-action="back-to-search">${t('chat.actions.back')}</button>
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
    emitAction('add_to_case', { artifactId: p.id, tool: 'chat' });
    if (isInEvidence(p.id)) {
      addBtn.disabled = true;
      addBtn.textContent = t('frame.actions.saved');
      ctx.onEvidenceAdded && ctx.onEvidenceAdded();
    }
  });
}
