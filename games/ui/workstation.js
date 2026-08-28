// ui/workstation.js
// Case Zero — WORKSTATION shell. Wires welcome → sidebar → tool panes → evidence.
//
// V2-S2.2 additions:
//   - Sidebar order per §18.7: FRAME → TRACE → ARCHIVE → CHAT → ATLAS.
//   - HAS UPDATES dot on sidebar rows (derived from viewed + evidence tools).
//   - Topbar breadcrumb (tool-level; artifact-level = deferred).
//   - Notification stack (max 3, no error styling, gate-ready variant).
//   - A3 commit animation rewired to `evidence_added` state event
//     (CR-4: no click-driven anim; button located via data-artifact-id).

import { initState, subscribe, setActiveTool, getState, hasSavedState, resetAll, isToolAvailable, configureActionBus, registerActionHandlers, setActionResumeMode, announceWorkstationStarted, hasCinematicFired, markCinematicFired, clearSplitView } from '../engine/state.js';
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
import { initSoundBus, isMuted, toggleMuted } from '../engine/sound.js';   // S7.4
import { initCinematicScheduler } from '../engine/cinematic.js';           // S7.5

// Sidebar tool labels are ORIGINAL names (PRD §14) — never localized.
// Only their LOCKED / COMING-SOON status text is localized.
// §18.7 order: FRAME (what) → TRACE (who else) → ARCHIVE (when) →
// CHAT (where else) → ATLAS (verify).
const TOOLS = [
  { id: 'frame',    label: 'FRAME',    group: 'sources' },
  { id: 'trace',    label: 'TRACE',    group: 'sources' },
  { id: 'archive',  label: 'ARCHIVE',  group: 'sources' },
  { id: 'chat',     label: 'CHAT',     group: 'sources' },
  { id: 'atlas',    label: 'ATLAS',    group: 'sources' },
  { id: 'evidence', label: 'EVIDENCE', group: 'case'    },
  { id: 'report',   label: 'REPORT',   group: 'case'    },
  { id: 'analyst',  label: 'ANALYST',  group: 'case'    },
  { id: 'notes',    label: 'NOTES',    group: 'case'    },
];

const IMPLEMENTED = new Set(['frame', 'trace', 'archive', 'chat', 'atlas', 'evidence', 'report', 'analyst']);

let caseData = null;
let prevAvailability = new Set();

// Notification stack — max 3 visible, FIFO removal, per §7.2. No error/warning
// variants. Two variants: default (1500ms neutral) and gate-ready (3000ms gold).
const NOTIF_MAX = 3;
const NOTIF_HOLD_DEFAULT = 1500;
const NOTIF_HOLD_GATE = 3000;

// Reduced-motion honors §8.3 + S2_ACCEPTANCE §11.6: collapse animations to
// instant state changes. Read once at boot — the OS-level toggle changing
// mid-session is a rare enough case that we accept a reload for it.
const REDUCED_MOTION = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Timer tick — singleton owned by boot(). Ticks every 1000ms once
// workstation is playing; renders session · MM:SS (across N visits).
let timerHandle = null;

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

