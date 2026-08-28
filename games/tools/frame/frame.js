// tools/frame/frame.js
// Renders a FRAME (social) profile artifact into the work-area pane.
// Two local view states per profile: A = profile grid, B = opened post.
// The state B toggle is a local tool concern — not an action-bus event
// (except we still emit `open_artifact` on entering B, mirroring the
// TRACE/CHAT/ATLAS pattern so state.viewed and HAS UPDATES stay honest).

import { isInEvidence } from '../../engine/state.js';
import { emit as emitAction } from '../../engine/actions.js';
import { resolveAsset } from '../../engine/case-loader.js';
import { t, pick, getLang } from '../../engine/i18n.js';
import { formatJoined } from '../../engine/dates.js';
import { renderVideoPlayer } from './video-player.js';   // S7.3.3

// Local view state, per profile id. Not persisted — a re-render
// (activeTool switch away and back) returns FRAME to state A, which is
// the correct behavior: FRAME is a workspace, not a browser history.
const openedPost = new Map(); // profileId -> postId
// Local video-reveal state, per opened post. Not persisted — closing the
// post or switching tools resets to photo-first. This is the "evidence-
// extract moment" from S5 §4.5: player clicks the affordance to reveal
// the video still on top of the pane.
const videoOpen = new Set(); // "profileId#postId"
// S7.3.3 — cleanup fn returned by renderVideoPlayer per mount. Called on
// re-render/close so the video-player component tears down cleanly
// (autosave interval + keydown listener + state subscription).
const activePlayerCleanup = new Map(); // "profileId#postId" -> () => void

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

function initialFor(name) {
  const s = String(name || '').trim();
  return s ? s.charAt(0).toUpperCase() : '?';
}

// Avatar fallback: if the source 404s, render initials over the muted
// surface instead of a hollow grey circle (§6 anti-wireframe rule 3).
function attachAvatarFallback(imgEl, initial) {
  if (!imgEl) return;
  imgEl.addEventListener('error', () => {
    const holder = imgEl.parentElement;
    if (!holder) return;
    holder.classList.add('frame-avatar--fallback');
    holder.textContent = initial;
  }, { once: true });
}

export function renderFrameProfile(paneEl, caseData, profile, opts = {}) {
  const { onEvidenceAdded, compact } = opts;
  const openId = compact ? null : (openedPost.get(profile.id) || null);

  // Auto-open the profile artifact on activation (unchanged behavior).
  // In compact/split mode, skip the open_artifact emission for the secondary
  // pane so a paired display does not spuriously mark viewed.
  if (!compact) {
    emitAction('open_artifact', { artifactId: profile.id, tool: 'frame' });
  }

  if (openId) {
    const post = (profile.posts || []).find(p => p.id === openId);
    if (post) {
      renderOpenedPost(paneEl, caseData, profile, post, opts);
      return;
    }
    // Post id no longer resolves — fall through to profile.
    openedPost.delete(profile.id);
  }

  renderProfileState(paneEl, caseData, profile, opts);
}

