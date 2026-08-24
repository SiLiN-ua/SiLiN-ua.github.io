// ui/workstation.js
// Case Zero — WORKSTATION shell. Wires welcome → sidebar → tool panes → evidence.

import { initState, subscribe, setActiveTool, getState, hasSavedState, resetAll, isToolAvailable } from '../engine/state.js';
import { loadCase } from '../engine/case-loader.js';
import { initI18n, t, setLang, getLang, subscribeLang } from '../engine/i18n.js';
import { renderFrameProfile } from '../tools/frame/frame.js';
import { renderTrace } from '../tools/trace/trace.js';
import { renderArchive } from '../tools/archive/archive.js';
import { renderChat } from '../tools/chat/chat.js';
import { renderAtlas } from '../tools/atlas/atlas.js';
import { renderEvidencePane } from './evidence-pane.js';
import { renderReportPane } from './report-pane.js';
import { renderAnalystPane } from './analyst-pane.js';

// Sidebar tool labels are ORIGINAL names (PRD §14) — never localized.
// Only their LOCKED / COMING-SOON status text is localized.
const TOOLS = [
  { id: 'frame',    label: 'FRAME',    group: 'sources' },
  { id: 'trace',    label: 'TRACE',    group: 'sources' },
  { id: 'chat',     label: 'CHAT',     group: 'sources' },
  { id: 'atlas',    label: 'ATLAS',    group: 'sources' },
  { id: 'archive',  label: 'ARCHIVE',  group: 'sources' },
  { id: 'evidence', label: 'EVIDENCE', group: 'case'    },
  { id: 'report',   label: 'REPORT',   group: 'case'    },
  { id: 'analyst',  label: 'ANALYST',  group: 'case'    },
  { id: 'notes',    label: 'NOTES',    group: 'case'    },
];

const IMPLEMENTED = new Set(['frame', 'trace', 'archive', 'chat', 'atlas', 'evidence', 'report', 'analyst']);

let caseData = null;
let prevAvailability = new Set();

// Toast queue — showing one message at a time. Previously two same-click
// events (evidence saved + tool unlocked) collided in the same DOM slot and
// the second stomped the first mid-animation.
const TOAST_HOLD_MS = 1800;
const TOAST_GAP_MS = 220;
const toastQueue = [];
let toastPlaying = false;

// Track previous counter values so we can flash on change.
let prevBadgeCount = 0;
let prevTopbarCount = 0;

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function currentAvailability() {
  const avail = new Set();
  for (const tool of TOOLS) {
    if (isToolAvailable(tool.id, caseData)) avail.add(tool.id);
  }
  return avail;
}

// Fill any [data-i18n] element in static markup. Optional data-i18n-html
// switches innerHTML (used only where markup like <br> is intentional).
function applyStaticI18n() {
  $$('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const value = t(key);
    if (el.hasAttribute('data-i18n-html')) {
      el.innerHTML = value.replace(/\n/g, '<br>');
    } else {
      el.textContent = value;
    }
  });
}

