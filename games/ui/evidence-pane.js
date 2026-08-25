// ui/evidence-pane.js
// EVIDENCE pane — the analyst's investigation collection. Not a data table,
// not a card grid. Vertical index-card stack with hairline separators, real
// thumbnails, provenance line, and an inline `⟷ LINK` affordance per row.
// See S4_EVIDENCE_PROGRESSION_ACCEPTANCE.md §3, §4.

import { getState } from '../engine/state.js';
import { resolveAsset } from '../engine/case-loader.js';
import { t, pick } from '../engine/i18n.js';
import * as actions from '../engine/actions.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Six controlled reasons, mono. §4.1 + §18.10.
const LINK_REASONS = [
  'content overlap',
  'same handle',
  'date mismatch',
  'identity connection',
  'source attribution',
  'location correlation',
];

// Ephemeral UI mode — never persisted.
//   {mode:'idle'}
//   {mode:'expanded', id}                            selected evidence detail
//   {mode:'picking', fromId}                         chose LINK, waiting for target
//   {mode:'reason',  fromId, toId}                   chose pair, waiting for reason
let uiMode = { mode: 'idle' };

// Retained across re-renders so wired event handlers can call back into
// renderEvidencePane with the correct scope.
let lastPane = null;
let lastCase = null;

// Resolve a display "handle" or title for an evidence item.
function titleFor(evidence) {
  const snap = evidence.snapshot;
  if (snap.type === 'archive_snapshot') {
    return pick(snap, 'kind_label') || t('archive.snapshot.title');
  }
  if (snap.type === 'chat_profile') {
    return snap.display_name || snap.handle || snap.id;
  }
  if (snap.type === 'atlas_location_claim') {
    return snap.subject || snap.status || t('atlas.claim.title');
  }
  return snap.display_name || snap.username || snap.title || snap.id;
}

function subMetaFor(evidence) {
  const snap = evidence.snapshot;
  if (snap.type === 'archive_snapshot') {
    return [snap.source_url, snap.captured_at].filter(Boolean).join(' · ');
  }
  if (snap.type === 'chat_profile') {
    const handle = snap.handle ? '@' + snap.handle : '';
    return [handle, snap.url, pick(snap, 'location')].filter(Boolean).join(' · ');
  }
  if (snap.type === 'atlas_location_claim') {
    return [pick(snap, 'location_claimed'), snap.status].filter(Boolean).join(' · ');
  }
  const handle = snap.username ? '@' + snap.username : '';
  return [handle, snap.url, pick(snap, 'location')].filter(Boolean).join(' · ');
}