// Derived: does this tool have unopened artifacts? Dot iff tool is available,
// has any artifacts in caseData, and none of them are in state.viewed yet.
// Result feeds the sidebar HAS UPDATES dot per §3.2. Pure derivation — no
// separate persistence needed.
function toolHasUpdates(toolId) {
  if (!isToolAvailable(toolId, caseData)) return false;
  const viewed = getState().viewed || [];
  const arts = caseData?.artifacts || {};
  let toolArts = 0;
  for (const id of Object.keys(arts)) {
    const a = arts[id];
    if (!a || a.tool !== toolId) continue;
    toolArts++;
    if (viewed.includes(id)) return false;  // any viewed → no dot
  }
  return toolArts > 0;
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
    const hasDot = isAvail && toolHasUpdates(tool.id);
    const btn = document.createElement('button');
    btn.className = 'tool-btn'
      + (isAvail ? '' : ' is-locked')
      + (state.activeTool === tool.id ? ' is-active' : '')
      + (hasDot ? ' has-updates' : '');
    btn.dataset.tool = tool.id;
    const label = t('sidebar.tool.' + tool.id) || tool.label;
    btn.innerHTML = `
      <span>${label}</span>
      ${isAvail
        ? `<span class="tool-btn__badge" data-badge="${tool.id}"></span>`
        : `<span class="tool-btn__lock">${t('sidebar.status.locked')}</span>`}
      ${hasDot ? '<span class="tool-btn__dot" aria-hidden="true"></span>' : ''}
    `;
    if (isAvail) {
      btn.addEventListener('click', () => {
        // Split is a moment, not a mode — switching tools closes it. Q2.
        if (firstSplitEntry()) clearSplitView(null);
        setActiveTool(tool.id);
      });
    } else {
      btn.title = t('sidebar.title.locked');
    }
    (tool.group === 'sources' ? sourcesEl : caseEl).appendChild(btn);
  });

  prevAvailability = avail;
  updateBadges();
}

function firstSplitEntry() {
  const sv = getState().splitView || {};
  const keys = Object.keys(sv);
  if (keys.length === 0) return null;
  const tool = keys[0];
  const pair = sv[tool];
  if (!pair || !pair.a || !pair.b) return null;
  return { tool, a: pair.a, b: pair.b };
}

