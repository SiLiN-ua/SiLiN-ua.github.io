// ui/evidence-pane.js
// Renders the collected evidence list. Each card is an immutable snapshot.

import { getState } from '../engine/state.js';
import { resolveAsset } from '../engine/case-loader.js';
import { t, pick } from '../engine/i18n.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relTime(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 10) return t('reltime.now');
  if (s < 60) return t('reltime.seconds', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('reltime.minutes', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('reltime.hours', { n: h });
  const d = Math.floor(h / 24);
  return t('reltime.days', { n: d });
}

function cardHtml(evidence, caseData) {
  const snap = evidence.snapshot;
  const thumbSrc = snap.avatar
    ? resolveAsset(caseData, snap.avatar)
    : (snap.preview
        ? resolveAsset(caseData, snap.preview)
        : (snap.cover ? resolveAsset(caseData, snap.cover) : ''));

  let title, meta;
  if (snap.type === 'archive_snapshot') {
    title = pick(snap, 'kind_label') || t('archive.snapshot.title');
    meta = [snap.captured_at, snap.source_url].filter(Boolean).join(' · ');
  } else if (snap.type === 'chat_profile') {
    title = snap.display_name || snap.handle || snap.id;
    const handle = snap.handle ? `@${snap.handle}` : '';
    meta = [handle, snap.url, snap.location].filter(Boolean).join(' · ');
  } else if (snap.type === 'atlas_location_claim') {
    title = snap.status || t('atlas.claim.title');
    meta = [snap.subject, pick(snap, 'location_claimed')].filter(Boolean).join(' · ');
  } else {
    title = snap.display_name || snap.username || snap.title || snap.id;
    const handle = snap.username ? `@${snap.username}` : '';
    meta = [handle, snap.url, snap.location].filter(Boolean).join(' · ');
  }

  return `
    <div class="evidence-card">
      <div class="evidence-card__thumb">
        ${thumbSrc ? `<img src="${esc(thumbSrc)}" alt="">` : ''}
      </div>
      <div>
        <div class="evidence-card__id">${esc(evidence.evidenceId)} · ${esc(evidence.tool)}</div>
        <div class="evidence-card__title">${esc(title)}</div>
        <div class="evidence-card__meta">${esc(meta)}</div>
      </div>
      <div class="evidence-card__added">${esc(relTime(evidence.addedAt))}</div>
    </div>
  `;
}

export function renderEvidencePane(paneEl, caseData) {
  const state = getState();
  const items = state.evidence;
  const countKey = items.length === 1 ? 'evidence.count.one' : 'evidence.count.many';
  paneEl.innerHTML = `
    <div class="evidence-pane__header">
      <div class="evidence-pane__title">${t('evidence.title')}</div>
      <div class="evidence-pane__count">${t(countKey, { n: items.length })}</div>
    </div>
    ${items.length === 0
      ? `<div class="evidence-empty">${t('evidence.empty')}</div>`
      : `<div class="evidence-list">${items.map(e => cardHtml(e, caseData)).join('')}</div>`
    }
  `;
}
