// tools/frame/frame.js
// Renders a FRAME (social) profile artifact into the work-area pane.

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

export function renderFrameProfile(paneEl, caseData, profile, { onEvidenceAdded } = {}) {
  const avatar = esc(resolveAsset(caseData, profile.avatar));
  const alreadySaved = isInEvidence(profile.id);
  const bio = pick(profile, 'bio');

  const postsHtml = (profile.posts || []).map(p => {
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
      <div class="frame-url">${esc(profile.url)}</div>
      <div class="frame-header">
        <div class="frame-avatar"><img src="${avatar}" alt=""></div>
        <div>
          <div class="frame-username">@${esc(profile.username)}</div>
          <div class="frame-name">${esc(profile.display_name)}</div>
          <div class="frame-stats">
            <span><b>${fmtNum(profile.stats.posts)}</b>${t('frame.stats.posts')}</span>
            <span><b>${fmtNum(profile.stats.followers)}</b>${t('frame.stats.followers')}</span>
            <span><b>${fmtNum(profile.stats.following)}</b>${t('frame.stats.following')}</span>
          </div>
          <div class="frame-bio">${esc(bio)}</div>
          <div class="frame-meta">${esc(pick(profile, 'location'))} · ${t('frame.meta.joined')} ${esc(formatJoined(profile.joined, getLang()))}</div>
        </div>
      </div>
      <div class="frame-actions">
        <button class="btn-primary" data-action="add-to-case" ${alreadySaved ? 'disabled' : ''}>
          ${alreadySaved ? t('frame.actions.saved') : t('frame.actions.add')}
        </button>
        <button class="btn-ghost" data-action="copy-url">${t('frame.actions.copy_url')}</button>
      </div>
      <div class="frame-grid">${postsHtml}</div>
    </div>
  `;

  const addBtn = paneEl.querySelector('[data-action="add-to-case"]');
  addBtn.addEventListener('click', () => {
    if (addBtn.disabled) return;
    // Single entry point per ACTION_BUS_CONTRACT §3.1: UI emits intent,
    // state handler mutates. Emit is synchronous, so by the next line the
    // mutation has already happened (or was deduped as already-in-evidence).
    emitAction('add_to_case', { artifactId: profile.id, tool: 'frame' });
    if (isInEvidence(profile.id)) {
      addBtn.disabled = true;
      addBtn.textContent = t('frame.actions.saved');
      onEvidenceAdded && onEvidenceAdded();
    }
  });

  const copyBtn = paneEl.querySelector('[data-action="copy-url"]');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(profile.url);
      const original = copyBtn.textContent;
      copyBtn.textContent = t('frame.actions.copied');
      setTimeout(() => { copyBtn.textContent = original; }, 1200);
    } catch { /* ignore */ }
  });
}
