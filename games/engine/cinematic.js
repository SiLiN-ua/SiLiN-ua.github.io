// engine/cinematic.js
// S7.5 — Cinematic Scheduler.
//
// Covers 9 beats: B3, B5, B6, B7, B8, B9, B10, B11, B12.
// B1, B2, B4 remain inline in workstation.js per S7.5 Option B (leave working
// code alone).
//
// Contract:
//   - Pure consumer. Never mutates state (uses hasCinematicFired /
//     markCinematicFired via imported state.js).
//   - Never emits sounds — sound bus (S7.4) handles all audio independently.
//   - Effect handlers add/remove CSS classes on found DOM elements. If DOM
//     is missing, effect is a silent no-op (never throws).
//   - Handlers wrapped in try/catch — a broken beat does not break gameplay
//     nor the scheduler for other beats (isolation).
//   - fromResume envelopes: one-shot beats no-op when fromResume=true (they
//     already fired historically).
//   - Beat dedup:
//        - most beats: one-shot per case (state.cinematic.firedOnce)
//        - B6 SAME FRAME: REPEATS per split-view re-entry (never one-shot;
//          gated per continuous split-view state — one fire per re-enter)
//        - B9 wrong-pick flash: dedup per (criterion+evidence) pair within
//          the current session (session-level Set, not persisted)
//   - Reduced-motion: beat classes are still added, but CSS provides
//     no-op fallbacks under `@media (prefers-reduced-motion: reduce)`.
//
// Boot integration: workstation.js calls initCinematicScheduler(caseData)
// AFTER initSoundBus + BEFORE setActionResumeMode(false).

import * as actions from './actions.js';
import {
  subscribe as subscribeState,
  hasCinematicFired,
  markCinematicFired,
  getState,
} from './state.js';

const REDUCED_MOTION = typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

// Session-level dedup (not persisted; per-session only, per §B9 approval).
const b9FiredPairs = new Set();     // key = `${criterionId}::${evidenceId}`

// B6 gating — SAME FRAME repeats per split-view re-entry.
// Track "is split-view currently active for the frame tool with matching pair?"
// So we fire ONCE per continuous split-view state, refire on re-enter.
let b6ArmedForSplit = false;

// Subscriptions and observers to tear down on _resetForTests.
const disposers = [];
let mutObserver = null;
let initialized = false;

// ---- Public API ----

export function _resetForTests() {
  for (const off of disposers) { try { off(); } catch {} }
  disposers.length = 0;
  if (mutObserver) { try { mutObserver.disconnect(); } catch {} mutObserver = null; }
  b9FiredPairs.clear();
  b6ArmedForSplit = false;
  initialized = false;
}

// Direct fire helper — useful for tests. Bypasses trigger detection but
// still respects oneShot + persistence gating for that beat.
export function fireBeat(beatId, opts = {}) {
  const handler = BEAT_HANDLERS[beatId];
  if (!handler) return false;
  return handler(opts);
}

// ---- Effect helpers (DOM manipulation kept tiny) ----

function pulseClass(el, cls, ms) {
  if (!el) return;
  el.classList.add(cls);
  setTimeout(() => { try { el.classList.remove(cls); } catch {} }, ms);
}

function q(sel) {
  try { return document.querySelector(sel); } catch { return null; }
}
function qa(sel) {
  try { return Array.from(document.querySelectorAll(sel)); } catch { return []; }
}

// ---- Beat handlers ----
// Each returns true if beat fired, false if skipped.

