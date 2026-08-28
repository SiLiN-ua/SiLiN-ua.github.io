// engine/state.js
// In-memory investigation state + evidence store.
// Emits change events so UI panes can re-render without direct coupling.
//
// V2-S1.2: schema v2 with 11 new fields, migration v1→v2 (idempotent, no data
// loss), integration with action bus (§14.2 / ACTION_BUS_CONTRACT.md).
//
// Two buses live here:
//   - Existing state bus (subscribe/emit) — state-change facts, UI panes
//     subscribe to it. Unchanged contract.
//   - Action bus (engine/actions.js) — player-intent events. state.js is a
//     CONSUMER: it registers mutation handlers that turn actions into state
//     mutations, which in turn fire state-bus events. state.js does NOT
//     import actions runtime context — actions.js is configured externally
//     via configureActionBus(...) below.

import { loadState, saveState, clearState, migrateLegacyKey } from './save.js';
import * as actions from './actions.js';
// report.js also imports getState from this file. ESM handles this cycle
// because evaluateReport is called at runtime, not at module init.
import { evaluateReport, evaluateSubmission } from './report.js';

const SCHEMA_VERSION = 2;

const listeners = new Set();
let state = null;
let unregisterActionHandlers = null;  // returned by registerActionHandlers

function defaultState(caseId) {
  return {
    version: SCHEMA_VERSION,
    caseId,
    startedAt: Date.now(),
    lastActivity: Date.now(),

    // v1 core (unchanged contract)
    evidence: [],
    activeTool: 'frame',
    finalSubmission: null,

    // v2 additions — every field has a safe default so a missing key never
    // crashes a reader.
    viewed: [],                    // Array<artifactId>
    clipboard: null,               // {value, ts} | null
    searches: [],                  // Array<{tool, query, ts}>
    splitView: {},                 // {[tool]: {a, b}}
    comparisons: [],               // Array<{aId, bId, aDate, bDate, ts}>
    videoBookmarks: {},            // {[videoId]: [{timestamp, label?, ts}]}
    videoState: {},                // {[videoId]: {currentTime_ms, playing}} — S7.3 VIDEO_EVIDENCE_SPEC §10
    frameCaptures: [],             // Array<{id, sourceVideoId, sourceTimestamp_ms, capturedAt_iso, imageDataUri}> — S7.3 §10
    links: [],                     // Array<{from, to, reason, ts}>
    picks: {},                     // {[criterionId]: evidenceId}
    cinematic: { firedOnce: [] },  // Array<beatId>
    timeline: [],                  // Array<envelope>
    sessionSeq: 0,                 // last action seq — actions.js resumes from here
    visits: 1,
    elapsedMsFromPriorVisits: 0,
  };
}

// S7.3 hard cap on frame captures per case per VIDEO_EVIDENCE_SPEC §13 Q4.
// At limit, extract_frame emits frame_capture_limit_reached event instead of
// silently no-op'ing. UI must handle by showing the limit banner.
export const FRAME_CAPTURE_HARD_CAP = 30;

// v2 field defaults, used by migration. Keep in sync with defaultState().
// A separate map so migration only adds missing keys — never overwrites.
const V2_FIELD_DEFAULTS = {
  viewed: () => [],
  clipboard: () => null,
  searches: () => [],
  splitView: () => ({}),
  comparisons: () => [],
  videoBookmarks: () => ({}),
  videoState: () => ({}),          // S7.3 — VIDEO_EVIDENCE_SPEC §10
  frameCaptures: () => [],         // S7.3 — VIDEO_EVIDENCE_SPEC §10
  links: () => [],
  picks: () => ({}),
  cinematic: () => ({ firedOnce: [] }),
  timeline: () => [],
  sessionSeq: () => 0,
  visits: () => 1,
  elapsedMsFromPriorVisits: () => 0,
};

