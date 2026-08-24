// ui/workstation.js
// Case Zero — WORKSTATION shell. Wires welcome → sidebar → tool panes → evidence.

import { initState, subscribe, setActiveTool, getState, hasSavedState, resetAll, isToolAvailable } from '../engine/state.js';
import { loadCase } from '../engine/case-loader.js';
import { renderFrameProfile } from '../tools/frame/frame.js';
import { renderTrace } from '../tools/trace/trace.js';
import { renderArchive } from '../tools/archive/archive.js';
import { renderChat } from '../tools/chat/chat.js';
import { renderAtlas } from '../tools/atlas/atlas.js';
import { renderEvidencePane } from './evidence-pane.js';
import { renderReportPane } from './report-pane.js';

// Lock status is derived per-render from case.json → unlock_rules, NOT hardcoded here.
// A tool with no rule in case.json is always available.
const TOOLS = [
  { id: 'frame',    label: 'FRAME',    group: 'sources' },
  { id: 'trace',    label: 'TRACE',    group: 'sources' },
  { id: 'chat',     label: 'CHAT',     group: 'sources' },
  { id: 'atlas',    label: 'ATLAS',    group: 'sources' },
  { id: 'archive',  label: 'ARCHIVE',  group: 'sources' },
  { id: 'evidence', label: 'EVIDENCE', group: 'case'    },
  { id: 'report',   label: 'REPORT',   group: 'case'    },
  { id: 'notes',    label: 'NOTES',    group: 'case'    },
];

// Tools that have a concrete implementation in Session 2. Anything not in this set
// still shows in the sidebar but renders the "available later" placeholder pane —
// even after unlock — until its Session lands.
const IMPLEMENTED = new Set(['frame', 'trace', 'archive', 'chat', 'atlas', 'evidence', 'report']);

let caseData = null;
let toastTimer = null;
let prevAvailability = new Set();

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function currentAvailability() {
  const avail = new Set();
  for (const t of TOOLS) {
    if (isToolAvailable(t.id, caseData)) avail.add(t.id);
  }
  return avail;
}

function renderSidebar() {
  const sourcesEl = $('[data-sidebar-group="sources"]');
  const caseEl = $('[data-sidebar-group="case"]');
  sourcesEl.innerHTML = '';
  caseEl.innerHTML = '';

  const state = getState();
  const avail = currentAvailability();

  TOOLS.forEach(t => {
    const isAvail = avail.has(t.id);
    const btn = document.createElement('button');
    btn.className = 'tool-btn'
      + (isAvail ? '' : ' is-locked')
      + (state.activeTool === t.id ? ' is-active' : '');
    btn.dataset.tool = t.id;
    btn.innerHTML = `
      <span>${t.label}</span>
      ${isAvail
        ? `<span class="tool-btn__badge" data-badge="${t.id}"></span>`
        : `<span class="tool-btn__lock">LOCKED</span>`}
    `;
    if (isAvail) {
      btn.addEventListener('click', () => setActiveTool(t.id));
    } else {
      btn.title = 'Unlocks as the investigation progresses';
    }
    (t.group === 'sources' ? sourcesEl : caseEl).appendChild(btn);
  });

  prevAvailability = avail;
  updateBadges();
}

function renderPane() {
  const state = getState();
  const active = state.activeTool;

  $$('.tool-btn').forEach(b => b.classList.toggle('is-active', b.dataset.tool === active));
  $$('.pane').forEach(p => p.classList.toggle('is-active', p.dataset.pane === active));

  const paneEl = $(`.pane[data-pane="${active}"]`);
  if (!paneEl) return;

  const tool = TOOLS.find(t => t.id === active);
  const isAvail = isToolAvailable(active, caseData);
  if (!isAvail || !IMPLEMENTED.has(active)) {
    renderLocked(paneEl, tool, isAvail);
    return;
  }

  const ctx = {
    onEvidenceAdded: e => showToast(`EVIDENCE SAVED · ${e.evidenceId}`),
  };

  if (active === 'frame') {
    renderFrameProfile(paneEl, caseData, caseData.artifacts.profile_001, ctx);
  } else if (active === 'trace') {
    renderTrace(paneEl, caseData, ctx);
  } else if (active === 'archive') {
    renderArchive(paneEl, caseData, ctx);
  } else if (active === 'chat') {
    renderChat(paneEl, caseData, ctx);
  } else if (active === 'atlas') {
    renderAtlas(paneEl, caseData, ctx);
  } else if (active === 'evidence') {
    renderEvidencePane(paneEl, caseData);
  } else if (active === 'report') {
    renderReportPane(paneEl, caseData);
  }
}

