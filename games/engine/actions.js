// engine/actions.js
// V2-S1.1 — Player-intent event bus.
//
// Тупий infrastructure layer per ACTION_BUS_CONTRACT.md §4 (CR-3).
// НЕ імпортує state.js. Envelope-контекст ставиться при boot через configure().
// НЕ мутує state. Мутації — робота state.js mutation handlers, які тут просто
// підписуються через on(...).
//
// Consumers (sound, cinematic, timeline, analytics) підписуються тут же і
// отримують fanout у hardcoded порядку реєстрації.
//
// Валідація payload — inline, soft-warn (§9.6): invalid → console.warn → drop.
// Handler exception — console.error → next handler continues (§9.6).

// -------- Runtime context (§4 CR-3) --------
// Ставиться configure() при boot; envelope читає звідси, не імпортує state.js.

let ctx = {
  configured: false,
  caseId: null,
  fromResume: false,
  seq: 0,
};

export function configure({ caseId, fromResume = false, initialSeq = 0 } = {}) {
  if (!caseId) {
    console.warn('[actions] configure: caseId required, ignoring');
    return;
  }
  ctx = {
    configured: true,
    caseId: String(caseId),
    fromResume: !!fromResume,
    seq: Number.isFinite(initialSeq) ? initialSeq : 0,
  };
}

export function setResumeMode(flag) {
  ctx.fromResume = !!flag;
}

export function getSeq() {
  return ctx.seq;
}

export function isConfigured() {
  return ctx.configured;
}

// -------- Listener registry --------

const listeners = new Map();  // type → Array<handler>
const wildcardListeners = [];

export function on(type, handler) {
  if (typeof type !== 'string' || !type) {
    console.warn('[actions] on: type required');
    return () => {};
  }
  if (typeof handler !== 'function') {
    console.warn('[actions] on: handler must be function');
    return () => {};
  }
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(handler);
  return () => {
    const arr = listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(handler);
    if (i >= 0) arr.splice(i, 1);
  };
}

export function onAny(handler) {
  if (typeof handler !== 'function') {
    console.warn('[actions] onAny: handler must be function');
    return () => {};
  }
  wildcardListeners.push(handler);
  return () => {
    const i = wildcardListeners.indexOf(handler);
    if (i >= 0) wildcardListeners.splice(i, 1);
  };
}

// Test-only helper — clears every listener AND resets ctx.
export function offAll() {
  listeners.clear();
  wildcardListeners.length = 0;
  ctx = { configured: false, caseId: null, fromResume: false, seq: 0 };
}

// -------- Payload validation (§2.2 catalog) --------
// Inline check per action type. Returns error string on failure, null on OK.
// Missing type → 'unknown_action'. Presence of unexpected keys is allowed
// (forward-compatible); only shape of KNOWN keys is checked.

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isBool = (v) => typeof v === 'boolean';
const isArrOf = (v, pred) => Array.isArray(v) && v.every(pred);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