// Idempotent v1 → v2 migration. Called on every load — a v2 save re-enters
// this and no-ops for present fields. Never overwrites existing values,
// never drops evidence / finalSubmission / activeTool.
export function migrateToV2(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const out = { ...raw };
  for (const [key, mk] of Object.entries(V2_FIELD_DEFAULTS)) {
    if (!(key in out) || out[key] === undefined) {
      out[key] = mk();
    }
  }
  // cinematic could exist but be malformed (e.g. missing firedOnce)
  if (!out.cinematic || typeof out.cinematic !== 'object') {
    out.cinematic = { firedOnce: [] };
  } else if (!Array.isArray(out.cinematic.firedOnce)) {
    out.cinematic.firedOnce = [];
  }
  out.version = SCHEMA_VERSION;
  return out;
}

// Accumulate the prior visit's *active* time before overwriting startedAt.
// CR-2 semantics: only count time between startedAt and lastActivity of the
// prior session (i.e., time actually spent in the workstation). Never count
// the gap while the tab was closed — the timer is an investigation diary,
// not calendar time. Skip silently on invalid / missing timestamps.
function accumulatePriorVisit(prior) {
  const s = Number(prior.startedAt);
  const l = Number(prior.lastActivity);
  if (Number.isFinite(s) && Number.isFinite(l) && l >= s) {
    return Math.max(0, l - s);
  }
  return 0;
}

// Returns {wasResume, state}. wasResume=true when a persisted state was
// found for this caseId with any evidence collected. Boot layer uses this
// to seed actions.configure({fromResume}). Emits lifecycle event
// (case_opened / case_resumed) after the state is ready so that any
// subscriber attached before initState sees a coherent world.
export function initState(caseId) {
  migrateLegacyKey();
  workstationStartedFired = false;  // fresh init = fresh lifecycle window
  const persisted = loadState(caseId);
  let wasResume = false;
  if (persisted && persisted.caseId === caseId) {
    state = migrateToV2(persisted);
    // "resume" means the player has actually done something before —
    // an empty state carried across a page reload is not a resume for
    // cinematic-gating purposes.
    wasResume = Array.isArray(state.evidence) && state.evidence.length > 0;
    if (wasResume) {
      state.elapsedMsFromPriorVisits = (Number(state.elapsedMsFromPriorVisits) || 0)
        + accumulatePriorVisit(state);
      state.visits = (state.visits || 1) + 1;
      state.startedAt = Date.now();
    }
    persist();
  } else {
    state = defaultState(caseId);
    persist();
  }
  emit(wasResume
    ? { type: 'case_resumed', caseId, visits: state.visits,
        elapsedMsFromPriorVisits: state.elapsedMsFromPriorVisits }
    : { type: 'case_opened', caseId });
  return { state, wasResume };
}

export function getState() {
  return state;
}