function renderSidebar() {
  const sourcesEl = $('[data-sidebar-group="sources"]');
  const caseEl = $('[data-sidebar-group="case"]');
  sourcesEl.innerHTML = '';
  caseEl.innerHTML = '';

  const state = getState();
  const avail = currentAvailability();

  TOOLS.forEach(tool => {
    const isAvail = avail.has(tool.id);
    const btn = document.createElement('button');
    btn.className = 'tool-btn'
      + (isAvail ? '' : ' is-locked')
      + (state.activeTool === tool.id ? ' is-active' : '');
    btn.dataset.tool = tool.id;
    btn.innerHTML = `
      <span>${tool.label}</span>
      ${isAvail
        ? `<span class="tool-btn__badge" data-badge="${tool.id}"></span>`
        : `<span class="tool-btn__lock">${t('sidebar.status.locked')}</span>`}
    `;
    if (isAvail) {
      btn.addEventListener('click', () => setActiveTool(tool.id));
    } else {
      btn.title = t('sidebar.title.locked');
    }
    (tool.group === 'sources' ? sourcesEl : caseEl).appendChild(btn);
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

  // Tools no longer show the "EVIDENCE SAVED" toast themselves — that fires
  // from the subscribe('evidence_added') handler below, in strict order:
  // (1) evidence-saved toast → (2) any newly-unlocked-tool toast.
  const ctx = {};

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
  } else if (active === 'analyst') {
    renderAnalystPane(paneEl, caseData);
  }
}

function renderLocked(paneEl, tool, isAvail) {
  const titleKey = isAvail ? 'lockedpane.title.coming_soon' : 'lockedpane.title.not_available';
  const noteKey  = isAvail ? 'lockedpane.note.coming_soon'  : 'lockedpane.note.not_available';
  paneEl.innerHTML = `
    <div class="locked-pane">
      <div class="locked-pane__tag">${tool.label}</div>
      <div class="locked-pane__title">${t(titleKey)}</div>
      <div class="locked-pane__note">${t(noteKey)}</div>
    </div>
  `;
}

function updateBadges() {
  const state = getState();
  const badge = $(`[data-badge="evidence"]`);
  if (!badge) return;
  const n = state.evidence.length;
  const changed = n !== prevBadgeCount && n > 0;
  if (n > 0) { badge.textContent = n; badge.classList.add('is-visible'); }
  else { badge.textContent = ''; badge.classList.remove('is-visible'); }
  if (changed) pulseElement(badge, 'is-changing', 450);
  prevBadgeCount = n;
}

// Play the next queued toast, if any. One at a time; each holds for
// TOAST_HOLD_MS visible, then TOAST_GAP_MS gap before the next.
function pumpToastQueue() {
  if (toastPlaying) return;
  const msg = toastQueue.shift();
  if (!msg) return;
  const toast = $('.toast');
  toast.textContent = msg;
  toast.classList.add('is-visible');
  toastPlaying = true;
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => { toastPlaying = false; pumpToastQueue(); }, TOAST_GAP_MS);
  }, TOAST_HOLD_MS);
}

function showToast(msg) {
  if (!msg) return;
  toastQueue.push(msg);
  pumpToastQueue();
}

// Add a temporary class to an element to fire a CSS animation, then remove
// it so the animation can fire again on the next change.
function pulseElement(el, className, ms) {
  if (!el) return;
  el.classList.remove(className);
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;  // force reflow so removing → adding restarts the anim
  el.classList.add(className);
  setTimeout(() => el.classList.remove(className), ms);
}

function updateTopbar() {
  const state = getState();
  const meta = $('.ws-topbar__meta');
  if (!meta) return;
  const n = state.evidence.length;
  meta.textContent = t('topbar.evidence', { n });
  if (n !== prevTopbarCount && n > 0) pulseElement(meta, 'is-changing', 520);
  prevTopbarCount = n;
}

function startWorkstation() {
  document.querySelector('.game-root').classList.add('is-playing');
  renderSidebar();
  renderPane();
  updateTopbar();
}

function updateWelcome() {
  const playBtn = $('[data-action="play"]');
  const resumeLine = $('.welcome__resume');
  const state = getState();
  if (hasSavedState(caseData.id) && state.evidence.length > 0) {
    const n = state.evidence.length;
    const key = n === 1 ? 'welcome.resume.one' : 'welcome.resume.many';
    resumeLine.style.display = 'block';
    resumeLine.innerHTML = t(key, { n: `<b>${n}</b>` });
    playBtn.textContent = t('welcome.cta.continue');
  } else {
    resumeLine.style.display = 'none';
    playBtn.textContent = t('welcome.cta.play');
  }
}

function wireWelcome() {
  const playBtn = $('[data-action="play"]');
  updateWelcome();
  playBtn.addEventListener('click', startWorkstation);
}

function wireReset() {
  $('[data-action="reset"]').addEventListener('click', () => {
    if (!confirm(t('reset.confirm'))) return;
    resetAll();
    location.reload();
  });
}