const BEAT_HANDLERS = {
  // B3: first open of profile_001#p1 (fake profile post p1)
  B3(payload) {
    if (hasCinematicFired('B3')) return false;
    const target = q('.frame-opened, .frame-post-card');
    pulseClass(target, 'is-b3-focus', 500);
    markCinematicFired('B3');
    return true;
  },

  // B5: TRACE 3-candidate stagger. Fired by MutationObserver when 3 trace-result
  // rows appear for the first time. Stagger applied by adding delay-based class.
  B5() {
    if (hasCinematicFired('B5')) return false;
    const rows = qa('.trace-result');
    if (rows.length < 3) return false;
    rows.slice(0, 3).forEach((row, i) => {
      row.classList.add(`is-b5-arriving-${i + 1}`);
      setTimeout(() => { try { row.classList.remove(`is-b5-arriving-${i + 1}`); } catch {} }, 600 + i * 150);
    });
    markCinematicFired('B5');
    return true;
  },

  // B6: SAME FRAME overlap recognition. REPEATS per split-view re-entry.
  // Fires when split_view_changed shows two frame_profile artifacts.
  // b6ArmedForSplit is set true while we've fired for the current continuous
  // split. Reset when split is dismissed.
  B6() {
    if (b6ArmedForSplit) return false;
    const posts = qa('.frame-profile .frame-post');
    if (posts.length < 3) return false;   // no matching pair to highlight
    // Highlight matching post covers by cover URL.
    const bySrc = new Map();
    for (const btn of posts) {
      const img = btn.querySelector('img');
      const src = img?.src || '';
      if (!src) continue;
      const list = bySrc.get(src) || [];
      list.push(btn);
      bySrc.set(src, list);
    }
    let anyMatched = false;
    for (const list of bySrc.values()) {
      if (list.length < 2) continue;
      anyMatched = true;
      for (const btn of list) {
        pulseClass(btn, 'is-b6-overlap-highlight', 700);
      }
    }
    if (anyMatched) {
      b6ArmedForSplit = true;
      // NOT persisted — this repeats per re-entry.
      return true;
    }
    return false;
  },

  // B7: first archive_snapshot open — browser-style loading bar.
  B7() {
    if (hasCinematicFired('B7')) return false;
    const target = q('.archive-snapshot, .tool-pane');
    pulseClass(target, 'is-b7-loading', 550);
    markCinematicFired('B7');
    return true;
  },

  // B8: temporal mismatch — highlight dates on the 2 relevant evidence rows.
  // Marked fired on state-level crossing (pair present in evidence). The DOM
  // effect is a best-effort layer: silent if the Evidence pane isn't rendered
  // at that instant. State crossing is the true trigger; visual is decoration.
  B8() {
    if (hasCinematicFired('B8')) return false;
    const rows = qa('.evidence-row');
    for (const row of rows) {
      const id = row.dataset.evidenceId || '';
      if (id === 'archive_snapshot_alex_miller_2024_03' ||
          id === 'archive_snapshot_alex_miller_uk_2023_05' ||
          id === 'archive_snapshot_alex_miller_uk_2019_02') {
        pulseClass(row, 'is-b8-temporal-emphasis', 1200);
      }
    }
    markCinematicFired('B8');
    return true;
  },

  // B9: wrong-pick orange flash. Dedup per (criterion+evidence) pair per session.
  // opts: { criterionId, evidenceId }
  B9({ criterionId, evidenceId } = {}) {
    if (!criterionId || !evidenceId) return false;
    const key = `${criterionId}::${evidenceId}`;
    if (b9FiredPairs.has(key)) return false;
    b9FiredPairs.add(key);
    // report-pane.js emits `data-criterion="${item.id}"` on report-item rows.
    // A.3 walkthrough found the earlier `data-criterion-id` was wrong: scheduler
    // fired B9 but pulseClass targeted nothing, so no visible flash.
    const rowSel = `[data-criterion="${criterionId}"]`;
    const target = q(rowSel);
    pulseClass(target, 'is-b9-wrong-flash', 600);
    return true;
  },

  // B10: first open of chat_profile_dcole_shoots. Handle-underline recognition.
  B10() {
    if (hasCinematicFired('B10')) return false;
    const target = q('.chat-profile__handle, .chat-profile');
    pulseClass(target, 'is-b10-handle-recog', 800);
    markCinematicFired('B10');
    return true;
  },

  // B11: first open of atlas_location_claim — pin drop bounce.
  B11() {
    if (hasCinematicFired('B11')) return false;
    const target = q('.atlas-map__pin');
    pulseClass(target, 'is-b11-pin-drop', 700);
    markCinematicFired('B11');
    return true;
  },

  // B12: submit-gate perimeter trace + verdict unfold.
  B12() {
    if (hasCinematicFired('B12')) return false;
    const submitBtn = q('.report-submit, [data-action="submit-report"]');
    pulseClass(submitBtn, 'is-b12-gate-open', 900);
    const verdict = q('.report-verdict-panel');
    pulseClass(verdict, 'is-b12-gate-open', 900);
    markCinematicFired('B12');
    return true;
  },
};