export function hasSavedState(caseId) {
  const persisted = loadState(caseId);
  return !!(persisted && persisted.evidence && persisted.evidence.length > 0);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(event) {
  for (const fn of listeners) {
    try { fn(event); } catch (e) { console.warn('[state] listener error', e); }
  }
}

function persist() {
  state.lastActivity = Date.now();
  // Snapshot the action-bus seq so it resumes cleanly on reload. Only
  // when the bus has actually been configured — otherwise `getSeq()`
  // would return the freshly-reset 0 and clobber the seq loaded from
  // disk (persist runs from inside initState, before configureActionBus).
  if (actions.isConfigured()) {
    state.sessionSeq = actions.getSeq();
  }
  saveState(state);
}

// ---- actions ----

export function setActiveTool(toolId) {
  if (state.activeTool === toolId) return;
  state.activeTool = toolId;
  persist();
  emit({ type: 'tool_changed', toolId });
}

export function addEvidence(artifact) {
  if (!artifact || !artifact.id) return null;
  const already = state.evidence.find(e => e.sourceId === artifact.id);
  if (already) return already;

  const evidenceId = `E-${String(state.evidence.length + 1).padStart(3, '0')}`;
  const snapshot = {
    evidenceId,
    sourceId: artifact.id,
    type: artifact.type || 'artifact',
    tool: artifact.tool || 'unknown',
    addedAt: Date.now(),
    // Immutable snapshot: clone the full artifact payload as-is.
    snapshot: JSON.parse(JSON.stringify(artifact)),
  };
  state.evidence.push(snapshot);
  persist();
  emit({ type: 'evidence_added', evidence: snapshot });
  return snapshot;
}

export function isInEvidence(artifactId) {
  return state.evidence.some(e => e.sourceId === artifactId);
}

// Derived: whether a tool is currently available to the player.
// Rules live in case.json → unlock_rules[toolId] = { ... }.
// A tool with no rule is always available. Supported keys inside a rule:
//   requires_evidence:    [id, ...]   — every listed id must be in evidence
//   requires_submission:  true        — state.finalSubmission must be set
// A rule with multiple keys must satisfy ALL of them.
export function isToolAvailable(toolId, caseData) {
  const rules = caseData && caseData.unlock_rules;
  const rule = rules && rules[toolId];
  if (!rule) return true;

  if (rule.requires_evidence && rule.requires_evidence.length) {
    if (!rule.requires_evidence.every(id => isInEvidence(id))) return false;
  }
  if (rule.requires_submission === true) {
    if (!state || !state.finalSubmission) return false;
  }
  return true;
}

export function resetAll() {
  const caseId = state?.caseId || 'case-001';
  clearState(caseId);
  state = defaultState(caseId);
  persist();
  emit({ type: 'reset' });
}

// Persist the analyst's filed conclusion. Latest submission replaces any prior
// one (unlimited retries — see session-8 spec). This function does NOT decide
// SOLVED / CLOSED — that verdict lives in engine/report.js evaluateSubmission
// and is passed in as `outcome`.
export function submitFinalReport({ attribution, supportingEvidenceIds, outcome }) {
  state.finalSubmission = {
    attribution: String(attribution || '').trim(),
    supportingEvidenceIds: Array.isArray(supportingEvidenceIds) ? [...supportingEvidenceIds] : [],
    submittedAt: Date.now(),
    outcome: outcome === 'SOLVED' ? 'SOLVED' : 'CLOSED',
  };
  persist();
  emit({ type: 'submission_updated', submission: state.finalSubmission });
  return state.finalSubmission;
}

// S7.3 — merge a video-player position/state patch. Called by the video player
// during autosave and on close. Not through action bus — this is UI-local
// playback state, not investigative intent (per ACTION_BUS_CONTRACT §2.3 and
// VIDEO_EVIDENCE_SPEC §8: play/pause/scrub stay UI-local).
export function saveVideoState(videoId, patch) {
  if (!videoId || !patch) return;
  if (!state.videoState) state.videoState = {};
  state.videoState[videoId] = { ...(state.videoState[videoId] || {}), ...patch };
  persist();
  emit({ type: 'video_state_updated', videoId, patch });
}

// S7.3 — manual delete of a frame_capture per VIDEO_EVIDENCE_SPEC §14 item 4.
// Removes the capture from state.frameCaptures. If the capture was already
// added to case as evidence, also removes it from state.evidence AND cleans up
// any state.links / state.picks that referenced it. Never called automatically —
// only via UI player action. Emits frame_capture_deleted for UI subscribers.
export function deleteFrameCapture(captureId, caseData) {
  if (!captureId || !state.frameCaptures) return false;
  const before = state.frameCaptures.length;
  state.frameCaptures = state.frameCaptures.filter(fc => fc.id !== captureId);
  if (state.frameCaptures.length === before) return false;

  // Remove any evidence entry that snapshotted this capture (sourceId match).
  state.evidence = state.evidence.filter(e => e.sourceId !== captureId);

  // Clean up links that reference the capture on either end.
  state.links = state.links.filter(l => l.from !== captureId && l.to !== captureId);

  // Unpick any criterion that pointed at this capture.
  const nextPicks = {};
  for (const [cid, evId] of Object.entries(state.picks || {})) {
    if (evId !== captureId) nextPicks[cid] = evId;
  }
  state.picks = nextPicks;

  // Drop from runtime artifact pool so open_artifact of a stale id fails cleanly.
  if (caseData && caseData.artifacts && caseData.artifacts[captureId]) {
    delete caseData.artifacts[captureId];
  }

  persist();
  emit({ type: 'frame_capture_deleted', captureId });
  return true;
}

// Dismissal path for the workstation host — close/ESC/tool-switch clear the
// split without going through the action bus (dismissal is a UI-local
// concern; the bus opens the split, the host closes it). Emits the same
// state event so subscribers can react uniformly.
export function clearSplitView(tool) {
  if (!state.splitView) return;
  if (tool == null) {
    if (Object.keys(state.splitView).length === 0) return;
    state.splitView = {};
  } else {
    if (!(tool in state.splitView)) return;
    delete state.splitView[tool];
  }
  persist();
  emit({ type: 'split_view_changed', tool: tool || null, splitView: state.splitView });
}

// ---- S7.3 helpers ----

// Format ms → "MM:SS.T" timestamp for artifact captions.
function formatTs(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '--:--.-';
  const total = Math.max(0, Math.round(Number(ms)));
  const mins = Math.floor(total / 60000);
  const secs = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

// Build the runtime artifact record for a frame_capture. This is the shape
// that lands in caseData.artifacts[capturedArtifactId] so add_to_case can
// pick it up uniformly through the existing addEvidence path.
function frameCaptureArtifact(capture) {
  const ts = formatTs(capture.sourceTimestamp_ms);
  return {
    id: capture.id,
    type: 'frame_capture',
    tool: 'frame',
    source_video: capture.sourceVideoId,
    source_timestamp_ms: capture.sourceTimestamp_ms,
    captured_at_iso: capture.capturedAt_iso,
    image: capture.imageDataUri,
    caption_en: `Frame at ${ts}`,
    caption_uk: `Кадр ${ts}`,
  };
}

// Rehydrate runtime artifact pool from persisted frameCaptures. Called by the
// boot layer AFTER initState + caseData load — so a reload restores the same
// artifact ids that were extracted previously, and any evidence snapshots
// keep working. Idempotent: overwrites are safe (same content).
export function rehydrateRuntimeArtifacts(caseData) {
  if (!caseData || !caseData.artifacts) return;
  if (!state || !Array.isArray(state.frameCaptures)) return;
  for (const cap of state.frameCaptures) {
    if (!cap || !cap.id) continue;
    caseData.artifacts[cap.id] = frameCaptureArtifact(cap);
  }
}

// ---- Action bus wiring ----

// Configure the action bus at boot. Boot layer calls this AFTER initState,
// then registerActionHandlers, then setActionResumeMode(false).
export function configureActionBus({ fromResume }) {
  actions.configure({
    caseId: state.caseId,
    fromResume: !!fromResume,
    initialSeq: state.sessionSeq || 0,
  });
}

export function setActionResumeMode(flag) {
  actions.setResumeMode(!!flag);
}

// Emit workstation_started once per session, from the boot layer after Play/
// Continue is clicked. Idempotent per S2_ACCEPTANCE.md §11.5 — subsequent
// calls in the same session are no-ops.
let workstationStartedFired = false;
export function announceWorkstationStarted({ fromResume } = {}) {
  if (workstationStartedFired) return;
  workstationStartedFired = true;
  emit({ type: 'workstation_started', fromResume: !!fromResume });
}

// Cinematic beat once-flags — persisted through state.cinematic.firedOnce
// so a beat does not replay on resume (per ACTION_BUS_CONTRACT §3.3 and
// S2_ACCEPTANCE §7). Beats do not affect gameplay — pure UI gating.
export function hasCinematicFired(beatId) {
  const list = state?.cinematic?.firedOnce;
  return Array.isArray(list) && list.includes(beatId);
}
export function markCinematicFired(beatId) {
  if (!state.cinematic) state.cinematic = { firedOnce: [] };
  if (!Array.isArray(state.cinematic.firedOnce)) state.cinematic.firedOnce = [];
  if (state.cinematic.firedOnce.includes(beatId)) return;
  state.cinematic.firedOnce.push(beatId);
  persist();
}

// Register S1.2 + S2.1 mutation handler(s). S1.2 added add_to_case; S2.1
// adds open_artifact for the sidebar HAS UPDATES dot invariant.
// Additionally wires a report-gate diff subscriber so subscribers see
// report_all_required_met / _lost as crossing events, not every-mutation
// notifications.
//
// Returns an unregister function (useful for tests).
export function registerActionHandlers(caseData) {
  if (!caseData || !caseData.artifacts) {
    console.warn('[state] registerActionHandlers: caseData.artifacts required');
    return () => {};
  }
  if (unregisterActionHandlers) {
    // Defensive: replace any prior registration (e.g. hot-reload).
    unregisterActionHandlers();
    unregisterActionHandlers = null;
  }

  const offs = [];

  offs.push(actions.on('add_to_case', ({ artifactId, tool }) => {
    const artifact = caseData.artifacts[artifactId];
    if (!artifact) {
      console.warn(`[state] add_to_case: unknown artifactId "${artifactId}"`);
      return;
    }
    // Preserve the id + tool hint from the action payload — matches how
    // tools historically called addEvidence directly.
    addEvidence({ ...artifact, id: artifactId, tool: artifact.tool || tool });
  }));

  offs.push(actions.on('split_view', ({ tool, primaryId, secondaryId }) => {
    // Q5 dismissal via null payload is spec'd; today the action-bus
    // validator requires string secondaryId, so nulls never arrive here.
    // Kept defensively so a future validator loosening does not silently
    // insert `null` into state.
    if (secondaryId == null) {
      delete state.splitView[tool];
    } else {
      state.splitView[tool] = { a: primaryId, b: secondaryId };
    }
    persist();
    emit({ type: 'split_view_changed', tool, splitView: state.splitView });
  }));

  // link_evidence — add or remove an edge in state.links.
  // Payload `{fromId, toId, reason}` adds an edge; `{fromId, toId, remove: true}`
  // removes any matching edge (unordered pair). §4.1 + §12 Q1.
  // On removal, silently unpick any state.picks[criterionId] whose value is
  // one of the participants — §12 Q6. Player can re-pick without a link.
  offs.push(actions.on('link_evidence', ({ fromId, toId, reason, remove }) => {
    const matches = (e) =>
      (e.from === fromId && e.to === toId) ||
      (e.from === toId && e.to === fromId);
    if (remove) {
      const before = state.links.length;
      state.links = state.links.filter(e => !matches(e));
      if (state.links.length === before) return;  // no-op
      // Auto-unpick — §12 Q6.
      let picksChanged = false;
      const nextPicks = {};
      for (const [cid, evId] of Object.entries(state.picks || {})) {
        if (evId === fromId || evId === toId) {
          picksChanged = true;
          continue;
        }
        nextPicks[cid] = evId;
      }
      if (picksChanged) state.picks = nextPicks;
      persist();
      emit({ type: 'link_removed', fromId, toId });
      return;
    }
    // Add — dedup on unordered pair.
    if (state.links.some(matches)) return;
    state.links.push({ from: fromId, to: toId, reason, ts: Date.now() });
    persist();
    emit({ type: 'link_added', fromId, toId, reason });
  }));

  // pick_evidence_for_criterion — records the analyst's choice of which
  // collected evidence stands for a given report criterion. Pure write; the
  // report evaluator remains derived from state.evidence (unchanged).
  offs.push(actions.on('pick_evidence_for_criterion', ({ criterionId, evidenceId }) => {
    if (!state.picks) state.picks = {};
    if (state.picks[criterionId] === evidenceId) return;
    state.picks[criterionId] = evidenceId;
    persist();
    emit({ type: 'pick_updated', criterionId, evidenceId });
  }));

  // submit_report — CR-1: verdict is derived here in the state handler,
  // never taken from the UI's payload. UI emits {attribution,
  // supportingEvidenceIds}; the outcome is computed via evaluateSubmission
  // against caseData.final_answer, then persisted through submitFinalReport.
  offs.push(actions.on('submit_report', ({ attribution, supportingEvidenceIds }) => {
    const evalRes = evaluateSubmission(caseData, {
      attribution,
      supportingEvidenceIds,
    });
    submitFinalReport({
      attribution,
      supportingEvidenceIds,
      outcome: evalRes.outcome,
    });
  }));

  // S7.3 — extract_frame: create a frame_capture artifact from the video's
  // current frame. Hard-capped at FRAME_CAPTURE_HARD_CAP per §13 Q4; at cap
  // we emit `frame_capture_limit_reached` (never silently no-op) so the UI
  // can show the limit banner and instruct manual delete.
  //
  // Expected payload: { videoId, timestamp, capturedArtifactId, imageDataUri }
  // - imageDataUri: full-resolution JPEG data URI per §13 Q3 (quality 85)
  // - timestamp: source_timestamp_ms (may be null in DEV MODE / placeholder)
  offs.push(actions.on('extract_frame', ({ videoId, timestamp, capturedArtifactId, imageDataUri }) => {
    if (!state.frameCaptures) state.frameCaptures = [];
    if (state.frameCaptures.length >= FRAME_CAPTURE_HARD_CAP) {
      emit({
        type: 'frame_capture_limit_reached',
        current: state.frameCaptures.length,
        max: FRAME_CAPTURE_HARD_CAP,
      });
      return;
    }
    const capturedAt_iso = new Date().toISOString();
    const capture = {
      id: capturedArtifactId,
      sourceVideoId: videoId,
      sourceTimestamp_ms: timestamp == null ? null : Number(timestamp),
      capturedAt_iso,
      imageDataUri: imageDataUri || null,
    };
    state.frameCaptures.push(capture);

    // Register a runtime artifact so +ADD TO CASE via add_to_case handler works
    // uniformly (case.artifacts[id] lookup finds a valid record). This is a
    // runtime mutation of caseData — not persisted in case.json, rehydrated
    // from state.frameCaptures on load (see rehydrateRuntimeArtifacts below).
    caseData.artifacts[capturedArtifactId] = frameCaptureArtifact(capture);

    persist();
    emit({ type: 'frame_captured', capture });
  }));

  // S7.3 — mark_moment: append a bookmark to state.videoBookmarks[videoId].
  // Idempotency: same timestamp on same video does NOT dedup — different marks
  // for different reasons are player-authored notes and belong preserved.
  offs.push(actions.on('mark_moment', ({ videoId, timestamp, label }) => {
    if (!videoId) return;
    if (!state.videoBookmarks) state.videoBookmarks = {};
    if (!state.videoBookmarks[videoId]) state.videoBookmarks[videoId] = [];
    state.videoBookmarks[videoId].push({
      timestamp: Number(timestamp) || 0,
      label: label ? String(label).slice(0, 60) : null,
      ts: Date.now(),
    });
    persist();
    emit({ type: 'moment_marked', videoId, timestamp });
  }));

  offs.push(actions.on('open_artifact', ({ artifactId }) => {
    // Set semantics — dedup a repeat click on the same card. The action
    // envelope still fires (per §2.2 idempotency: "Ні — кожен click"),
    // but state.viewed only grows on the first view.
    if (!state.viewed.includes(artifactId)) {
      state.viewed.push(artifactId);
      persist();
      emit({ type: 'viewed_added', artifactId });
    }
  }));

  // Report-gate diff: after any mutation that could change allMet, run
  // evaluateReport() and emit a crossing event only when the flag flips.
  // Seed lastAllMet from the current state so a resume that arrives with
  // criteria already satisfied does not immediately re-emit the crossing.
  let lastAllMet = !!evaluateReport(caseData).allMet;
  const RECOMPUTE_ON = new Set(['evidence_added', 'submission_updated', 'reset']);
  const gateListener = (evt) => {
    if (!RECOMPUTE_ON.has(evt.type)) return;
    const r = evaluateReport(caseData);
    const now = !!r.allMet;
    if (now !== lastAllMet) {
      lastAllMet = now;
      emit(now
        ? { type: 'report_all_required_met', quality: r.quality?.overall }
        : { type: 'report_all_required_lost' });
    }
  };
  const offGate = subscribe(gateListener);
  offs.push(offGate);

  // §14.7 — Branch tracker. Wildcard consumer that logs every action envelope
  // into state.timeline. Analyst Mode will use this to rebuild what the player
  // did during the session (§14.7 spec). Skip fromResume replays so that a
  // resume boot does NOT double-log the pre-resume history (that history is
  // already in the persisted state.timeline). Persist after each push so
  // timeline survives a reload — dependency on other handlers calling persist
  // is not guaranteed for read-only actions (open_artifact, search, etc.).
  const offTimeline = actions.onAny((envelope) => {
    if (envelope?.meta?.fromResume) return;
    state.timeline.push(envelope);
    persist();
  });
  offs.push(offTimeline);

  unregisterActionHandlers = () => {
    for (const off of offs) off();
  };
  return unregisterActionHandlers;
}
