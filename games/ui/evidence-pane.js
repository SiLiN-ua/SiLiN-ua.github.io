// ui/evidence-pane.js
// Renders the collected evidence list. Each card is an immutable snapshot.

import { getState } from '../engine/state.js';
import { resolveAsset } from '../engine/case-loader.js';

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
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
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
    title = snap.kind_label || 'ARCHIVE SNAPSHOT';
    meta = [snap.captured_at, snap.source_url].filter(Boolean).join(' · ');
  } else if (snap.type === 'chat_profile') {
    title = snap.display_name || snap.handle || snap.id;
    const handle = snap.handle ? `@${snap.handle}` : '';
    meta = [handle, snap.url, snap.location].filter(Boolean).join(' · ');
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
  paneEl.innerHTML = `
    <div class="evidence-pane__header">
      <div class="evidence-pane__title">Evidence</div>
      <div class="evidence-pane__count">${items.length} item${items.length === 1 ? '' : 's'}</div>
    </div>
    ${items.length === 0
      ? `<div class="evidence-empty">No evidence yet. Open a source, inspect, then <b>+ Add to case</b>.</div>`
      : `<div class="evidence-list">${items.map(e => cardHtml(e, caseData)).join('')}</div>`
    }
  `;
}