// ---- Init: wire subscriptions ----

export function initCinematicScheduler(caseData) {
  if (initialized) return;
  initialized = true;

  // ---- Action-bus triggers ----

  disposers.push(actions.on('open_artifact', (payload, envelope) => {
    try {
      if (envelope?.meta?.fromResume) return;
      const id = payload.artifactId;
      // B3
      if (id === 'profile_001#p1') { fireBeat('B3'); return; }
      // B10
      if (id === 'chat_profile_dcole_shoots') { fireBeat('B10'); return; }
      // B7 / B11 route by artifact type
      const artifact = caseData?.artifacts?.[id];
      const type = artifact?.type;
      if (type === 'archive_snapshot') { fireBeat('B7'); return; }
      if (type === 'atlas_location_claim') { fireBeat('B11'); return; }
    } catch (e) { console.warn('[cinematic] open_artifact handler', e); }
  }));

  // ---- State-bus triggers ----

  disposers.push(subscribeState((evt) => {
    try {
      if (evt.type === 'split_view_changed') {
        const splitPresent = evt.splitView &&
          typeof evt.splitView === 'object' &&
          Object.keys(evt.splitView).length > 0;
        if (splitPresent) {
          // Split-view active — try to fire B6 (self-gates via b6ArmedForSplit).
          // Defer to next tick so DOM renders before we inspect.
          setTimeout(() => fireBeat('B6'), 50);
        } else {
          // Split dismissed — re-arm B6 for next entry.
          b6ArmedForSplit = false;
        }
      } else if (evt.type === 'evidence_added') {
        // B8: check evidence set for temporal pair.
        const st = getState();
        const ids = new Set(st.evidence.map(e => e.sourceId));
        const hasFake = ids.has('archive_snapshot_alex_miller_2024_03');
        const hasReal = ids.has('archive_snapshot_alex_miller_uk_2023_05') ||
                        ids.has('archive_snapshot_alex_miller_uk_2019_02');
        if (hasFake && hasReal) {
          setTimeout(() => fireBeat('B8'), 50);
        }
      } else if (evt.type === 'pick_updated') {
        // B9: wrong-pick flash. Case 001 wrong = candidate_002 or _003 for identity_source.
        // Defer to next tick — workstation.js subscribes to pick_updated too and
        // re-renders the REPORT pane, which tears down the old row DOM. Firing
        // synchronously would hit the detached row. Deferring lets the fresh
        // row exist before pulseClass queries.
        const wrongIds = ['candidate_002', 'candidate_003'];
        if (evt.criterionId === 'identity_source' && wrongIds.includes(evt.evidenceId)) {
          setTimeout(() => fireBeat('B9', { criterionId: evt.criterionId, evidenceId: evt.evidenceId }), 50);
        }
      } else if (evt.type === 'report_all_required_met') {
        setTimeout(() => fireBeat('B12'), 50);
      } else if (evt.type === 'tool_changed' && evt.toolId === 'trace') {
        // B5: TRACE results DOM may appear now. MutationObserver already
        // watches, but do an immediate check in case results were pre-rendered.
        setTimeout(() => fireBeat('B5'), 100);
      }
    } catch (e) { console.warn('[cinematic] state handler', e); }
  }));

  // ---- B5 MutationObserver: watch tool-pane for .trace-result appearances ----

  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    try {
      const target = document.body;
      if (target) {
        mutObserver = new MutationObserver(() => {
          if (!hasCinematicFired('B5') && qa('.trace-result').length >= 3) {
            fireBeat('B5');
          }
        });
        mutObserver.observe(target, { childList: true, subtree: true });
      }
    } catch (e) { console.warn('[cinematic] MutationObserver init', e); }
  }
}