const VALIDATORS = {
  open_artifact: (p) => {
    if (!isStr(p.artifactId)) return 'artifactId: string required';
    if (!isStr(p.tool)) return 'tool: string required';
    return null;
  },
  copy_handle: (p) => {
    if (!isStr(p.value)) return 'value: string required';
    if (p.source != null && !isObj(p.source)) return 'source: object or omitted';
    return null;
  },
  paste_into: (p) => {
    if (!isStr(p.tool)) return 'tool: string required';
    if (!isStr(p.field)) return 'field: string required';
    if (typeof p.value !== 'string') return 'value: string required';
    if (!isBool(p.fromClipboard)) return 'fromClipboard: boolean required';
    return null;
  },
  search: (p) => {
    if (!isStr(p.tool)) return 'tool: string required';
    if (typeof p.query !== 'string') return 'query: string required';
    if (!isNum(p.resultCount) || p.resultCount < 0) return 'resultCount: non-negative number';
    return null;
  },
  split_view: (p) => {
    if (!isStr(p.tool)) return 'tool: string required';
    if (!isStr(p.primaryId)) return 'primaryId: string required';
    if (!isStr(p.secondaryId)) return 'secondaryId: string required';
    return null;
  },
  compare_dates: (p) => {
    if (!isStr(p.aId) || !isStr(p.bId)) return 'aId/bId: string required';
    if (!isStr(p.aDate) || !isStr(p.bDate)) return 'aDate/bDate: ISO string required';
    return null;
  },
  extract_frame: (p) => {
    if (!isStr(p.videoId)) return 'videoId: string required';
    // DEV MODE (VIDEO_EVIDENCE_SPEC §11): placeholder still has no timeline,
    // so `timestamp: null` is a valid signal. Real video → non-negative number.
    if (p.timestamp != null && (!isNum(p.timestamp) || p.timestamp < 0)) {
      return 'timestamp: non-negative number or null (DEV MODE)';
    }
    if (!isStr(p.capturedArtifactId)) return 'capturedArtifactId: string required';
    return null;
  },
  mark_moment: (p) => {
    if (!isStr(p.videoId)) return 'videoId: string required';
    if (!isNum(p.timestamp) || p.timestamp < 0) return 'timestamp: non-negative number';
    if (p.label != null && typeof p.label !== 'string') return 'label: string or omitted';
    return null;
  },
  add_to_case: (p) => {
    if (!isStr(p.artifactId)) return 'artifactId: string required';
    if (!isStr(p.tool)) return 'tool: string required';
    return null;
  },
  link_evidence: (p) => {
    if (!isStr(p.fromId)) return 'fromId: string required';
    if (!isStr(p.toId)) return 'toId: string required';
    if (p.fromId === p.toId) return 'fromId and toId must differ';
    // Q1 dismissal: `{fromId, toId, remove: true}` — no reason required.
    if (p.remove === true) return null;
    if (!isStr(p.reason)) return 'reason: string required (controlled value per §18.10)';
    return null;
  },
  pick_evidence_for_criterion: (p) => {
    if (!isStr(p.criterionId)) return 'criterionId: string required';
    if (!isStr(p.evidenceId)) return 'evidenceId: string required';
    if (p.prevEvidenceId != null && typeof p.prevEvidenceId !== 'string') {
      return 'prevEvidenceId: string or omitted';
    }
    return null;
  },
  submit_report: (p) => {
    // CR-1: NO `outcome` here. Outcome is derived by state handler via
    // evaluateSubmission(). If UI accidentally passes one, ignore silently.
    if (typeof p.attribution !== 'string') return 'attribution: string required';
    if (!isArrOf(p.supportingEvidenceIds, isStr)) {
      return 'supportingEvidenceIds: string[] required';
    }
    return null;
  },
};

function validate(type, payload) {
  const fn = VALIDATORS[type];
  if (!fn) return 'unknown_action';
  if (!isObj(payload)) return 'payload: object required';
  try {
    return fn(payload);
  } catch (err) {
    return 'validator threw: ' + (err && err.message);
  }
}

// -------- Emit --------

export function emit(type, payload) {
  if (!ctx.configured) {
    console.warn('[actions] emit before configure() — dropping', type);
    return null;
  }

  const err = validate(type, payload || {});
  if (err) {
    console.warn(`[actions] invalid payload for "${type}": ${err}`, payload);
    return null;
  }

  const envelope = {
    type,
    payload,
    meta: {
      ts: Date.now(),
      seq: ++ctx.seq,
      caseId: ctx.caseId,
      fromResume: ctx.fromResume,
    },
  };

  // Fanout in registration order. Type-specific first, then wildcard —
  // wildcard consumers (timeline, analytics) see the event AFTER any
  // synchronous type-specific handlers (state mutators) have run, so
  // downstream reads reflect the mutation.
  const typed = listeners.get(type);
  if (typed) {
    for (const h of typed.slice()) {  // slice: allow unsubscribe during dispatch
      try { h(envelope.payload, envelope); }
      catch (e) { console.error(`[actions] handler for "${type}" threw`, e); }
    }
  }
  for (const h of wildcardListeners.slice()) {
    try { h(envelope); }
    catch (e) { console.error('[actions] onAny handler threw', e); }
  }

  return envelope;
}