// ------------------------------------------------------------------
// State A — profile view (grid)
// ------------------------------------------------------------------
function renderProfileState(paneEl, caseData, profile, { onEvidenceAdded, compact = false }) {
  const avatar = esc(resolveAsset(caseData, profile.avatar));
  const alreadySaved = isInEvidence(profile.id);
  const bio = pick(profile, 'bio');

  const postsHtml = (profile.posts || []).map(p => `
    <button type="button" class="frame-post" data-post-id="${esc(p.id)}" aria-label="${esc(pick(p, 'caption'))}">
      <img src="${esc(resolveAsset(caseData, p.cover))}" alt="">
    </button>
  `).join('');

  // Highlights are the story-highlight circles that Instagram profiles
  // show under the header. Purely decorative, drawn from a per-profile
  // list on the artifact. Fall back to nothing if none authored.
  const highlights = Array.isArray(profile.highlights) ? profile.highlights : [
    { label: 'Prague',  glyph: '☕' },
    { label: 'Streets', glyph: '📷' },
    { label: 'Slow',    glyph: '🌙' },
    { label: '2024',    glyph: '·'  },
  ];
  const highlightsHtml = highlights.map(h => `
    <div class="frame-hl">
      <div class="frame-hl__ring"><div class="frame-hl__glyph">${esc(h.glyph || '·')}</div></div>
      <div class="frame-hl__label">${esc(h.label)}</div>
    </div>
  `).join('');

  paneEl.innerHTML = `
    <div class="frame-profile${compact ? ' frame-profile--compact' : ''}">
      <!-- App-chrome header: reads as an Instagram-analog top bar -->
      <div class="frame-appbar">
        <div class="frame-appbar__brand">
          <span class="frame-appbar__mark" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <defs>
                <linearGradient id="fg-frame-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stop-color="#f09433"/>
                  <stop offset=".35" stop-color="#e6683c"/>
                  <stop offset=".65" stop-color="#dc2743"/>
                  <stop offset="1" stop-color="#bc1888"/>
                </linearGradient>
              </defs>
              <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="url(#fg-frame-grad)" stroke-width="2"/>
              <circle cx="12" cy="12" r="4.2" stroke="url(#fg-frame-grad)" stroke-width="2"/>
              <circle cx="17.4" cy="6.6" r="1.2" fill="url(#fg-frame-grad)"/>
            </svg>
          </span>
          <span class="frame-appbar__wordmark">frame</span>
        </div>
        <div class="frame-appbar__search">
          <span aria-hidden="true">⌕</span>
          <input type="text" placeholder="${esc(t('frame.search.placeholder'))}" disabled aria-hidden="true">
        </div>
        <div class="frame-appbar__icons" aria-hidden="true">
          <span title="Home">⌂</span>
          <span title="Messages">✎</span>
          <span title="Notifications">♡</span>
          <span title="Profile"><img src="${avatar}" alt=""></span>
        </div>
      </div>

      <div class="frame-header">
        <div class="frame-avatar"><img src="${avatar}" alt=""></div>
        <div class="frame-header__body">
          <div class="frame-header__topline">
            <div class="frame-username" data-copy="handle">${esc(profile.username)}</div>
            <button type="button" class="frame-social-btn frame-social-btn--follow" aria-disabled="true" tabindex="-1">Follow</button>
            <button type="button" class="frame-social-btn" aria-disabled="true" tabindex="-1">Message</button>
            <button type="button" class="frame-social-btn frame-social-btn--icon" aria-disabled="true" tabindex="-1" title="More">…</button>
          </div>
          <div class="frame-stats">
            <span><b>${fmtNum(profile.stats.posts)}</b> ${t('frame.stats.posts')}</span>
            <span><b>${fmtNum(profile.stats.followers)}</b> ${t('frame.stats.followers')}</span>
            <span><b>${fmtNum(profile.stats.following)}</b> ${t('frame.stats.following')}</span>
          </div>
          <div class="frame-name">${esc(profile.display_name)}</div>
          <div class="frame-category">${esc(pick(profile, 'category') || 'Photographer')}</div>
          <div class="frame-bio">${esc(bio)}</div>
          <div class="frame-meta">${esc(pick(profile, 'location'))} · ${t('frame.meta.joined')} ${esc(formatJoined(profile.joined, getLang()))}</div>
        </div>
      </div>

      <div class="frame-tabs-row">
        <div class="frame-tabs" role="tablist">
          <div class="frame-tab is-active" role="tab" aria-selected="true">
            <span class="frame-tab__glyph" aria-hidden="true">▦</span>
            <span class="frame-tab__label">POSTS</span>
          </div>
          <div class="frame-tab" role="tab" aria-selected="false" aria-disabled="true">
            <span class="frame-tab__glyph" aria-hidden="true">▷</span>
            <span class="frame-tab__label">REELS</span>
          </div>
          <div class="frame-tab" role="tab" aria-selected="false" aria-disabled="true">
            <span class="frame-tab__glyph" aria-hidden="true">◉</span>
            <span class="frame-tab__label">TAGGED</span>
          </div>
        </div>
        <div class="frame-tabs__case">
          <button class="btn-primary btn-primary--sm" data-action="add-to-case" data-artifact-id="${esc(profile.id)}" ${alreadySaved ? 'disabled' : ''}>
            ${alreadySaved ? t('frame.actions.saved') : t('frame.actions.add')}
          </button>
          <button class="btn-ghost btn-ghost--sm" data-action="copy-url">${t('frame.actions.copy_url')}</button>
        </div>
      </div>

      <div class="frame-grid">${postsHtml}</div>
    </div>
  `;

  attachAvatarFallback(
    paneEl.querySelector('.frame-avatar img'),
    initialFor(profile.username)
  );

  const addBtn = paneEl.querySelector('[data-action="add-to-case"]');
  addBtn.addEventListener('click', () => {
    if (addBtn.disabled) return;
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

  // Post click → transition to state B.
  paneEl.querySelectorAll('.frame-post').forEach(btn => {
    btn.addEventListener('click', () => {
      openedPost.set(profile.id, btn.dataset.postId);
      renderFrameProfile(paneEl, caseData, profile, { onEvidenceAdded });
    });
  });
}

// ------------------------------------------------------------------
// State B — opened post (artifact-first)
// ------------------------------------------------------------------
function renderOpenedPost(paneEl, caseData, profile, post, { onEvidenceAdded }) {
  // Compose a stable, per-post id for state.viewed tracking. Post ids
  // are only unique inside their profile, so scope with the profile id.
  const postArtifactId = `${profile.id}#${post.id}`;
  emitAction('open_artifact', { artifactId: postArtifactId, tool: 'frame' });

  const showVideo = !!post.video_still && videoOpen.has(postArtifactId);
  const src = esc(resolveAsset(caseData, post.cover));
  const videoSrc = post.video_still ? esc(resolveAsset(caseData, post.video_still)) : '';
  const avatar = esc(resolveAsset(caseData, profile.avatar));
  const caption = pick(post, 'caption');
  const location = pick(profile, 'location');
  const likesLine = (typeof post.likes === 'number')
    ? `${fmtNum(post.likes)} ${t('frame.opened.likes')}`
    : '';

  // Alex-version posts: EXIF was stripped when the re-uploader saved.
  // The absence IS the evidence — em-dashes, no warning color (§3.5).
  const exifFields = [
    ['frame.exif.filename', `IMG_${String(1000 + (post.id?.charCodeAt(post.id.length - 1) || 0) * 13).slice(0,4)}.jpg`],
    ['frame.exif.camera',   ''],
    ['frame.exif.iso',      ''],
    ['frame.exif.timestamp',''],
    ['frame.exif.gps',      '']
  ];
  const exifHtml = exifFields.map(([k, v]) => `
    <dt>${t(k)}</dt><dd>${v ? esc(v) : ''}</dd>
  `).join('');

  paneEl.innerHTML = `
    <div class="frame-opened">
      <article class="frame-post-card">
        <header class="frame-post-card__head">
          <div class="frame-post-card__head-avatar"><img src="${avatar}" alt=""></div>
          <div class="frame-post-card__head-meta">
            <div class="frame-post-card__head-handle" data-copy="handle">@${esc(profile.username)}</div>
            ${location ? `<div class="frame-post-card__head-loc">${esc(location)}</div>` : ''}
          </div>
          <button type="button" class="frame-opened__close" data-action="close" aria-label="${t('frame.opened.close')}">×</button>
        </header>

        ${showVideo ? `
          <div class="frame-opened__video-mount" data-role="video-mount"></div>
        ` : `
          <div class="tx-letterbox frame-post-card__photo" style="--tx-ratio: 2 / 3;">
            <img src="${src}" alt="${esc(caption)}">
          </div>
        `}

        <div class="frame-post-card__body">
          ${likesLine ? `<div class="frame-post-card__likes">${likesLine}</div>` : ''}
          <div class="frame-post-card__caption"><b>@${esc(profile.username)}</b> ${esc(caption)}</div>
          ${post.date ? `<div class="frame-post-card__date">${esc(post.date)}</div>` : ''}
        </div>
        ${(post.video_still && !showVideo) ? `
          <div class="frame-opened__video-slot">
            <button type="button" class="frame-opened__video-load" data-action="load-video">${t('frame.video.load')}</button>
          </div>
        ` : ''}
      </article>

      <section class="frame-opened__forensic" aria-label="metadata">
        <div class="frame-opened__forensic-label">${t('frame.opened.metadata')}</div>
        <dl class="tx-exif-ledger tx-exif-ledger--empty frame-opened__exif">
          ${exifHtml}
        </dl>
      </section>

      <div class="frame-opened__actions">
        <button class="btn-primary" data-action="add-to-case" data-artifact-id="${esc(postArtifactId)}" ${isInEvidence(postArtifactId) ? 'disabled' : ''}>
          ${isInEvidence(postArtifactId) ? t('frame.actions.saved') : t('frame.actions.add')}
        </button>
      </div>
    </div>
  `;

  attachAvatarFallback(
    paneEl.querySelector('.frame-post-card__head-avatar img'),
    initialFor(profile.username)
  );

  // S7.3.3 — clean up any prior video-player mount before we possibly re-mount
  // in the block below. Also called from goBack when leaving the post view.
  const cleanupPlayer = () => {
    const prev = activePlayerCleanup.get(postArtifactId);
    if (prev) {
      try { prev(); } catch (e) { console.warn('[frame] video-player cleanup threw', e); }
      activePlayerCleanup.delete(postArtifactId);
    }
  };

  const goBack = () => {
    cleanupPlayer();
    openedPost.delete(profile.id);
    videoOpen.delete(postArtifactId);
    renderFrameProfile(paneEl, caseData, profile, { onEvidenceAdded });
  };
  paneEl.querySelector('[data-action="close"]').addEventListener('click', goBack);

  const loadVideoBtn = paneEl.querySelector('[data-action="load-video"]');
  if (loadVideoBtn) {
    loadVideoBtn.addEventListener('click', () => {
      videoOpen.add(postArtifactId);
      renderOpenedPost(paneEl, caseData, profile, post, { onEvidenceAdded });
    });
  }

  // S7.3.3 — mount the real video player into the video-mount slot per
  // VIDEO_EVIDENCE_SPEC v1. Old close-video button is folded into the
  // player's own close (×) button so we still get symmetric teardown.
  const videoMountEl = paneEl.querySelector('[data-role="video-mount"]');
  if (showVideo && videoMountEl) {
    cleanupPlayer();  // clear stale mount before re-mount
    const cleanup = renderVideoPlayer(videoMountEl, {
      caseData,
      profile,
      post,
      videoId: `${postArtifactId}#video`,
      onClose: () => {
        videoOpen.delete(postArtifactId);
        renderOpenedPost(paneEl, caseData, profile, post, { onEvidenceAdded });
      },
      onFrameCaptured: () => {
        onEvidenceAdded && onEvidenceAdded();
      },
    });
    activePlayerCleanup.set(postArtifactId, cleanup);
  }

  const addBtn = paneEl.querySelector('[data-action="add-to-case"]');
  addBtn.addEventListener('click', () => {
    if (addBtn.disabled) return;
    emitAction('add_to_case', { artifactId: postArtifactId, tool: 'frame' });
    if (isInEvidence(postArtifactId)) {
      addBtn.disabled = true;
      addBtn.textContent = t('frame.actions.saved');
      onEvidenceAdded && onEvidenceAdded();
    }
  });
}