function renderPane() {
  const state = getState();
  const active = state.activeTool;

  $$('.tool-btn').forEach(b => b.classList.toggle('is-active', b.dataset.tool === active));

  const wsMain = $('.ws-main');
  const split = firstSplitEntry();

  if (split) {
    $$('.pane').forEach(p => p.classList.remove('is-active'));
    wsMain?.classList.add('is-split');
    renderSplit(wsMain, split);
    return;
  }
  // No split → tear down the split host if present.
  wsMain?.classList.remove('is-split');
  const existing = wsMain?.querySelector('.split-view');
  if (existing) existing.remove();

  $$('.pane').forEach(p => p.classList.toggle('is-active', p.dataset.pane === active));

  const paneEl = $(`.pane[data-pane="${active}"]`);
  if (!paneEl) return;

  const tool = TOOLS.find(t => t.id === active);
  const isAvail = isToolAvailable(active, caseData);
  if (!isAvail || !IMPLEMENTED.has(active)) {
    renderLocked(paneEl, tool, isAvail);
    return;
  }

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

// SAME FRAME sameness derivation — spec §7. Two artifacts count as "same
// frame" when they point to the same underlying image asset. Case Zero
// currently exercises this via daniel-cole-portrait.jpg being both
// avatars (posts[0].cover paths diverge between .jpg and .svg placeholders).
// Match on either channel to survive both current data and future when
// post covers align.
function sameFrame(a, b) {
  if (!a || !b) return false;
  const aPost = a.posts?.[0]?.cover;
  const bPost = b.posts?.[0]?.cover;
  if (aPost && bPost && aPost === bPost) return true;
  if (a.avatar && b.avatar && a.avatar === b.avatar) return true;
  return false;
}

function renderSplit(wsMain, split) {
  if (!wsMain) return;
  const a = caseData.artifacts[split.a];
  const b = caseData.artifacts[split.b];
  if (!a || !b) {
    // Stale split reference — drop it and re-render normally.
    clearSplitView(split.tool);
    return;
  }

  let host = wsMain.querySelector('.split-view');
  if (!host) {
    host = document.createElement('div');
    host.className = 'split-view';
    wsMain.appendChild(host);
  }

  const showCaption = sameFrame(a, b);
  const labelLeft  = String(split.tool || '').toUpperCase();
  const labelRight = String(a.tool && b.tool && a.tool !== b.tool ? b.tool : (a.tool || b.tool || '')).toUpperCase();
  const bannerLabel = labelRight && labelLeft !== labelRight
    ? `SPLIT · ${labelLeft} ↔ ${labelRight}`
    : `SPLIT · ${labelLeft}`;

  host.innerHTML = `
    <div class="split-view__appbar">
      <div class="split-view__label">${bannerLabel}</div>
      <button type="button" class="split-view__close" data-action="split-close" aria-label="${t('split.close_aria')}">
        <span aria-hidden="true">×</span> <span class="split-view__close-label">${t('split.close')}</span>
      </button>
    </div>
    <div class="split-view__panes">
      <div class="split-view__pane" data-split-side="a"></div>
      <div class="split-view__pane" data-split-side="b"></div>
    </div>
    ${showCaption ? `<div class="split-view__caption"><span>${t('split.caption.same_frame')}</span></div>` : ''}
  `;

  const paneA = host.querySelector('[data-split-side="a"]');
  const paneB = host.querySelector('[data-split-side="b"]');
  renderSplitPane(paneA, a);
  renderSplitPane(paneB, b);

  host.querySelector('[data-action="split-close"]').addEventListener('click', () => {
    clearSplitView(split.tool);
  });
}

// Render one artifact into a split pane. FRAME-style artifacts get the
// Instagram-analog document treatment via renderFrameProfile compact mode.
// Any other artifact type falls back to a plain document block for now —
// no other split-eligible pairs exist in Case Zero.
function renderSplitPane(paneEl, artifact) {
  if (!paneEl || !artifact) return;
  if (artifact.type === 'frame_profile') {
    renderFrameProfile(paneEl, caseData, artifact, { compact: true });
    return;
  }
  paneEl.innerHTML = `
    <div class="split-view__fallback">
      <div class="split-view__fallback-label">${(artifact.tool || 'artifact').toUpperCase()}</div>
      <div class="split-view__fallback-id">${String(artifact.id || '')}</div>
    </div>
  `;
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

// Notification stack per §7.2. Adds a new notif at the top; if already at
// NOTIF_MAX visible, drop the oldest (FIFO). Each notif auto-removes after
// its own hold duration. Neutral visual by default; `variant: 'gate-ready'`
// paints the gold-left accent for submit-gate-ready.
function showNotification(text, { variant, hold } = {}) {
  if (!text) return;
  const stack = $('.notif-stack');
  if (!stack) return;

  const holdMs = hold != null ? hold : (variant === 'gate-ready' ? NOTIF_HOLD_GATE : NOTIF_HOLD_DEFAULT);

  const el = document.createElement('div');
  el.className = 'notif' + (variant ? ` notif--${variant}` : '');
  el.textContent = text;

  stack.appendChild(el);
  // FIFO drop: if we now exceed the cap, remove the oldest immediately.
  while (stack.children.length > NOTIF_MAX) {
    stack.firstElementChild?.remove();
  }
  // Trigger the enter transition next frame so opacity/transform animate.
  requestAnimationFrame(() => el.classList.add('is-visible'));

  setTimeout(() => {
    el.classList.remove('is-visible');
    // Give the leave transition a moment before removal from DOM.
    setTimeout(() => el.remove(), 220);
  }, holdMs);
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

let prevTopbarLinks = 0;
function updateTopbar() {
  const state = getState();
  const meta = $('.ws-topbar__meta');
  if (!meta) return;
  const n = state.evidence.length;
  const linksN = (state.links || []).length;
  // Render EVIDENCE first, then LINKS (only when at least one exists so cold
  // boot stays quiet). Space glyph separates the two counters per V2 §7.1.
  const evText = t('topbar.evidence', { n });
  const linksText = linksN > 0 ? ' · ' + t('topbar.links', { n: linksN }) : '';
  meta.textContent = evText + linksText;
  const evidenceGrew = n !== prevTopbarCount && n > 0;
  const linksGrew = linksN !== prevTopbarLinks && linksN > 0;
  if (evidenceGrew || linksGrew) pulseElement(meta, 'is-changing', 520);
  prevTopbarCount = n;
  prevTopbarLinks = linksN;
}

// Breadcrumb — tool-level in S2.2. Level-2 (artifact-level) reserved for a
// later session per §3.1. Cleared before workstation is playing so the
// welcome screen stays clean.
function updateBreadcrumb() {
  const el = $('.ws-topbar__breadcrumb');
  if (!el) return;
  const split = firstSplitEntry();
  if (split) {
    // Mirror the split app-bar label at the topbar level (§4).
    const primary = caseData?.artifacts?.[split.a];
    const secondary = caseData?.artifacts?.[split.b];
    const left = (primary?.tool || split.tool || '').toUpperCase();
    const right = (secondary?.tool || '').toUpperCase();
    el.textContent = right && left !== right ? `SPLIT · ${left} ↔ ${right}` : `SPLIT · ${left}`;
    return;
  }
  const active = getState().activeTool;
  const tool = TOOLS.find(x => x.id === active);
  el.textContent = tool ? (t('sidebar.tool.' + tool.id) || tool.label) : '';
}

// Session timer — investigation diary, not real-time between visits.
// Formula (§4): elapsedMsFromPriorVisits + (Date.now() - startedAt).
// No animation, no color transitions, no digit-flip effects (§4).
function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${String(mm).padStart(2, '0')}:${ss}`;
}
function updateTimer() {
  const el = $('.ws-topbar__timer');
  if (!el) return;
  const s = getState();
  const now = Date.now();
  const active = Math.max(0, now - (Number(s.startedAt) || now));
  const total = (Number(s.elapsedMsFromPriorVisits) || 0) + active;
  const suffix = (s.visits && s.visits > 1) ? ` (${t('timer.across', { n: s.visits })})` : '';
  el.textContent = `${t('timer.prefix')} · ${fmtDuration(total)}${suffix}`;
}
function startTimerTick() {
  if (timerHandle) return;
  updateTimer();
  timerHandle = setInterval(updateTimer, 1000);
}

// -------- Cinematic beats (S2.3, per S2_ACCEPTANCE §7) --------
// B1, B2, B4 only. Full scheduler and B3/B5-B12 belong to S7.

// Typewriter — types text char-by-char at cps chars/sec. Skips typing when
// reduced-motion is on (renders full text immediately).
function typewriter(el, text, cps = 40) {
  return new Promise(resolve => {
    if (REDUCED_MOTION || !text) { el.textContent = text || ''; resolve(); return; }
    el.textContent = '';
    let i = 0;
    const stepMs = Math.max(15, Math.round(1000 / cps));
    const step = () => {
      if (i >= text.length) { resolve(); return; }
      el.textContent += text[i++];
      setTimeout(step, stepMs);
    };
    step();
  });
}

// B1 — client-brief typewriter on first 3 "lines" (eyebrow, title, first
// line of sub). Fires on case_opened only. On case_resumed or if B1 already
// in firedOnce, the welcome renders statically via applyStaticI18n.
async function playB1() {
  if (hasCinematicFired('B1')) return;
  const eyebrow = $('.welcome__eyebrow');
  const title = $('.welcome__title');
  const sub = $('.welcome__sub');
  if (!eyebrow || !title || !sub) return;
  const eyebrowText = t('welcome.eyebrow');
  const titleText = t('welcome.title');
  const subText = t('welcome.sub');
  const subLines = subText.split('\n');
  const subFirst = subLines[0];
  const subRest = subLines.slice(1).join('\n');

  eyebrow.textContent = '';
  title.textContent = '';
  sub.textContent = '';
  document.querySelector('.game-root')?.classList.add('b1-active');
  // Cadence normalized to ~38 cps across all three lines (S2_ACCEPTANCE §7
  // CR-1: one cinematic voice, not three mechanisms). Reduced-motion path
  // in typewriter() still renders instantly.
  await typewriter(eyebrow, eyebrowText, 38);
  await typewriter(title, titleText, 38);
  await typewriter(sub, subFirst, 38);
  if (subRest) sub.innerHTML = escapeHtml(subFirst) + '<br>' + escapeHtml(subRest);
  document.querySelector('.game-root')?.classList.remove('b1-active');
  markCinematicFired('B1');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// B2 — sidebar tools fade-in staggered 40ms each. Uses a CSS class +
// per-btn animation-delay set from JS. Reduced-motion: skip (class not
// applied, tools appear instantly via their normal render).
function playB2() {
  if (hasCinematicFired('B2') || REDUCED_MOTION) { markCinematicFired('B2'); return; }
  const btns = $$('.ws-sidebar .tool-btn');
  btns.forEach((btn, i) => {
    btn.classList.add('is-arriving');
    btn.style.setProperty('--b2-delay', `${i * 40}ms`);
    setTimeout(() => {
      btn.classList.remove('is-arriving');
      btn.style.removeProperty('--b2-delay');
    }, 40 * btns.length + 260);
  });
  markCinematicFired('B2');
}

// B4 — first-ever add_to_case. Sidebar unlock pulse is already fired by
// onEvidenceAdded via `.is-just-unlocked`. B4 adds a drawer-close-style
// reaction on the source card (the tool card whose ADD button was
// clicked) — a subtle fade+shrink to hint the artifact is now in evidence.
function playB4(sourceId) {
  if (hasCinematicFired('B4')) return;
  const btn = document.querySelector(`[data-action="add-to-case"][data-artifact-id="${sourceId}"]`);
  const card = btn && (btn.closest('.frame-profile, .trace-candidate, .archive-snapshot, .chat-profile, .atlas-claim') || btn.parentElement);
  if (card && !REDUCED_MOTION) {
    pulseElement(card, 'b4-drawer', 380);
  }
  markCinematicFired('B4');
}

function startWorkstation() {
  const root = document.querySelector('.game-root');
  // Idempotency guard (S2_ACCEPTANCE §11.5): double-click on Play must not
  // re-fire the lifecycle event or re-render the whole workstation.
  if (root.classList.contains('is-playing')) return;
  root.classList.add('is-playing');
  const s = getState();
  announceWorkstationStarted({
    fromResume: Array.isArray(s.evidence) && s.evidence.length > 0,
  });
  // renderPane FIRST — activating the default tool fires open_artifact,
  // which grows state.viewed. Sidebar rendered AFTER sees the correct
  // dot state (no flash on FRAME's row from the auto-opened profile).
  renderPane();
  renderSidebar();
  updateTopbar();
  updateBreadcrumb();
  startTimerTick();
  // B2 fires after workstation is visible so the stagger targets the
  // freshly-rendered tool buttons. `workstation_started` state event
  // subscribers can react in parallel; B2 itself is idempotent.
  playB2();
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

// Brand Intro (12.5s). Plays EVERY time player clicks Play — skip button
// (or Escape) available at any moment. Timing mirrors intro_prototype.html.
const INTRO_TOTAL_MS = 12500;

function startIntroSmoke(canvas) {
  const ctx = canvas.getContext('2d');
  let W, H, rafId, killed = false;
  const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
  resize();
  const onResize = () => resize();
  window.addEventListener('resize', onResize);
  // Cool neutral charcoal palette (hue 210-225, saturation near-zero).
  // Panther emblem dominates; smoke is atmospheric, not chromatic.
  const mkCloud = () => {
    const side = Math.random() < 0.5 ? -1 : 1;
    return { x: W*0.5 + (Math.random()-0.5)*W*0.9, y: H + 60 + Math.random()*120,
      r: 140 + Math.random()*220, a: 0.04 + Math.random()*0.07,
      vy: -(0.18 + Math.random()*0.28), vx: side*(Math.random()*0.18),
      ph: Math.random()*Math.PI*2, hue: 210 + Math.random()*15,
      life: 0, maxL: 600 + Math.random()*500 };
  };
  const mkStrand = () => ({ x: W*0.5 + (Math.random()-0.5)*W*0.85, y: H + 20 + Math.random()*60,
    r: 18 + Math.random()*38, a: 0.06 + Math.random()*0.1,
    vy: -(0.4 + Math.random()*0.7), vx: (Math.random()-0.5)*0.35,
    ph: Math.random()*Math.PI*2, hue: 210 + Math.random()*15,
    life: 0, maxL: 250 + Math.random()*300 });
  const clouds = Array.from({length: 22}, () => { const c = mkCloud(); c.y = H - Math.random()*H; c.life = Math.random()*c.maxL; return c; });
  const strands = Array.from({length: 60}, () => { const s = mkStrand(); s.y = H - Math.random()*H; s.life = Math.random()*s.maxL; return s; });
  const bgBlobs = Array.from({length: 6}, () => ({
    x: Math.random()*W, y: H*0.5 + Math.random()*H*0.6,
    r: 300 + Math.random()*350, a: 0.022 + Math.random()*0.03,
    vx: (Math.random()-.5)*0.08, vy: -(0.03 + Math.random()*0.05),
    ph: Math.random()*Math.PI*2, hue: 210 + Math.random()*15,
  }));
  function loop(ts) {
    if (killed) return;
    ctx.clearRect(0, 0, W, H);
    // Cool carbon-black gradient (near-neutral, slight cold tint).
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#050508'); bg.addColorStop(0.5, '#030305'); bg.addColorStop(1, '#080809');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    bgBlobs.forEach(b => {
      b.x += b.vx + Math.sin(ts*0.00018 + b.ph)*0.3; b.y += b.vy;
      if (b.y < -b.r) { b.y = H + b.r; b.x = Math.random()*W; }
      const g = ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,b.r);
      // Saturation lowered from 60%/50% → 6%/4% (near-monochrome charcoal).
      g.addColorStop(0, `hsla(${b.hue},6%,10%,${b.a})`);
      g.addColorStop(0.6, `hsla(${b.hue},4%,6%,${b.a*0.5})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill();
    });
    clouds.forEach(c => {
      c.life++; if (c.life > c.maxL || c.y < -c.r*2) { Object.assign(c, mkCloud()); return; }
      c.x += c.vx + Math.sin(ts*0.00022 + c.ph)*0.4; c.y += c.vy;
      const fade = c.life < 80 ? c.life/80 : c.life > c.maxL-120 ? (c.maxL-c.life)/120 : 1;
      const g = ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,c.r);
      // Saturation 40%/35% → 5%/4% (grey charcoal smoke).
      g.addColorStop(0, `hsla(${c.hue},5%,18%,${c.a*fade})`);
      g.addColorStop(0.5, `hsla(${c.hue},4%,12%,${c.a*fade*0.55})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x,c.y,c.r,0,Math.PI*2); ctx.fill();
    });
    strands.forEach(s => {
      s.life++; if (s.life > s.maxL || s.y < -s.r*2) { Object.assign(s, mkStrand()); return; }
      s.x += s.vx + Math.sin(ts*0.00038 + s.ph)*0.5; s.y += s.vy;
      const progress = s.life / s.maxL;
      const r = s.r * (1 + progress*1.8);
      const fade = progress < 0.15 ? progress/0.15 : progress > 0.75 ? (1-progress)/0.25 : 1;
      const g = ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,r);
      // Saturation 30%/25% → 5%/4%.
      g.addColorStop(0, `hsla(${s.hue},5%,28%,${s.a*fade})`);
      g.addColorStop(0.5, `hsla(${s.hue},4%,20%,${s.a*fade*0.4})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x,s.y,r,0,Math.PI*2); ctx.fill();
    });
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
  return () => { killed = true; cancelAnimationFrame(rafId); window.removeEventListener('resize', onResize); };
}

