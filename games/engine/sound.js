// engine/sound.js
// S7.4 — Sound bus per ACTION_BUS_CONTRACT §3.2 and S6 §2 event map.
//
// Rules (locked):
//   - Consumes action bus and state bus. Never mutates state.
//   - open_artifact: base ui.click IS REPLACED (not layered) by a specialized
//     sound when artifact.type matches:
//        archive_snapshot     → archive.load
//        atlas_location_claim → pin.drop
//        otherwise            → ui.click
//   - link_evidence: sound only on link ADD (payload.remove !== true).
//   - submit_report: outcome not in payload (CR-1). Sound consumed from state
//     event `submission_updated` where state.finalSubmission.outcome is
//     'SOLVED' → case.solved, 'CLOSED' → case.closed.
//   - state event `report_all_required_met` → case.ready (crossing, single-fire).
//   - Per-type debounce 400ms (S6 §5).
//   - fromResume envelopes no-op (S6 §7.3): a historical action re-played by
//     the bus at resume must NOT retrigger sound.
//   - Mute persisted at localStorage['cz.audio.muted']. play() no-op if muted.
//   - Fanout isolation: every handler wrapped in try/catch. A broken sound
//     never breaks gameplay (S6 §14).
//   - Preload all 10 assets at initSoundBus().
//
// SCOPE (locked):
//   9/10 events wired. criterion.satisfied is explicitly DEFERRED — its trigger
//   `report_criterion_satisfied` is not emitted by state.js. Adding that would
//   expand scope to state.js; parked.
//   search.done wired but naturally silent until tools start emitting the
//   `search` action (existing gap tracked separately).

import * as actions from './actions.js';
import { subscribe as subscribeState } from './state.js';

// ---- Configuration constants ----
const SOUNDS_PATH = './sounds/';           // resolved relative to site/games/case-zero.html
const MUTE_STORAGE_KEY = 'cz.audio.muted';
const DEBOUNCE_MS = 400;                   // S6 §5
const SOUND_IDS = [
  'ui.click',
  'evidence.saved',
  'evidence.link',
  'search.done',
  'archive.load',
  'pin.drop',
  'case.ready',
  'case.solved',
  'case.closed',
  // criterion.satisfied — asset exists, event trigger deferred
  'criterion.satisfied',
];

// ---- Internal state ----
const audioPool = new Map();      // id → HTMLAudioElement (or test shim)
const lastFiredTs = new Map();    // id → last play ts (ms)
let muted = false;                // hydrated from storage in initSoundBus
let initialized = false;
let unsubscribeState = null;
const unsubscribeActions = [];

// ---- Storage helpers (safe with private-mode / no-localStorage) ----
function readMutedFromStorage() {
  try {
    const raw = globalThis.localStorage?.getItem(MUTE_STORAGE_KEY);
    return raw === '1' || raw === 'true';
  } catch { return false; }
}
function writeMutedToStorage(v) {
  try {
    globalThis.localStorage?.setItem(MUTE_STORAGE_KEY, v ? '1' : '0');
  } catch { /* ignore */ }
}

// ---- Audio element factory (overridable for tests) ----
// Test suites replace this via setAudioFactory() so play() calls a mock.
let audioFactory = defaultAudioFactory;
function defaultAudioFactory(id) {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('audio');
  el.preload = 'auto';
  const srcOpus = document.createElement('source');
  srcOpus.src = `${SOUNDS_PATH}${id}.opus`;
  srcOpus.type = 'audio/ogg; codecs=opus';  // Chrome/Firefox accept
  const srcOgg = document.createElement('source');
  srcOgg.src = `${SOUNDS_PATH}${id}.ogg`;
  srcOgg.type = 'audio/ogg';
  el.appendChild(srcOpus);
  el.appendChild(srcOgg);
  // Attach off-screen so preload triggers on all browsers.
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
}

// ---- Public API ----

