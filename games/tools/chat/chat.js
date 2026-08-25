// tools/chat/chat.js
// CHAT — messenger handle lookup surface. Public-metadata document view.

import { isInEvidence } from '../../engine/state.js';
import { emit as emitAction } from '../../engine/actions.js';
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
      const id = btn.dataset.openProfile;
      view.activeProfileId = id;
      emitAction('open_artifact', { artifactId: id, tool: 'chat' });
      renderChat(paneEl, caseData, ctx);
    });
  });
}

function renderResultList(search) {
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
      ${results.map(r => `
        <li class="chat-result">
          <div class="chat-result__handle">@${esc(r.handle)}</div>
          <div class="chat-result__body">
            <div class="chat-result__name">${esc(r.display_name)}</div>
            <div class="chat-result__joined">${t('chat.results.joined', { when: esc(formatJoined(r.joined, getLang())) })}</div>
          </div>
          <div class="chat-result__action">
            <button class="btn-ghost" data-open-profile="${esc(r.id)}">${t('chat.results.inspect')}</button>
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
        <button class="link-back" data-action="back-to-search">← ${t('chat.breadcrumb')}</button>
        <span class="trace__breadcrumb-sep">/</span>
        <span>${esc(p.url)}</span>
      </div>

      <div class="chat-profile__title">${t('chat.profile.title')}</div>

      <div class="chat-profile__fields">
        ${field(t('chat.profile.field.handle'),       '@' + p.handle)}
        ${field(t('chat.profile.field.display_name'), p.display_name)}
        ${field(t('chat.profile.field.bio'),          pick(p, 'bio'))}
        ${field(t('chat.profile.field.location'),     pick(p, 'location'))}
        ${field(t('chat.profile.field.joined'),       formatJoined(p.joined, getLang()))}
        ${field(t('chat.profile.field.last_seen'),    pick(p, 'last_seen'))}
      </div>

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