function playIntro(onComplete) {
  const intro = $('.brand-intro');
  if (!intro) { onComplete(); return; }
  intro.hidden = false;
  const smoke = intro.querySelector('.brand-intro__smoke');
  const panther = intro.querySelector('.brand-intro__panther');
  const t1 = intro.querySelector('[data-intro-text="1"]');
  const t2 = intro.querySelector('[data-intro-text="2"]');
  const t3 = intro.querySelector('[data-intro-text="3"]');
  const motto = intro.querySelector('[data-intro-text="4"]');
  const audio = intro.querySelector('.brand-intro__audio');
  const skipBtn = intro.querySelector('[data-action="intro-skip"]');
  const stopSmoke = startIntroSmoke(smoke);
  const timers = [];
  timers.push(setTimeout(() => { panther.classList.add('is-revealed'); try { audio.play().catch(()=>{}); } catch {} }, 2000));
  timers.push(setTimeout(() => t1.classList.add('is-visible'), 4500));
  timers.push(setTimeout(() => t1.classList.remove('is-visible'), 6300));
  timers.push(setTimeout(() => t2.classList.add('is-visible'), 6500));
  timers.push(setTimeout(() => t2.classList.remove('is-visible'), 8300));
  timers.push(setTimeout(() => t3.classList.add('is-visible'), 8500));
  timers.push(setTimeout(() => motto.classList.add('is-visible'), 9500));
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    stopSmoke();
    try { audio.pause(); } catch {}
    intro.hidden = true;
    onComplete();
  }
  timers.push(setTimeout(finish, INTRO_TOTAL_MS));
  skipBtn.addEventListener('click', finish, { once: true });
  // Escape key also skips.
  const onEsc = (e) => { if (e.key === 'Escape') { finish(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);
}

function wireWelcome() {
  const playBtn = $('[data-action="play"]');
  updateWelcome();
  playBtn.addEventListener('click', () => {
    playIntro(startWorkstation);
  });
}

// How-to-play modal: text-only rules explainer, no gameplay hints per case.
function wireHowto() {
  const btn = document.querySelector('[data-action="howto-open"]');
  const modal = document.querySelector('.howto-modal');
  if (!btn || !modal) return;
  const closers = modal.querySelectorAll('[data-action="howto-close"]');
  function open() { modal.hidden = false; }
  function close() { modal.hidden = true; }
  btn.addEventListener('click', open);
  closers.forEach(c => c.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
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
  updateBreadcrumb();
  updateWelcome();
  renderSidebar();
  renderPane();
}

function onEvidenceAdded(evt) {
  updateTopbar();
  // CR-4: pulse the specific ADD button that produced this evidence, using
  // data-artifact-id set at render time by each tool. Downstream of the
  // state event — if the tool has been re-rendered mid-flight and the
  // button is gone, the pulse silently no-ops.
  const sourceId = evt?.evidence?.sourceId;
  if (sourceId) {
    const btn = document.querySelector(`[data-action="add-to-case"][data-artifact-id="${sourceId}"]`);
    if (btn) pulseElement(btn, 'is-committing', 300);
  }
  // B4 — fires on the very first evidence added, only once per case.
  if (sourceId && getState().evidence.length === 1) {
    playB4(sourceId);
  }
  // Detect newly-unlocked implemented tools since the last evidence event.
  const nextAvail = currentAvailability();
  const newlyUnlocked = [];
  for (const id of nextAvail) {
    if (!prevAvailability.has(id) && IMPLEMENTED.has(id)) newlyUnlocked.push(id);
  }
  renderSidebar();  // baseline re-render first — new sidebar buttons exist now
  if (newlyUnlocked.length === 1) {
    const label = TOOLS.find(x => x.id === newlyUnlocked[0])?.label || newlyUnlocked[0];
    showNotification(t('toast.tool_unlocked', { tool: label }));
  } else if (newlyUnlocked.length > 1) {
    const labels = newlyUnlocked
      .map(id => TOOLS.find(x => x.id === id)?.label || id)
      .join(' · ');
    showNotification(t('toast.tools_unlocked', { tools: labels }));
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

  // Boot sequence per ACTION_BUS_CONTRACT §4:
  //   initState → configureActionBus → registerActionHandlers → setActionResumeMode(false) → render
  const { wasResume } = initState(caseData.id);
  configureActionBus({ fromResume: wasResume });
  registerActionHandlers(caseData);
  // S7.4 — sound bus must be initialized AFTER action handlers so it can
  // subscribe cleanly, and BEFORE setActionResumeMode(false) so its
  // fromResume gating sees historical actions correctly.
  initSoundBus(caseData);
  // S7.5 — cinematic scheduler subscribes AFTER sound bus so any sound
  // side-effect fires before beat effect classes are applied (sound is
  // registered event, beat is DOM accent atop it).
  initCinematicScheduler(caseData);
  setActionResumeMode(false);
  prevAvailability = currentAvailability();
  // Sync counter baselines so the first render after a resume does not
  // fire pulse animations for evidence that already existed on disk.
  prevBadgeCount = getState().evidence.length;
  prevTopbarCount = getState().evidence.length;

  // First static-i18n pass (welcome/topbar/sidebar labels).
  applyStaticI18n();

  // B1 — on fresh case (case_opened), play the typewriter over the welcome
  // content. On resume, applyStaticI18n has already rendered the text
  // statically; nothing more to do. Timing note: fire immediately after
  // static i18n so the DOM elements exist; skip if firedOnce already
  // recorded B1 in a prior session save.
  if (!hasCinematicFired('B1')) {
    playB1();
  }

  subscribe(evt => {
    if (evt.type === 'tool_changed') {
      renderPane();
      updateBreadcrumb();
      // B2-8 — when a tool with a search input becomes active, focus that
      // input. renderPane() writes innerHTML synchronously so the input
      // exists by this line — no rAF (rAF is throttled in hidden tabs).
      // Guard only when focus is already INSIDE the newly-active pane on a
      // form field — otherwise the previous tool's hidden input can be
      // document.activeElement (Chrome doesn't blur on display:none) and
      // block us from ever focusing anything again.
      const pane = document.querySelector('.pane.is-active');
      const searchInput = pane && pane.querySelector('input[name="q"]');
      if (searchInput) {
        const active = document.activeElement;
        const alreadyInActivePaneField = active && pane.contains(active) &&
          (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
        if (!alreadyInActivePaneField) {
          try { searchInput.focus({ preventScroll: true }); } catch {}
        }
      }
    }
    if (evt.type === 'evidence_added') {
      // Acknowledge the action the player took.
      if (evt.evidence) {
        showNotification(t('toast.evidence_saved', { id: evt.evidence.evidenceId }));
      }
      // Then: any consequences (commit-pulse, unlocks, sidebar re-render).
      onEvidenceAdded(evt);
    }
    if (evt.type === 'viewed_added') {
      // A newly-viewed artifact may clear a HAS UPDATES dot on its tool row.
      renderSidebar();
    }
    if (evt.type === 'submission_updated') {
      renderSidebar();  // ANALYST may have just unlocked
      if (getState().activeTool === 'report') renderPane();
    }
    if (evt.type === 'report_all_required_met') {
      showNotification(t('notif.gate_ready'), { variant: 'gate-ready' });
    }
    if (evt.type === 'split_view_changed') {
      renderPane();
      updateBreadcrumb();
    }
    // S4: link add/remove and pick updates re-render EVIDENCE and REPORT.
    if (evt.type === 'link_added' || evt.type === 'link_removed' || evt.type === 'pick_updated') {
      const a = getState().activeTool;
      if (a === 'evidence' || a === 'report') renderPane();
    }
    // B2-4 — topbar LINKS N counter reacts to link add/remove.
    if (evt.type === 'link_added' || evt.type === 'link_removed') {
      updateTopbar();
    }
    if (evt.type === 'reset') {
      prevBadgeCount = 0;
      prevTopbarCount = 0;
      prevTopbarLinks = 0;
      renderSidebar();
      updateTopbar();
      updateBreadcrumb();
    }
  });

  subscribeLang(onLangChange);

  // Q3 — ESC dismisses split. Attach once at boot; a no-op when no split.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && firstSplitEntry()) {
      e.preventDefault();
      clearSplitView(null);
    }
  });

  renderSidebar();
  wireWelcome();
  wireReset();
  wireHowto();

  // S7.4 — mute toggle in topbar. Text-only per anti-drift §19.
  const muteBtn = document.querySelector('.ws-topbar__mute');
  if (muteBtn) {
    const syncMuteBtn = () => {
      const m = isMuted();
      muteBtn.textContent = m ? 'SOUND OFF' : 'SOUND ON';
      muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
    };
    syncMuteBtn();
    muteBtn.addEventListener('click', () => {
      toggleMuted();
      syncMuteBtn();
    });
  }
  wireLangSwitch();
}

boot();