function wireLangSwitch() {
  const buttons = $$('.lang-switch__btn');
  const sync = () => {
    const lang = getLang();
    buttons.forEach(b => {
      const active = b.dataset.lang === lang;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    document.documentElement.setAttribute('lang', lang);
  };
  buttons.forEach(b => {
    b.addEventListener('click', () => setLang(b.dataset.lang));
  });
  sync();
  subscribeLang(sync);
}

function onLangChange() {
  applyStaticI18n();
  updateTopbar();
  updateWelcome();
  renderSidebar();
  renderPane();
}

function onEvidenceAdded() {
  updateTopbar();
  // Detect newly-unlocked implemented tools since the last evidence event.
  const nextAvail = currentAvailability();
  const newlyUnlocked = [];
  for (const id of nextAvail) {
    if (!prevAvailability.has(id) && IMPLEMENTED.has(id)) newlyUnlocked.push(id);
  }
  renderSidebar();  // baseline re-render first — new sidebar buttons exist now
  // ONE consolidated toast per event, even when several tools unlock at
  // once (candidate_001 opens CHAT + ATLAS + ARCHIVE in the same beat).
  if (newlyUnlocked.length === 1) {
    const label = TOOLS.find(x => x.id === newlyUnlocked[0])?.label || newlyUnlocked[0];
    showToast(t('toast.tool_unlocked', { tool: label }));
  } else if (newlyUnlocked.length > 1) {
    const labels = newlyUnlocked
      .map(id => TOOLS.find(x => x.id === id)?.label || id)
      .join(' · ');
    showToast(t('toast.tools_unlocked', { tools: labels }));
  }
  // Sidebar-side "the workstation grew" — a soft pulse on each newly-open row
  // so a player whose attention is on the main pane still catches it.
  for (const id of newlyUnlocked) {
    const btn = document.querySelector(`.tool-btn[data-tool="${id}"]`);
    if (btn) pulseElement(btn, 'is-just-unlocked', 1500);
  }
  const active = getState().activeTool;
  if (active === 'evidence' || active === 'report') renderPane();
}

async function boot() {
  try {
    await initI18n();
    caseData = await loadCase('case-001');
  } catch (err) {
    document.body.innerHTML = `<pre style="color:#ff5c6c;padding:2rem;font-family:monospace">Failed to load case: ${err.message}\n\nRun via a local server (fetch of file:// is blocked).</pre>`;
    return;
  }

  initState(caseData.id);
  prevAvailability = currentAvailability();
  // Sync counter baselines so the first render after a resume does not
  // fire pulse animations for evidence that already existed on disk.
  prevBadgeCount = getState().evidence.length;
  prevTopbarCount = getState().evidence.length;

  // First static-i18n pass (welcome/topbar/sidebar labels).
  applyStaticI18n();

  subscribe(evt => {
    if (evt.type === 'tool_changed') renderPane();
    if (evt.type === 'evidence_added') {
      // First: acknowledge the action the player took.
      if (evt.evidence) showToast(t('toast.evidence_saved', { id: evt.evidence.evidenceId }));
      // Then: any consequences (unlocks, sidebar re-render).
      onEvidenceAdded();
    }
    if (evt.type === 'submission_updated') {
      renderSidebar();  // ANALYST may have just unlocked
      if (getState().activeTool === 'report') renderPane();
    }
    if (evt.type === 'reset') {
      prevBadgeCount = 0;
      prevTopbarCount = 0;
      renderSidebar();
      updateTopbar();
    }
  });

  subscribeLang(onLangChange);

  renderSidebar();
  wireWelcome();
  wireReset();
  wireLangSwitch();

  // Delegated commit animation on any add-to-case button, no matter
  // which tool rendered it. The button becomes disabled + relabels
  // synchronously in its own handler; the pulse coexists.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-action="add-to-case"]');
    if (btn && !btn.disabled) pulseElement(btn, 'is-committing', 300);
  }, true);
}

boot();