// Provenance line — where the artifact came from, when. Mono micro caps.
// §3.f: "Added from FRAME · 12:34 session time".
function provenanceFor(evidence) {
  const tool = String(evidence.tool || 'unknown').toUpperCase();
  const state = getState();
  const started = Number(state?.startedAt) || evidence.addedAt;
  const elapsed = Math.max(0, (evidence.addedAt || 0) - started);
  const s = Math.floor(elapsed / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${t('evidence.provenance.from')} ${tool} · ${mm}:${ss} ${t('evidence.provenance.session')}`;
}

function thumbSrcFor(evidence, caseData) {
  const snap = evidence.snapshot;
  const rel = snap.avatar || snap.preview || snap.cover || null;
  return rel ? resolveAsset(caseData, rel) : '';
}

// Detect which evidence items are linked. Returns Map<evidenceSourceId, Array<{otherId, reason}>>.
function linksIndex() {
  const links = getState().links || [];
  const idx = new Map();
  for (const l of links) {
    if (!idx.has(l.from)) idx.set(l.from, []);
    if (!idx.has(l.to)) idx.set(l.to, []);
    idx.get(l.from).push({ otherId: l.to, reason: l.reason });
    idx.get(l.to).push({ otherId: l.from, reason: l.reason });
  }
  return idx;
}

// Group items so linked pairs render adjacent, with the connector caption
// row between them. §3.d recommended: shared mono caption row above the pair.
// Non-linked items keep their original order.
function orderedItems(items) {
  const links = getState().links || [];
  const seen = new Set();
  const out = [];
  const byId = new Map(items.map(e => [e.sourceId, e]));

  // Pass 1: pull linked pairs into adjacency.
  for (const e of items) {
    if (seen.has(e.sourceId)) continue;
    const link = links.find(l => l.from === e.sourceId || l.to === e.sourceId);
    if (!link) {
      out.push({ kind: 'card', evidence: e });
      seen.add(e.sourceId);
      continue;
    }
    const otherId = link.from === e.sourceId ? link.to : link.from;
    const other = byId.get(otherId);
    if (!other || seen.has(otherId)) {
      out.push({ kind: 'card', evidence: e });
      seen.add(e.sourceId);
      continue;
    }
    // Emit pair with caption between.
    out.push({ kind: 'card', evidence: e, inPair: 'top' });
    out.push({ kind: 'link-caption', reason: link.reason, fromId: e.sourceId, toId: otherId });
    out.push({ kind: 'card', evidence: other, inPair: 'bottom' });
    seen.add(e.sourceId);
    seen.add(otherId);
  }
  return out;
}

function cardRowHtml(evidence, caseData, { inPair, isExpanded, isDim, isPickTarget, isPickSource }) {
  const thumb = thumbSrcFor(evidence, caseData);
  const title = titleFor(evidence);
  const sub = subMetaFor(evidence);
  const prov = provenanceFor(evidence);
  const cls = [
    'evidence-row',
    inPair ? `evidence-row--pair-${inPair}` : '',
    isExpanded ? 'is-expanded' : '',
    isDim ? 'is-dim' : '',
    isPickTarget ? 'is-pick-target' : '',
    isPickSource ? 'is-pick-source' : '',
  ].filter(Boolean).join(' ');

  const linkLabel = isPickSource
    ? t('evidence.link.picking_from')
    : isPickTarget
      ? t('evidence.link.pick_this')
      : t('evidence.link.affordance');

  return `
    <div class="${cls}" data-evidence-id="${esc(evidence.sourceId)}">
      <div class="evidence-row__thumb">
        ${thumb ? `<img src="${esc(thumb)}" alt="">` : ''}
      </div>
      <div class="evidence-row__body">
        <div class="evidence-row__title">${esc(title)}</div>
        <div class="evidence-row__sub">${esc(sub)}</div>
        <div class="evidence-row__provenance">${esc(prov)}</div>
      </div>
      <div class="evidence-row__id">${esc(evidence.evidenceId)} · ${esc(String(evidence.tool || '').toUpperCase())}</div>
      <button type="button" class="evidence-row__link" data-action="link-affordance" data-evidence-id="${esc(evidence.sourceId)}">
        <span aria-hidden="true">⟷</span> ${esc(linkLabel)}
      </button>
    </div>
  `;
}

function linkCaptionHtml(reason, fromId, toId) {
  return `
    <div class="evidence-link-caption" data-from="${esc(fromId)}" data-to="${esc(toId)}">
      <span class="evidence-link-caption__glyph" aria-hidden="true">⟷</span>
      <span class="evidence-link-caption__reason">${esc(String(reason || '').toUpperCase())}</span>
      <button type="button" class="evidence-link-caption__unlink" data-action="unlink" data-from="${esc(fromId)}" data-to="${esc(toId)}">
        × ${esc(t('evidence.link.unlink'))}
      </button>
    </div>
  `;
}

function expandedDetailHtml(evidence, caseData) {
  const thumb = thumbSrcFor(evidence, caseData);
  const title = titleFor(evidence);
  const sub = subMetaFor(evidence);
  const prov = provenanceFor(evidence);
  const idx = linksIndex().get(evidence.sourceId) || [];
  const snap = evidence.snapshot;

  const metaRows = [];
  if (snap.type === 'chat_profile') {
    if (snap.handle) metaRows.push(['@', snap.handle]);
    if (snap.url) metaRows.push([t('archive.snapshot.field.source'), snap.url]);
    const loc = pick(snap, 'location');
    if (loc) metaRows.push([t('atlas.claim.field.location_claimed'), loc]);
  } else if (snap.type === 'archive_snapshot') {
    if (snap.captured_at) metaRows.push([t('archive.snapshot.field.captured'), snap.captured_at]);
    if (snap.source_url) metaRows.push([t('archive.snapshot.field.source'), snap.source_url]);
    const kind = pick(snap, 'kind_label');
    if (kind) metaRows.push([t('archive.snapshot.field.kind'), kind]);
  } else if (snap.type === 'atlas_location_claim') {
    if (snap.subject) metaRows.push([t('atlas.claim.field.subject'), snap.subject]);
    const loc = pick(snap, 'location_claimed');
    if (loc) metaRows.push([t('atlas.claim.field.location_claimed'), loc]);
    if (snap.status) metaRows.push([t('atlas.claim.field.status'), snap.status]);
  } else {
    if (snap.username) metaRows.push(['@', snap.username]);
    if (snap.url) metaRows.push([t('archive.snapshot.field.source'), snap.url]);
  }

  return `
    <aside class="evidence-detail" data-detail-for="${esc(evidence.sourceId)}">
      <div class="evidence-detail__eyebrow">${esc(evidence.evidenceId)} · ${esc(String(evidence.tool || '').toUpperCase())}</div>
      <div class="evidence-detail__title">${esc(title)}</div>
      <div class="evidence-detail__sub">${esc(sub)}</div>
      ${thumb ? `<div class="evidence-detail__thumb"><img src="${esc(thumb)}" alt=""></div>` : ''}
      <div class="evidence-detail__provenance">${esc(prov)}</div>
      ${metaRows.length ? `
        <dl class="evidence-detail__meta">
          ${metaRows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
        </dl>
      ` : ''}
      ${idx.length ? `
        <div class="evidence-detail__links-title">${t('evidence.detail.links')}</div>
        <ul class="evidence-detail__links">
          ${idx.map(l => `
            <li>
              <span class="evidence-detail__link-glyph" aria-hidden="true">⟷</span>
              <span class="evidence-detail__link-target" data-jump="${esc(l.otherId)}">${esc(l.otherId)}</span>
              <span class="evidence-detail__link-reason">${esc(String(l.reason || '').toUpperCase())}</span>
            </li>
          `).join('')}
        </ul>
      ` : ''}
    </aside>
  `;
}

function pickerBannerHtml() {
  if (uiMode.mode === 'picking') {
    return `
      <div class="evidence-picker">
        <div class="evidence-picker__prompt">${t('evidence.link.prompt', { id: uiMode.fromId })}</div>
        <button type="button" class="evidence-picker__cancel" data-action="picker-cancel">× ${esc(t('evidence.link.cancel'))}</button>
      </div>
    `;
  }
  if (uiMode.mode === 'reason') {
    return `
      <div class="evidence-picker">
        <div class="evidence-picker__prompt">${t('evidence.link.reason_prompt')}</div>
        <select class="evidence-picker__reason" data-action="reason-select">
          <option value="">—</option>
          ${LINK_REASONS.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
        </select>
        <button type="button" class="evidence-picker__cancel" data-action="picker-cancel">× ${esc(t('evidence.link.cancel'))}</button>
      </div>
    `;
  }
  return '';
}

export function renderEvidencePane(paneEl, caseData) {
  lastPane = paneEl;
  lastCase = caseData;
  const state = getState();
  const items = state.evidence;
  const countKey = items.length === 1 ? 'evidence.count.one' : 'evidence.count.many';

  // Empty state — serif italic single line. §3.a.
  if (!items.length) {
    paneEl.innerHTML = `
      <div class="evidence-pane">
        <div class="evidence-pane__header">
          <div class="evidence-pane__title">${t('evidence.title')}</div>
        </div>
        <div class="evidence-empty">${t('evidence.empty')}</div>
      </div>
    `;
    return;
  }

  const rows = orderedItems(items);
  const expandedId = uiMode.mode === 'expanded' ? uiMode.id : null;
  const expandedEv = expandedId ? items.find(e => e.sourceId === expandedId) : null;
  const isPicking = uiMode.mode === 'picking' || uiMode.mode === 'reason';
  const pickFromId = isPicking ? uiMode.fromId : null;
  const pickToId = uiMode.mode === 'reason' ? uiMode.toId : null;

  const listHtml = rows.map(row => {
    if (row.kind === 'link-caption') {
      return linkCaptionHtml(row.reason, row.fromId, row.toId);
    }
    const eId = row.evidence.sourceId;
    const isExpanded = eId === expandedId;
    const isDim = (expandedId && !isExpanded) || (isPicking && pickFromId !== eId && pickToId !== eId && uiMode.mode === 'reason');
    const isPickTarget = uiMode.mode === 'picking' && eId !== pickFromId;
    const isPickSource = isPicking && eId === pickFromId;
    return cardRowHtml(row.evidence, caseData, {
      inPair: row.inPair, isExpanded, isDim, isPickTarget, isPickSource,
    });
  }).join('');

  paneEl.innerHTML = `
    <div class="evidence-pane${expandedEv ? ' evidence-pane--split' : ''}${isPicking ? ' evidence-pane--picking' : ''}">
      <div class="evidence-pane__header">
        <div class="evidence-pane__title">${t('evidence.title')}</div>
        <div class="evidence-pane__count">${t(countKey, { n: items.length })}</div>
      </div>
      ${pickerBannerHtml()}
      <div class="evidence-pane__body">
        <div class="evidence-list">
          ${listHtml}
        </div>
        ${expandedEv ? expandedDetailHtml(expandedEv, caseData) : ''}
      </div>
    </div>
  `;

  wireEvents(paneEl);
}

function wireEvents(paneEl) {
  // LINK affordance — start picker, advance picker, or (from source) cancel.
  paneEl.querySelectorAll('[data-action="link-affordance"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const eId = btn.dataset.evidenceId;
      if (uiMode.mode === 'picking') {
        if (eId === uiMode.fromId) {
          uiMode = { mode: 'idle' };
        } else {
          uiMode = { mode: 'reason', fromId: uiMode.fromId, toId: eId };
        }
      } else if (uiMode.mode === 'reason') {
        // Ignore — must pick reason first.
        return;
      } else {
        uiMode = { mode: 'picking', fromId: eId };
      }
      rerender();
    });
  });

  // Row click (outside link affordance) — expand / collapse detail,
  // or in picker mode, advance the pair.
  paneEl.querySelectorAll('.evidence-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const eId = row.dataset.evidenceId;
      if (uiMode.mode === 'picking') {
        if (eId === uiMode.fromId) return;
        uiMode = { mode: 'reason', fromId: uiMode.fromId, toId: eId };
        rerender();
        return;
      }
      if (uiMode.mode === 'expanded' && uiMode.id === eId) {
        uiMode = { mode: 'idle' };
      } else if (uiMode.mode !== 'reason') {
        uiMode = { mode: 'expanded', id: eId };
      }
      rerender();
    });
  });

  // Reason dropdown — pick reason → emit link_evidence.
  const reasonSel = paneEl.querySelector('[data-action="reason-select"]');
  if (reasonSel) {
    reasonSel.addEventListener('change', () => {
      const val = reasonSel.value;
      if (!val) return;
      const { fromId, toId } = uiMode;
      uiMode = { mode: 'idle' };
      actions.emit('link_evidence', { fromId, toId, reason: val });
    });
  }

  // Cancel picker.
  paneEl.querySelectorAll('[data-action="picker-cancel"]').forEach(btn => {
    btn.addEventListener('click', () => {
      uiMode = { mode: 'idle' };
      rerender();
    });
  });

  // Unlink from caption.
  paneEl.querySelectorAll('[data-action="unlink"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fromId = btn.dataset.from;
      const toId = btn.dataset.to;
      actions.emit('link_evidence', { fromId, toId, remove: true });
    });
  });

  // Detail: click a link target to jump to it.
  paneEl.querySelectorAll('[data-jump]').forEach(el => {
    el.addEventListener('click', () => {
      uiMode = { mode: 'expanded', id: el.dataset.jump };
      rerender();
    });
  });

  // ESC clears any transient mode.
  const escHandler = (ev) => {
    if (ev.key !== 'Escape') return;
    if (uiMode.mode !== 'idle') {
      uiMode = { mode: 'idle' };
      rerender();
    }
  };
  paneEl.__evidenceEsc && document.removeEventListener('keydown', paneEl.__evidenceEsc);
  paneEl.__evidenceEsc = escHandler;
  document.addEventListener('keydown', escHandler);
}

function rerender() {
  if (lastPane && lastCase) renderEvidencePane(lastPane, lastCase);
}

// Test / debug helper.
export function _resetEvidenceUiMode() {
  uiMode = { mode: 'idle' };
}