function renderLocked(paneEl, tool, isAvail) {
  paneEl.innerHTML = `
    <div class="locked-pane">
      <div class="locked-pane__tag">${tool.label}</div>
      <div class="locked-pane__title">${isAvail ? 'Coming soon' : 'Not yet available'}</div>
      <div class="locked-pane__note">
        ${isAvail
          ? 'This tool is unlocked but not implemented in this build.'
          : 'This tool unlocks as the investigation progresses.'}
      </div>
    </div>
  `;
}

function updateBadges() {
  const state = getState();
  const badge = $(`[data-badge="evidence"]`);
  if (!badge) return;
  const n = state.evidence.length;
  if (n > 0) { badge.textContent = n; badge.classList.add('is-visible'); }
  else { badge.textContent = ''; badge.classList.remove('is-visible'); }
}

function showToast(msg) {
  const toast = $('.toast');
  toast.textContent = msg;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1800);
}

function updateTopbar() {
  const state = getState();
  $('.ws-topbar__meta').textContent = `EVIDENCE ${state.evidence.length}`;
}

function startWorkstation() {
  document.querySelector('.game-root').classList.add('is-playing');
  renderSidebar();
  renderPane();
  updateTopbar();
}

function wireWelcome() {
  const playBtn = $('[data-action="play"]');
  const resumeLine = $('.welcome__resume');
  const state = getState();
  if (hasSavedState(caseData.id) && state.evidence.length > 0) {
    const n = state.evidence.length;
    resumeLine.style.display = 'block';
    resumeLine.innerHTML = `Continue investigation · <b>${n}</b> evidence item${n === 1 ? '' : 's'}`;
    playBtn.innerHTML = 'Continue investigation →';
  } else {
    resumeLine.style.display = 'none';
    playBtn.innerHTML = 'Play Case 001 →';
  }
  playBtn.addEventListener('click', startWorkstation);
}

function wireReset() {
  $('[data-action="reset"]').addEventListener('click', () => {
    if (!confirm('Reset investigation? All evidence will be discarded.')) return;
    resetAll();
    location.reload();
  });
}

function onEvidenceAdded() {
  updateTopbar();
  const nextAvail = currentAvailability();
  // Detect a newly-unlocked tool → surface it via toast so the player notices.
  for (const id of nextAvail) {
    if (!prevAvailability.has(id) && IMPLEMENTED.has(id)) {
      const label = TOOLS.find(t => t.id === id)?.label || id;
      showToast(`${label} UNLOCKED`);
    }
  }
  renderSidebar();
  const active = getState().activeTool;
  if (active === 'evidence' || active === 'report') renderPane();
}

async function boot() {
  try {
    caseData = await loadCase('case-001');
  } catch (err) {
    document.body.innerHTML = `<pre style="color:#ff5c6c;padding:2rem;font-family:monospace">Failed to load case: ${err.message}\n\nRun via a local server (fetch of file:// is blocked).</pre>`;
    return;
  }

  initState(caseData.id);
  prevAvailability = currentAvailability();

  subscribe(evt => {
    if (evt.type === 'tool_changed') renderPane();
    if (evt.type === 'evidence_added') onEvidenceAdded();
    if (evt.type === 'submission_updated' && getState().activeTool === 'report') renderPane();
    if (evt.type === 'reset') { renderSidebar(); updateTopbar(); }
  });

  renderSidebar();
  wireWelcome();
  wireReset();
}

boot();
