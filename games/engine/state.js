// engine/state.js
// In-memory investigation state + evidence store.
// Emits change events so UI panes can re-render without direct coupling.

import { loadState, saveState, clearState, migrateLegacyKey } from './save.js';

const listeners = new Set();
let state = null;

function defaultState(caseId) {
  return {
    version: 1,
    caseId,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    evidence: [],       // array of immutable snapshots
    activeTool: 'frame',
  };
}

export function initState(caseId) {
  migrateLegacyKey();
  const persisted = loadState(caseId);
  if (persisted && persisted.caseId === caseId) {
    state = persisted;
  } else {
    state = defaultState(caseId);
    persist();
  }
  return state;
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

export function resetAll() {
  const caseId = state?.caseId || 'case-001';
  clearState(caseId);
  state = defaultState(caseId);
  persist();
  emit({ type: 'reset' });
}