export function setAudioFactory(fn) {
  audioFactory = typeof fn === 'function' ? fn : defaultAudioFactory;
}
export function _resetForTests() {
  // Test-only cleanup: tear down subscriptions + clear caches.
  for (const off of unsubscribeActions) { try { off(); } catch {} }
  unsubscribeActions.length = 0;
  if (unsubscribeState) { try { unsubscribeState(); } catch {} unsubscribeState = null; }
  audioPool.clear();
  lastFiredTs.clear();
  muted = false;
  initialized = false;
  audioFactory = defaultAudioFactory;
}

export function isMuted() { return muted; }

export function setMuted(v) {
  muted = !!v;
  writeMutedToStorage(muted);
  return muted;
}

export function toggleMuted() {
  return setMuted(!muted);
}

// Preload all sounds — creates the audio elements (idempotent).
export function preload() {
  for (const id of SOUND_IDS) {
    if (audioPool.has(id)) continue;
    const el = audioFactory(id);
    if (el) audioPool.set(id, el);
  }
}

// Play a sound by id. No-op if muted / debounced / element missing.
// Never throws. Errors are caught and swallowed.
export function play(id) {
  if (muted) return false;
  if (!id) return false;

  const now = Date.now();
  const last = lastFiredTs.get(id) || 0;
  if (now - last < DEBOUNCE_MS) return false;   // S6 §5 debounce

  let el = audioPool.get(id);
  if (!el) {
    el = audioFactory(id);
    if (!el) return false;
    audioPool.set(id, el);
  }

  try {
    try { el.currentTime = 0; } catch { /* not seekable yet — ignore */ }
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => { /* autoplay policy / no audio — swallow */ });
    }
    lastFiredTs.set(id, now);
    return true;
  } catch {
    return false;
  }
}

// ---- Boot ----

// Called from workstation.js boot() AFTER configureActionBus + registerActionHandlers.
// caseData is used only for open_artifact type lookup (specialized sound routing).
export function initSoundBus(caseData) {
  if (initialized) return;
  initialized = true;

  // Hydrate mute flag from storage.
  muted = readMutedFromStorage();

  // Preload all sounds.
  preload();

  // ---- Action-bus subscriptions ----
  // Each handler receives (payload, envelope). fromResume envelopes no-op.

  unsubscribeActions.push(actions.on('open_artifact', (payload, envelope) => {
    if (envelope?.meta?.fromResume) return;
    try {
      // Specialized-replaces-base rule per Ivan (S7.4 approved).
      const artifact = caseData?.artifacts?.[payload.artifactId];
      const t = artifact?.type;
      if (t === 'archive_snapshot') return void play('archive.load');
      if (t === 'atlas_location_claim') return void play('pin.drop');
      play('ui.click');
    } catch (e) { console.warn('[sound] open_artifact handler', e); }
  }));

  unsubscribeActions.push(actions.on('add_to_case', (_payload, envelope) => {
    if (envelope?.meta?.fromResume) return;
    try { play('evidence.saved'); } catch (e) { console.warn('[sound] add_to_case', e); }
  }));

  unsubscribeActions.push(actions.on('link_evidence', (payload, envelope) => {
    if (envelope?.meta?.fromResume) return;
    if (payload?.remove === true) return;    // silent on removal per S6 §2 event #4
    try { play('evidence.link'); } catch (e) { console.warn('[sound] link_evidence', e); }
  }));

  unsubscribeActions.push(actions.on('search', (_payload, envelope) => {
    if (envelope?.meta?.fromResume) return;
    try { play('search.done'); } catch (e) { console.warn('[sound] search', e); }
  }));

  // ---- State-bus subscription ----
  // report_all_required_met crosses only once per crossing (state.js guards).
  // submission_updated fires on every submit; derive outcome from state.
  unsubscribeState = subscribeState((evt) => {
    try {
      if (evt.type === 'report_all_required_met') {
        play('case.ready');
      } else if (evt.type === 'submission_updated') {
        const outcome = evt.submission?.outcome;
        if (outcome === 'SOLVED') play('case.solved');
        else if (outcome === 'CLOSED') play('case.closed');
      }
    } catch (e) { console.warn('[sound] state handler', e); }
  });
}
