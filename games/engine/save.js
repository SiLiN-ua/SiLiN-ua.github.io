// engine/save.js
// localStorage-backed save for Case Zero. Session 1 uses localStorage only.
// IndexedDB will be introduced when state outgrows the ~5MB / JSON.stringify boundary.
//
// Storage keys are namespaced per case: `cz.state.v1.<caseId>`. Each case has its own
// independent slot — starting CASE 002 later will not touch CASE 001 progress.

const PREFIX = 'cz.state.v1.';

function key(caseId) {
  if (!caseId) throw new Error('save: caseId is required');
  return PREFIX + caseId;
}

export function loadState(caseId) {
  try {
    const raw = localStorage.getItem(key(caseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    console.warn('[case-zero] load failed', err);
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(key(state.caseId), JSON.stringify(state));
  } catch (err) {
    console.warn('[case-zero] save failed', err);
  }
}

export function clearState(caseId) {
  localStorage.removeItem(key(caseId));
}

// Migration: older Session-1 builds used a single flat key `cz.state.v1`.
// Move it into the case-scoped slot on first boot, then remove the legacy key.
export function migrateLegacyKey() {
  const LEGACY = 'cz.state.v1';
  try {
    const raw = localStorage.getItem(LEGACY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.caseId && !localStorage.getItem(key(parsed.caseId))) {
      localStorage.setItem(key(parsed.caseId), raw);
    }
    localStorage.removeItem(LEGACY);
  } catch { /* ignore malformed legacy data */ }
}
