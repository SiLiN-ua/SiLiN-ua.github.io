// tools/frame/frame.js
// Renders a FRAME (social) profile artifact into the work-area pane.

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

export function renderFrameProfile(paneEl, caseData, profile, { onEvidenceAdded } = {}) {
  const avatar = esc(resolveAsset(caseData, profile.avatar));
  const alreadySaved = isInEvidence(profile.id);

  const postsHtml = (profile.posts || []).map(p => `
    <div class="frame-post">
      <img src="${esc(resolveAsset(caseData, p.cover))}" alt="${esc(p.caption)}">
      <div class="frame-post__caption">${esc(p.caption)}</div>
    </div>
  `).join('');

  paneEl.innerHTML = `
    <div class="frame-profile">
      <div class="frame-url">${esc(profile.url)}</div>
      <div class="frame-header">
        <div class="frame-avatar"><img src="${avatar}" alt=""></div>
        <div>
          <div class="frame-username">@${esc(profile.username)}</div>
          <div class="frame-name">${esc(profile.display_name)}</div>
          <div class="frame-stats">
            <span><b>${fmtNum(profile.stats.posts)}</b>posts</span>
            <span><b>${fmtNum(profile.stats.followers)}</b>followers</span>
            <span><b>${fmtNum(profile.stats.following)}</b>following</span>
          </div>
          <div class="frame-bio">${esc(profile.bio)}</div>
          <div class="frame-meta">${esc(profile.location)} · Joined ${esc(profile.joined)}</div>
        </div>
      </div>
      <div class="frame-actions">
        <button class="btn-primary" data-action="add-to-case" ${alreadySaved ? 'disabled' : ''}>
          ${alreadySaved ? '✓ In evidence' : '+ Add to case'}
        </button>
        <button class="btn-ghost" data-action="copy-url">Copy URL</button>
      </div>
      <div class="frame-grid">${postsHtml}</div>
    </div>
  `;

  const addBtn = paneEl.querySelector('[data-action="add-to-case"]');
  addBtn.addEventListener('click', () => {
    if (addBtn.disabled) return;
    const evidence = addEvidence(profile);
    if (evidence) {
      addBtn.disabled = true;
      addBtn.textContent = '✓ In evidence';
      onEvidenceAdded && onEvidenceAdded(evidence);
    }
  });

  const copyBtn = paneEl.querySelector('[data-action="copy-url"]');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(profile.url);
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = original; }, 1200);
    } catch { /* ignore */ }
  });
}
