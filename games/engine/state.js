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
    links: [],                     // Array<{from, to, reason, ts}>
    picks: {},                     // {[criterionId]: evidenceId}
    cinematic: { firedOnce: [] },  // Array<beatId>
    timeline: [],                  // Array<envelope>
    sessionSeq: 0,                 // last action seq — actions.js resumes from here
    visits: 1,
    elapsedMsFromPriorVisits: 0,
  };
}

// v2 field defaults, used by migration. Keep in sync with defaultState().
// A separate map so migration only adds missing keys — never overwrites.
const V2_FIELD_DEFAULTS = {
  viewed: () => [],
  clipboard: () => null,
  searches: () => [],
  splitView: () => ({}),
  comparisons: () => [],
  videoBookmarks: () => ({}),
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

// Returns {wasResume, state}. wasResume=true when a persisted state was
// found for this caseId with any evidence collected. Boot layer uses this
// to seed actions.configure({fromResume}).
export function initState(caseId) {
  migrateLegacyKey();
  const persisted = loadState(caseId);
  let wasResume = false;
  if (persisted && persisted.caseId === caseId) {
    state = migrateToV2(persisted);
    // "resume" means the player has actually done something before —
    // an empty state carried across a page reload is not a resume for
    // cinematic-gating purposes.
    wasResume = Array.isArray(state.evidence) && state.evidence.length > 0;
    if (wasResume) state.visits = (state.visits || 1) + 1;
    persist();
  } else {
    state = defaultState(caseId);
    persist();
  }
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

// Register V2-S1.2 mutation handler(s). Only `add_to_case` in S1.2 as proof
// of the vertical pipe. Other 11 actions from §2.2 wire up in later S-sessions.
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

  unregisterActionHandlers = () => {
    for (const off of offs) off();
  };
  return unregisterActionHandlers;
}
