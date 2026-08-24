// ui/workstation.js
// Case Zero — WORKSTATION shell. Wires welcome → sidebar → tool panes → evidence.

import { initState, subscribe, setActiveTool, getState, hasSavedState, resetAll } from '../engine/state.js';
import { loadCase } from '../engine/case-loader.js';
import { renderFrameProfile } from '../tools/frame/frame.js';
import { renderEvidencePane } from './evidence-pane.js';

const TOOLS = [
  { id: 'frame',    label: 'FRAME',    group: 'sources',  locked: false },
  { id: 'trace',    label: 'TRACE',    group: 'sources',  locked: true },
  { id: 'chat',     label: 'CHAT',     group: 'sources',  locked: true },
  { id: 'atlas',    label: 'ATLAS',    group: 'sources',  locked: true },
  { id: 'archive',  label: 'ARCHIVE',  group: 'sources',  locked: true },
  { id: 'evidence', label: 'EVIDENCE', group: 'case',     locked: false },
  { id: 'notes',    label: 'NOTES',    group: 'case',     locked: true },
];

let caseData = null;
let toastTimer = null;

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function renderSidebar() {
  const sourcesEl = $('[data-sidebar-group="sources"]');
  const caseEl = $('[data-sidebar-group="case"]');
  sourcesEl.innerHTML = '';
  caseEl.innerHTML = '';

  TOOLS.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'tool-btn' + (t.locked ? ' is-locked' : '');
    btn.dataset.tool = t.id;
    btn.innerHTML = `
      <span>${t.label}</span>
      ${t.locked
        ? `<span class="tool-btn__lock">LOCKED</span>`
        : `<span class="tool-btn__badge" data-badge="${t.id}"></span>`}
    `;
    if (!t.locked) {
      btn.addEventListener('click', () => setActiveTool(t.id));
    } else {
      btn.title = 'Available later';
    }
    (t.group === 'sources' ? sourcesEl : caseEl).appendChild(btn);
  });
}

function renderPane() {
  const state = getState();
  const active = state.activeTool;

  $$('.tool-btn').forEach(b => b.classList.toggle('is-active', b.dataset.tool === active));
  $$('.pane').forEach(p => p.classList.toggle('is-active', p.dataset.pane === active));

  const paneEl = $(`.pane[data-pane="${active}"]`);
  if (!paneEl) return;

  const tool = TOOLS.find(t => t.id === active);
  if (tool.locked) {
    renderLocked(paneEl, tool);
    return;
  }
  if (active === 'frame') {
    renderFrameProfile(paneEl, caseData, caseData.artifacts.profile_001, {
      onEvidenceAdded: e => showToast(`EVIDENCE SAVED · ${e.evidenceId}`),
    });
  } else if (active === 'evidence') {
    renderEvidencePane(paneEl, caseData);
  }
}

function renderLocked(paneEl, tool) {
  paneEl.innerHTML = `
    <div class="locked-pane">
      <div class="locked-pane__tag">${tool.label}</div>
      <div class="locked-pane__title">Available later</div>
      <div class="locked-pane__note">This tool unlocks as the investigation progresses.</div>
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
  renderPane();
  updateBadges();
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

async function boot() {
  try {
    caseData = await loadCase('case-001');
  } catch (err) {
    document.body.innerHTML = `<pre style="color:#ff5c6c;padding:2rem;font-family:monospace">Failed to load case: ${err.message}\n\nRun via a local server (fetch of file:// is blocked).</pre>`;
    return;
  }

  initState(caseData.id);

  subscribe(evt => {
    if (evt.type === 'tool_changed') renderPane();
    if (evt.type === 'evidence_added') {
      updateBadges();
      updateTopbar();
      // If evidence pane is open, re-render it to reflect the new item.
      if (getState().activeTool === 'evidence') renderPane();
    }
    if (evt.type === 'reset') { updateBadges(); updateTopbar(); }
  });

  renderSidebar();
  wireWelcome();
  wireReset();
}

boot();
