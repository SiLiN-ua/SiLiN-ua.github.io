// Shadow Simulator — Game Engine + Fake-Tools UI
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getDatabase, ref, set, get } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const NICK_KEY = 'ss.nickname';
const SCORE_KEY = 'ss.local';
const COOLDOWN_KEY = 'ss.cooldown.';    // + caseId

// ==================== UTILITIES ====================
const $ = (sel, root=document) => root.querySelector(sel);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LANG = () => (document.documentElement.lang || 'uk');
const tr = (obj, field) => obj[field + '_' + LANG()] || obj[field + '_uk'] || obj[field] || '';
const fmtTime = (sec) => `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
// Quick bilingual helper: L('укр', 'en')
const L = (uk, en) => LANG() === 'en' ? en : uk;
// Deterministic shuffle using Fisher-Yates + seeded PRNG (mulberry32).
// Same seed → same order across re-renders inside one game session.
function seededShuffle(arr, seed) {
  let a = seed >>> 0;
  const rng = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a>>>15, 1|a); t = t + Math.imul(t ^ t>>>7, 61|t) ^ t; return ((t ^ t>>>14) >>> 0) / 4294967296; };
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ==================== NICKNAME REQUIRED ====================
function getNickname() { return localStorage.getItem(NICK_KEY) || ''; }
function validateNickname(n) { return /^[A-Za-z0-9_.-]{3,16}$/.test(n); }
function saveNickname(n) { localStorage.setItem(NICK_KEY, n); }

// ==================== COOLDOWN ====================
function getCooldownRemaining(caseId) {
  const raw = localStorage.getItem(COOLDOWN_KEY + caseId);
  if (!raw) return 0;
  const until = parseInt(raw, 10);
  const remaining = Math.max(0, until - Date.now());
  return Math.floor(remaining / 1000);
}
function setCooldown(caseId, seconds) {
  localStorage.setItem(COOLDOWN_KEY + caseId, String(Date.now() + seconds * 1000));
}
function clearCooldown(caseId) {
  localStorage.removeItem(COOLDOWN_KEY + caseId);
}

// ==================== FIREBASE SUBMIT ====================
// Explicit test accounts only — never write to leaderboard.
const NO_SUBMIT_NICKS = new Set(['C2Test','V5Test','TestAgent','HardTest','V4Test','V3Test','C4Test','C5Test','C5Wire','C4Wire','C3Test','C3Hard','Case2Vis','LangTest','PhotoTest','CertTest','CertHero','TestGallery']);
const isTestNick = (n) => NO_SUBMIT_NICKS.has(n);

async function submitScore(nickname, gamePoints, caseId) {
  if (isTestNick(nickname)) {
    console.log('[submitScore] skipped for dev/test nickname:', nickname);
    return { ok: true, skipped: true, total: gamePoints, games: 1 };
  }
  const now = new Date().toISOString();
  const userRef = ref(db, `leaderboard/${nickname}`);
  let existing = {};
  try {
    const snap = await get(userRef);
    if (snap.exists()) existing = snap.val();
  } catch (e) { console.warn('read own record failed', e); }
  const newTotal = (existing.total_points || 0) + Math.max(0, gamePoints);
  const newGames = (existing.games_played || 0) + 1;
  const payload = {
    total_points: newTotal,
    games_played: newGames,
    last_case: caseId,
    last_points: gamePoints,
    updated: now
  };
  try {
    await set(userRef, payload);
    const stats = { total: newTotal, games: newGames };
    localStorage.setItem(SCORE_KEY, JSON.stringify(stats));
    return { ok: true, ...stats };
  } catch (e) {
    console.error('submitScore failed', e);
    return { ok: false, error: e.message };
  }
}

// ==================== GAME STATE ====================
const State = {
  scenario: null,
  nickname: '',
  phase: 'loading',     // loading | cooldown | briefing | phase2 | timeline | phase3 | citation | phase4 | memo | result
  points: 0,
  timeLeft: 720,
  timerId: null,
  toolsUsed: {},        // {toolId: true}
  toolResults: [],      // [{tool, clue, points}]
  q3Answers: {},        // {qId: {optIdx, correct, points, feedback}}
  q3Order: {},          // {qId: [shuffled indices]}
  verdictOrder: [],     // shuffled indices for phase 4
  citations: [],        // [toolId] — picks from citation phase
  citationScore: 0,
  finalVerdict: null,
  startedAt: 0,
  ended: false,
  // Sim #02 Timeline Phase (optional)
  timelineOrder: [],
  timelineSubmitted: false,
  timelinePoints: 0,
  // Sim #02 Memo Phase (optional; replaces citation + phase4)
  memoSubject: '',           // subject id
  memoEvidence: [],          // [evidenceId, ...]
  memoRisk: '',              // 'low' | 'medium' | 'high' | 'critical'
  memoRecommendation: '',    // recommendation id
  memoSubmitted: false,
  memoPoints: 0,
  memoPolicyBreach: false,
};

// ==================== TIMER ====================
function startTimer() {
  if (State.timerId) clearInterval(State.timerId);
  const tick = () => {
    if (State.ended) return;
    State.timeLeft -= 1;
    const el = $('#hud-time');
    if (el) el.textContent = fmtTime(Math.max(0, State.timeLeft));
    if (State.timeLeft <= 60 && el) el.classList.add('hud-time--warn');
    if (State.timeLeft <= 0) {
      clearInterval(State.timerId);
      forceTimeout();
    }
  };
  State.timerId = setInterval(tick, 1000);
}
function stopTimer() { if (State.timerId) clearInterval(State.timerId); }
function forceTimeout() {
  State.ended = true;
  const timeoutBonus = 0;
  showResult({ timedOut: true, points: State.points + timeoutBonus });
}

// ==================== RENDER: BRIEFING ====================
function progressBar(current) {
  const s = State.scenario;
  const hasTimeline = !!s?.timeline_phase;
  const hasMemo = !!s?.memo_phase;
  // Build phase list dynamically. 'memo' replaces 'phase4' when present.
  const phases = ['briefing', 'phase2'];
  if (hasTimeline) phases.push('timeline');
  phases.push('phase3');
  phases.push(hasMemo ? 'memo' : 'phase4');
  const labelMap = LANG()==='en'
    ? { briefing:'Briefing', phase2:'Investigation', timeline:'Timeline', phase3:'Verification', phase4:'Verdict', memo:'Memo' }
    : { briefing:'Брифінг', phase2:'Розслідування', timeline:'Хронологія', phase3:'Верифікація', phase4:'Вердикт', memo:'Меморандум' };
  const labels = phases.map(p => labelMap[p]);
  // Normalize 'citation' → same slot as phase4/memo (visual last step)
  const curNorm = (current === 'citation') ? (hasMemo ? 'memo' : 'phase4') : current;
  const effectiveCurrent = curNorm;
  return `<div class="game-progress">${phases.map((p, i) => {
    const cur = phases.indexOf(effectiveCurrent);
    const cls = i < cur ? 'game-progress__step--done'
              : i === cur ? 'game-progress__step--active'
              : 'game-progress__step--todo';
    return `<div class="game-progress__step ${cls}"><span>${String(i+1).padStart(2,'0')}</span><em>${labels[i]}</em></div>`;
  }).join('')}</div>`;
}
function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
function fadeInRoot() {
  const root = $('#game-root');
  if (!root) return;
  root.classList.remove('game-fade');
  void root.offsetWidth; // reflow
  root.classList.add('game-fade');
}

function renderBriefing() {
  const s = State.scenario;
  const br = s.briefing;
  const cand = br.candidate;
  const html = `
    ${progressBar('briefing')}
    <div class="game-brief">
      <div class="game-brief__bg" style="background-image:url('${br.splash || 'img/uploads/simulator/shadow-simulator-splash.jpg'}')"></div>
      <div class="game-brief__reticle game-brief__r-tl"></div>
      <div class="game-brief__reticle game-brief__r-tr"></div>
      <div class="game-brief__reticle game-brief__r-bl"></div>
      <div class="game-brief__reticle game-brief__r-br"></div>
      <div class="game-brief__inner">
        <div class="game-brief__label">📋 ${LANG()==='en' ? 'CLIENT BRIEFING' : 'БРИФ КЛІЄНТА'}</div>
        <div class="game-brief__grid">
          <div class="game-brief__photo">
            <img src="${cand.photo}" alt="${escapeHtml(tr(cand,'name'))}">
            <div class="game-brief__photo-label">PASSPORT PHOTO</div>
          </div>
          <div class="game-brief__body">
            <h2>${escapeHtml(tr(cand,'name'))}</h2>
            <div class="game-brief__meta">
              <div><span>${LANG()==='en'?'Client':'Клієнт'}</span>${escapeHtml(tr(br,'client'))}</div>
              <div><span>${LANG()==='en'?'Position':'Позиція'}</span>${escapeHtml(br.position)}</div>
              <div><span>${LANG()==='en'?'Salary':'Оплата'}</span>${escapeHtml(br.salary)}</div>
              <div><span>Email</span><code>${escapeHtml(cand.email)}</code></div>
              <div><span>${LANG()==='en'?'Phone':'Телефон'}</span><code>${escapeHtml(cand.phone)}</code></div>
            </div>
            <p class="game-brief__text">${escapeHtml(tr(br,'body'))}</p>
            <div class="game-brief__actions">
              <button class="btn btn--filled" id="btn-start">${escapeHtml(tr(br,'start_btn'))}</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  $('#game-root').innerHTML = html;
  fadeInRoot();
  if (typeof renderHelpPanel === 'function') renderHelpPanel();
  showHelpHint();
  $('#btn-start').addEventListener('click', () => {
    State.phase = 'phase2';
    State.startedAt = Date.now();
    startTimer();
    track('game-start');
    renderPhase2();
    scrollTop();
  });
}

function showHelpHint() {
  if (localStorage.getItem('ss.help_hint_seen') === '1') return;
  if (document.getElementById('help-hint')) return;
  const hint = document.createElement('div');
  hint.id = 'help-hint';
  hint.className = 'help-hint';
  hint.innerHTML = `
    <button class="help-hint__close" aria-label="Close">✕</button>
    <div class="help-hint__arrow"></div>
    <div class="help-hint__text">${LANG()==='en' ? 'New here? Click <strong>❔ How to play</strong> anytime — full rules and glossary inside.' : 'Уперше тут? Клікни <strong>❔ Як грати</strong> будь-коли — правила і словник термінів усередині.'}</div>`;
  document.body.appendChild(hint);
  const dismiss = () => {
    localStorage.setItem('ss.help_hint_seen', '1');
    hint.classList.add('help-hint--fade');
    setTimeout(() => hint.remove(), 400);
  };
  hint.querySelector('.help-hint__close').addEventListener('click', dismiss);
  const helpBtn = document.getElementById('help-btn');
  if (helpBtn) helpBtn.addEventListener('click', dismiss, { once: true });
  setTimeout(dismiss, 12000);
}

// ==================== RENDER: PHASE 2 (TOOLBOARD) ====================
function renderPhase2() {
  const p = State.scenario.phase2;
  const toolCard = (t) => {
    const used = State.toolsUsed[t.id];
    const tooltip = tr(t, 'tooltip');
    const tipAttr = tooltip ? `data-tip="${escapeHtml(tooltip)}"` : '';
    return `
      <button class="tool-btn${used?' tool-btn--used':''}" data-tool="${t.id}" ${used?'disabled':''} ${tipAttr}>
        <div class="tool-btn__icon">${t.icon}</div>
        <div class="tool-btn__body">
          <div class="tool-btn__name">${escapeHtml(tr(t,'name'))}${tooltip?' <span class="tool-btn__info" aria-label="info">ⓘ</span>':''}</div>
          <div class="tool-btn__provider">${escapeHtml(t.provider)}</div>
          <div class="tool-btn__desc">${escapeHtml(tr(t,'desc'))}</div>
        </div>
        <div class="tool-btn__cost">-${t.time_cost}s</div>
      </button>`;
  };
  const usedCount = Object.keys(State.toolsUsed).length;
  const html = `
    ${progressBar('phase2')}
    <div class="game-phase">
      <div class="game-phase__head">
        <div class="game-phase__num">02 / 04</div>
        <h2>${escapeHtml(tr(p,'title'))}</h2>
        <p>${escapeHtml(tr(p,'instruction'))}</p>
      </div>
      <div class="tool-grid">${p.tools.map(toolCard).join('')}</div>
      <div class="game-phase__notes" id="tool-log">
        ${State.toolResults.length ? State.toolResults.map(r => `
          <div class="tool-log">
            <div class="tool-log__head">${escapeHtml(r.tool)} · <small>-${r.time}s</small></div>
            <div class="tool-log__clue tool-log__clue--muted">${LANG()==='en'?'✓ result recorded — review at end':'✓ результат збережено — розбір у кінці'}</div>
          </div>`).join('') : '<div class="tool-log__empty">' + (LANG()==='en'?'No tools used yet.':'Поки не використано жодного інструмента.') + '</div>'}
      </div>
      <div class="game-phase__foot">
        <div class="game-phase__hint">${LANG()==='en'?'Used':'Використано'}: ${usedCount} / ${p.min_tools_used}${LANG()==='en'?'+':'+'}</div>
        <button class="btn btn--filled" id="btn-next" ${usedCount < p.min_tools_used ? 'disabled' : ''}>
          ${escapeHtml(tr(p,'next_btn'))}
        </button>
      </div>
    </div>`;
  $('#game-root').innerHTML = html;
  fadeInRoot();
  if (typeof renderHelpPanel === 'function') renderHelpPanel();
  $('#game-root').querySelectorAll('.tool-btn:not(.tool-btn--used)').forEach(btn => {
    btn.addEventListener('click', () => useTool(btn.dataset.tool));
  });
  const nextBtn = $('#btn-next');
  if (nextBtn && !nextBtn.disabled) {
    nextBtn.addEventListener('click', () => {
      // Route: phase2 → timeline (if scenario defines it) → phase3, else → phase3
      const hasTimeline = !!State.scenario.timeline_phase;
      const nextPhase = hasTimeline ? 'timeline' : 'phase3';
      State.phase = nextPhase;
      track('game-' + nextPhase, { tools_used: Object.keys(State.toolsUsed).length });
      if (nextPhase === 'timeline') renderTimelinePhase();
      else renderPhase3();
      scrollTop();
    });
  }
}

function useTool(toolId) {
  const p = State.scenario.phase2;
  const tool = p.tools.find(x => x.id === toolId);
  if (!tool || State.toolsUsed[toolId]) return;

  // Show warning modal for red-herring tools (educational, not gotcha)
  const warning = tr(tool, 'warning');
  if (warning && !tool._warned) {
    showWarningModal(tool, warning, () => {
      tool._warned = true;
      commitTool(tool);
    });
    return;
  }
  commitTool(tool);
}

function commitTool(tool) {
  State.toolsUsed[tool.id] = true;
  State.points += tool.points;
  State.timeLeft = Math.max(0, State.timeLeft - tool.time_cost);
  State.toolResults.push({
    tool: tr(tool, 'name'),
    clue: tr(tool, 'clue'),
    points: tool.points,
    time: tool.time_cost,
    correct: tool.correct
  });
  updateHud();
  showToolModal(tool);
}

function showWarningModal(tool, warning, onConfirm) {
  const modal = document.createElement('div');
  modal.className = 'tool-modal';
  modal.innerHTML = `
    <div class="tool-modal__backdrop"></div>
    <div class="tool-modal__box tool-modal__box--warn">
      <div class="tool-modal__head">
        <div class="tool-modal__title">⚠️ ${LANG()==='en'?'Analyst warning':'Попередження аналітика'}</div>
      </div>
      <div class="tool-modal__warn-body">${escapeHtml(warning)}</div>
      <div class="tool-modal__foot">
        <button class="btn" data-act="cancel">${LANG()==='en'?'← Cancel, pick another tool':'← Скасувати, обрати інший тул'}</button>
        <button class="btn btn--filled" data-act="proceed">${LANG()==='en'?'Continue anyway →':'Все одно продовжити →'}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
  modal.querySelector('.tool-modal__backdrop').addEventListener('click', close);
  modal.querySelector('[data-act="proceed"]').addEventListener('click', () => {
    close();
    onConfirm();
  });
}

// ==================== FAKE-TOOL MODAL ====================
function showToolModal(tool) {
  const modal = document.createElement('div');
  modal.className = 'tool-modal';
  // Hard mode: NO clue text, NO points badge — player interprets raw data
  modal.innerHTML = `
    <div class="tool-modal__backdrop"></div>
    <div class="tool-modal__box">
      <div class="tool-modal__head">
        <div class="tool-modal__title">${tool.icon} ${escapeHtml(tr(tool,'name'))} · <span>${escapeHtml(tool.provider)}</span></div>
        <button class="tool-modal__close" aria-label="Close">✕</button>
      </div>
      <div class="tool-modal__ui">
        ${renderFakeUI(tool)}
      </div>
      <div class="tool-modal__foot tool-modal__foot--hard">
        <div class="tool-modal__hint">${LANG()==='en'?'Interpret the raw output. Score and interpretation revealed at the end.':'Інтерпретуй сирі дані. Оцінка і розбір — тільки в фіналі.'}</div>
        <button class="btn btn--filled tool-modal__ok">${LANG()==='en'?'Continue investigation →':'Продовжити розслідування →'}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => {
    modal.remove();
    // re-render phase 2 to reflect used state
    renderPhase2();
  };
  modal.querySelector('.tool-modal__close').addEventListener('click', close);
  modal.querySelector('.tool-modal__ok').addEventListener('click', close);
  modal.querySelector('.tool-modal__backdrop').addEventListener('click', close);
}

// ==================== FAKE-TOOL UI COMPONENTS ====================
function renderFakeUI(tool) {
  const s = State.scenario;
  const cand = s.briefing.candidate;
  const d = s.ui_data || {};
  switch (tool.ui_component) {
    case 'multi-reverse':
    case 'yandex-reverse':
      if (d.reverse_engines) {
        const renderMatch = (m) => `
          <div class="fake__match${m.warn?' fake__match--warn':''}">
            <img src="${escapeHtml(m.img)}" alt="" onerror="this.style.background='#1a2038';this.style.minHeight='60px'">
            <div><strong>${escapeHtml(m.site)}</strong><br><small>${escapeHtml(tr(m,'label') || m.label || '')} · ${escapeHtml(m.conf)}</small></div>
          </div>`;
        return `
          <div class="fake fake--multi-reverse">
            <div class="fake__topbar">🔎 <span>${LANG()==='en'?'Multi-Engine Reverse Face Search':'Пошук обличчя · 4 движки'}</span></div>
            <div class="fake__search-row">
              <img src="${cand.photo}" class="fake__input-img" alt="query">
              <div class="fake__query">${LANG()==='en'?'Uploaded':'Завантажено'}: <code>candidate.jpg</code> · ${LANG()==='en'?'Queried 4 engines':'Опитано 4 движки'}.</div>
            </div>
            <div class="fake__engines">
              ${d.reverse_engines.map(e => `
                <div class="fake__engine">
                  <div class="fake__engine-h">${escapeHtml(e.name)} <span>· ${escapeHtml(tr(e,'meta') || e.meta || '')}</span></div>
                  <div class="fake__engine-body">
                    ${e.matches && e.matches.length ? e.matches.map(renderMatch).join('') : ''}
                    ${e.note ? `<div class="fake__engine-note"><em>${escapeHtml(tr(e,'note') || e.note)}</em></div>` : ''}
                    ${e.body ? escapeHtml(tr(e,'body') || e.body) : ''}
                  </div>
                </div>`).join('')}
            </div>
          </div>`;
      }
      return `
      <div class="fake fake--multi-reverse">
        <div class="fake__topbar">🔎 <span>${LANG()==='en'?'Multi-Engine Reverse Face Search':'Пошук обличчя · 4 движки'}</span></div>
        <div class="fake__search-row">
          <img src="${cand.photo}" class="fake__input-img" alt="query">
          <div class="fake__query">${LANG()==='en'?'Uploaded':'Завантажено'}: <code>candidate.jpg</code> · ${LANG()==='en'?'Queried 4 engines':'Опитано 4 движки'}.</div>
        </div>
        <div class="fake__engines">
          <div class="fake__engine">
            <div class="fake__engine-h">PimEyes <span>· face-specific</span></div>
            <div class="fake__engine-body"><strong>${L('1 збіг · 74% впевненості','1 match · 74% confidence')}</strong><br><small>${L('Неатрибутоване публічне фото, low-res thumbnail. Немає метаданих.','Unattributed public photo, low-res thumbnail. No metadata.')}</small></div>
          </div>
          <div class="fake__engine">
            <div class="fake__engine-h">FaceCheck.ID <span>· deep-web faces</span></div>
            <div class="fake__engine-body"><strong>${L('2 збіги · 81% + 63%','2 matches · 81% + 63%')}</strong><br><small>${L('Обидва з українських дошок оголошень. 81% з watermark; 63% — групове фото (можливий crop bias).','Both from Ukrainian classifieds. 81% has watermark; 63% is a group photo (crop bias possible).')}</small></div>
          </div>
          <div class="fake__engine">
            <div class="fake__engine-h">Yandex <span>· CIS-strong</span></div>
            <div class="fake__engine-body">
              <div class="fake__match">
                <img src="img/uploads/simulator/candidate-vk.jpg" alt="">
                <div><strong>vk.com/roma_yellow_dnepr</strong><br><small>«Роман Ж.» · Дніпро · 79% match · profile last active 2022</small></div>
              </div>
              <div class="fake__match" style="opacity:.7">
                <div class="fake__match-thumb">?</div>
                <div><strong>ok.ru/profile/564293841</strong><br><small>«Роман Морозов» (сам!) · 68% · 2019</small></div>
              </div>
            </div>
          </div>
          <div class="fake__engine">
            <div class="fake__engine-h">TinEye <span>· exact-copy</span></div>
            <div class="fake__engine-body"><small>0 exact matches (photo not indexed as-is). Could mean: recent, or private, or edited.</small></div>
          </div>
        </div>
      </div>`;
    case 'hibp':
      if (d.hibp_breaches) {
        const trType = (t) => {
          if (LANG() !== 'en') return t
            .replace(/Emails \+ hashed passwords/g, 'Email + захешовані паролі')
            .replace(/Emails \+ encrypted passwords/g, 'Email + шифровані паролі')
            .replace(/Emails \+ bcrypt hashes/g, 'Email + bcrypt-хеші')
            .replace(/Aggregate credential[- ]stuffing list/g, 'Агрегований список credential-stuffing')
            .replace(/accounts leaked/g, 'акаунтів витекло')
            .replace(/accounts \(combined\)/g, 'акаунтів (комбіновано)');
          return t;
        };
        return `
          <div class="fake fake--hibp">
            <div class="fake__topbar">🔥 <span>Have I Been Pwned</span></div>
            <div class="fake__hibp-email">Email: <code>${escapeHtml(cand.email)}</code></div>
            <div class="fake__hibp-status"><strong>${L('Знайдено у', 'Found in')} ${d.hibp_breaches.length} ${L('витоках', 'breaches')}</strong> <small>(${L('baseline для email 10+ років', 'baseline for 10+ year email')} = 3-5)</small></div>
            <div class="fake__hibp-list">
              ${d.hibp_breaches.map(b => `<div class="fake__hibp-row"><strong>${escapeHtml(b.name)}</strong> · ${b.year} · ${escapeHtml(b.size)} · ${escapeHtml(trType(b.type))}</div>`).join('')}
            </div>
            ${tr(d, 'hibp_note') ? `<div class="fake__hibp-hint">${escapeHtml(tr(d, 'hibp_note'))}</div>` : ''}
          </div>`;
      }
      return `
      <div class="fake fake--hibp">
        <div class="fake__topbar">🔥 <span>Have I Been Pwned</span></div>
        <div class="fake__hibp-email">Email: <code>${escapeHtml(cand.email)}</code></div>
        <div class="fake__hibp-status"><strong>${L('Знайдено у 3 витоках','Found in 3 breaches')}</strong> <small>(${L('baseline для email 10+ років','baseline for 10+ year email')} = 3-5)</small></div>
        <div class="fake__hibp-list">
          <div class="fake__hibp-row"><strong>LinkedIn</strong> · 2012 · 164M · ${L('Email + захешовані паролі','Emails + hashed passwords')}</div>
          <div class="fake__hibp-row"><strong>Dropbox</strong> · 2016 · 68M · ${L('Email + bcrypt-хеші','Emails + bcrypt hashes')}</div>
          <div class="fake__hibp-row"><strong>Collection #1</strong> · 2019 · 773M · ${L('Агрегований список credential-stuffing','Aggregate credential stuffing list')}</div>
        </div>
        <div class="fake__hibp-hint">${L('Примітка: всі 3 — консюмерські сервіси + один агрегатор. Жодного dating, gambling, витоків з корп-БД. Читай *патерн*, не кількість.','Note: all 3 are consumer services + one aggregate dump. No dating, no gambling, no leaked internal-employee databases. Read the *pattern*, not the count.')}</div>
      </div>`;
    case 'getcontact':
      if (d.getcontact_tags) {
        return `
          <div class="fake fake--getcontact">
            <div class="fake__topbar">📱 <span>GetContact</span></div>
            <div class="fake__gc-num">${escapeHtml(cand.phone)}</div>
            <div class="fake__gc-count"><strong>${d.getcontact_tags.length + 10} ${L('тегів', 'tags')}</strong> ${L('від інших користувачів', 'from other users')}</div>
            <div class="fake__gc-tags">
              ${d.getcontact_tags.map(t => `<span class="fake__tag${t.kind==='red'?' fake__tag--red':''}">${escapeHtml(t.text)}</span>`).join('')}
            </div>
            ${tr(d, 'getcontact_note') ? `<div class="fake__gc-hint">${escapeHtml(tr(d, 'getcontact_note'))}</div>` : ''}
          </div>`;
      }
      return `
      <div class="fake fake--getcontact">
        <div class="fake__topbar">📱 <span>GetContact</span></div>
        <div class="fake__gc-num">${escapeHtml(cand.phone)}</div>
        <div class="fake__gc-count"><strong>47 ${L('тегів', 'tags')}</strong> ${L('від інших користувачів · сортовані за частотою (не за настроєм)', 'from other users · sorted by frequency (not by sentiment)')}</div>
        <div class="fake__gc-tags">
          <span class="fake__tag">Рома BMW</span>
          <span class="fake__tag">Морозов Р.</span>
          <span class="fake__tag">Sales manager</span>
          <span class="fake__tag">Roman салон</span>
          <span class="fake__tag">Морозов автосалон</span>
          <span class="fake__tag fake__tag--red">Рома Шахрай</span>
          <span class="fake__tag">Ромик</span>
          <span class="fake__tag fake__tag--red">НЕ давати гроші</span>
          <span class="fake__tag">Roman Consulting</span>
          <span class="fake__tag fake__tag--red">Кредит-обман</span>
          <span class="fake__tag">Морозов Р. фінанси</span>
          <span class="fake__tag">Roman Finance</span>
          <span class="fake__tag fake__tag--red">Обманщик BMW</span>
          <span class="fake__tag">+ 34 tags…</span>
        </div>
        <div class="fake__gc-hint">${L('GetContact не розрізняє реальні імена і образи; частота ≠ істина. Порахуй червоні vs нейтральні і зваж.', 'GetContact does not distinguish real names from insults; frequency ≠ truth. Count red vs neutral and weigh.')}</div>
      </div>`;
    case 'google-dorks':
      if (d.google_dorks_results) {
        return `
          <div class="fake fake--google">
            <div class="fake__topbar">🌐 <span>${L('Google — оператори пошуку', 'Google Search Operators')}</span></div>
            <div class="fake__google-query"><code>${escapeHtml(d.google_dorks_query)}</code></div>
            <div class="fake__google-results">
              ${d.google_dorks_results.map(r => `
                <div class="fake__google-row">
                  <div class="fake__google-link">${escapeHtml(r.url)}</div>
                  <div class="fake__google-snippet">${escapeHtml(r.snippet)}</div>
                </div>`).join('')}
            </div>
            ${tr(d, 'google_dorks_note') ? `<div class="fake__hibp-hint">${escapeHtml(tr(d, 'google_dorks_note'))}</div>` : ''}
          </div>`;
      }
      return `
      <div class="fake fake--google">
        <div class="fake__topbar">🌐 <span>${L('Google — оператори пошуку', 'Google Search Operators')}</span></div>
        <div class="fake__google-query"><code>"Роман Морозов" (finance OR CFO OR fin) site:linkedin.com OR site:job.ua OR site:work.ua filetype:pdf</code></div>
        <div class="fake__google-results">
          <div class="fake__google-row">
            <div class="fake__google-link">job.ua/resume/roman-morozov-sales-bmw-2020.pdf</div>
            <div class="fake__google-snippet">Роман Морозов — <strong>Sales Manager, BMW Boryspil</strong> (2018-2020). Освіта: КНЕУ, бакалавр економіки.</div>
          </div>
          <div class="fake__google-row">
            <div class="fake__google-link">work.ua/resumes/9384021</div>
            <div class="fake__google-snippet">Роман Морозов, м. Київ — Sales Consultant. Оновлено 2020-11-15. <em>Профіль позначено як застарілий.</em></div>
          </div>
          <div class="fake__google-row">
            <div class="fake__google-link">forum.finance.ua/threads/consulting-partners-2023</div>
            <div class="fake__google-snippet">…рекомендую R.Morozov для fractional-CFO робіт з малими компаніями, працював з ним у 2022 — швидко, коректно. Ставки помірні.</div>
          </div>
          <div class="fake__google-row">
            <div class="fake__google-link">news.epravda.com.ua/2019/04/bmw-boryspil-претензії-клієнтів</div>
            <div class="fake__google-snippet">…клієнти автосалону подали 12 скарг на менеджера відділу продажу, серед прізвищ згаданий Морозов Р.М. Внутрішнє розслідування закрито без розголошення.</div>
          </div>
          <div class="fake__google-row">
            <div class="fake__google-link">insead.edu/alumni-search · <em>0 exact matches</em></div>
            <div class="fake__google-snippet">Public alumni search: no results for «Roman Morozov». Note: alumni may opt out of directory visibility.</div>
          </div>
        </div>
      </div>`;
    case 'linkedin':
      if (d.linkedin_experience) {
        return `
          <div class="fake fake--linkedin">
            <div class="fake__topbar">💼 <span>LinkedIn</span></div>
            <div class="fake__li-profile">
              <div class="fake__li-name">${escapeHtml(tr(cand,'name'))} · <span>${escapeHtml(tr(d,'linkedin_summary'))}</span></div>
              <div class="fake__li-meta">📍 ${escapeHtml(d.linkedin_meta)}</div>
              <div class="fake__li-exp">
                ${d.linkedin_experience.map(x => `
                  <div class="fake__li-row"><strong>${escapeHtml(tr(x,'role'))}</strong><br>${escapeHtml(x.period)} · <em>${escapeHtml(tr(x,'note'))}</em></div>`).join('')}
              </div>
              <div class="fake__li-endorsements">
                <small>${L('Схвалили', 'Endorsements')}: ${d.linkedin_endorsements.map(e => escapeHtml(e.name)).join(' · ')}</small>
              </div>
            </div>
            ${tr(d, 'linkedin_note') ? `<div class="fake__hibp-hint">${escapeHtml(tr(d, 'linkedin_note'))}</div>` : ''}
          </div>`;
      }
      return `
      <div class="fake fake--linkedin">
        <div class="fake__topbar">💼 <span>LinkedIn</span></div>
        <div class="fake__li-profile">
          <div class="fake__li-name">Roman Morozov · <span>CFO candidate · Open to opportunities</span></div>
          <div class="fake__li-meta">📍 Kyiv, Ukraine · Joined LinkedIn 8 months ago · 87 connections</div>
          <div class="fake__li-exp">
            <div class="fake__li-row"><strong>Independent Consultant</strong><br>Jan 2024 — Present · «Financial advisory for SME»</div>
            <div class="fake__li-row"><strong>CFO · GlobalFin Advisory Ltd</strong> <em>(company not searchable)</em><br>Jan 2020 — Dec 2023 · «Multi-jurisdictional treasury»</div>
            <div class="fake__li-row"><strong>Head of Finance · Prime Capital Group</strong> <em>(private, page taken down)</em><br>2017 — 2019</div>
            <div class="fake__li-row"><strong>Senior Analyst · «regional firm»</strong><br>2014 — 2016 · no logo, no location</div>
          </div>
          <div class="fake__li-education">
            <div class="fake__li-row"><strong>INSEAD · MBA</strong><br>2013 — 2014 (self-reported)</div>
          </div>
          <div class="fake__li-endorsements">
            <small>Endorsed by: 3 people (all joined LinkedIn within last 12 months)</small>
          </div>
        </div>
      </div>`;
    case 'sanctions-pep':
      if (d.sanctions_grid) {
        return `
          <div class="fake fake--sanctions">
            <div class="fake__topbar">⚖️ <span>${L('Санкції & PEP Screening', 'Sanctions & PEP Screening')}</span></div>
            <div class="fake__sanc-name">${L('Запит', 'Query')}: <code>${escapeHtml(tr(cand,'name'))} · ${escapeHtml(cand.phone)}</code></div>
            <div class="fake__sanc-grid">
              ${d.sanctions_grid.map(g => `
                <div class="fake__sanc-cell fake__sanc-cell--${g.status==='clean'?'ok':'warn'}">
                  <span>${escapeHtml(g.list)}</span><strong>${g.status==='clean'?L('✓ ЧИСТО','✓ CLEAN'):L('⚠ ПЕРЕВІРКА','⚠ CHECK')}</strong>
                </div>`).join('')}
              <div class="fake__sanc-cell fake__sanc-cell--warn">
                <span>${L('Однофамільці — розчищення','Namesake disambiguation')}</span><strong>${L('⚠ АВТО-МАТЧ','⚠ AUTO-MATCH')}</strong>
                <small>${escapeHtml(tr(d,'sanctions_namesake'))}</small>
              </div>
            </div>
          </div>`;
      }
      return `
      <div class="fake fake--sanctions">
        <div class="fake__topbar">⚖️ <span>${L('Санкції & PEP · скринінг', 'Sanctions & PEP Screening')}</span></div>
        <div class="fake__sanc-name">Query: <code>Roman Morozov · +380 67 ***-**-45</code></div>
        <div class="fake__sanc-grid">
          <div class="fake__sanc-cell fake__sanc-cell--ok"><span>OFAC (US Treasury)</span><strong>${L('✓ ЧИСТО','✓ CLEAN')}</strong></div>
          <div class="fake__sanc-cell fake__sanc-cell--ok"><span>EU Sanctions</span><strong>${L('✓ ЧИСТО','✓ CLEAN')}</strong></div>
          <div class="fake__sanc-cell fake__sanc-cell--ok"><span>UK HMT Sanctions</span><strong>${L('✓ ЧИСТО','✓ CLEAN')}</strong></div>
          <div class="fake__sanc-cell fake__sanc-cell--ok"><span>СБУ / РНБО (UA)</span><strong>${L('✓ ЧИСТО','✓ CLEAN')}</strong></div>
          <div class="fake__sanc-cell fake__sanc-cell--warn"><span>${L('PEP база','PEP database')}</span><strong>${L('⚠ ЧАСТКОВО','⚠ PARTIAL')}</strong><small>${L('3-й ступінь спорідненості з депутатом райради (2020-2024). Не дискваліфікує, треба задокументувати.','3rd-degree kin of district council deputy (2020-2024). Not disqualifying, must document.')}</small></div>
          <div class="fake__sanc-cell fake__sanc-cell--ok"><span>Interpol Red Notices</span><strong>${L('✓ ЧИСТО','✓ CLEAN')}</strong></div>
        </div>
      </div>`;
    case 'court-registry':
    case 'court-registry-clean':
      if (d.court_cases) {
        return `
          <div class="fake fake--court">
            <div class="fake__topbar">⚖️ <span>Єдиний реєстр судових рішень + Opendatabot</span></div>
            <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.court_query)}</code></div>
            <div class="fake__court-list">
              ${d.court_cases.map((c, i) => `
                <div class="fake__court-case">
                  <div class="fake__court-h">📄 Справа ${escapeHtml(c.num)} · ${c.date} · ${escapeHtml(tr(c,'court'))}</div>
                  <div class="fake__court-body">${escapeHtml(tr(c,'body'))}</div>
                  ${i === 0 && d.court_doc_image ? `<img src="${escapeHtml(d.court_doc_image)}" class="fake__court-doc" alt="court document photo">` : ''}
                </div>`).join('')}
            </div>
            ${tr(d,'court_note') ? `<div class="fake__court-hint">${escapeHtml(tr(d,'court_note'))}</div>` : ''}
          </div>`;
      }
      return `
      <div class="fake fake--court">
        <div class="fake__topbar">⚖️ <span>Єдиний реєстр судових рішень + Opendatabot</span></div>
        <div class="fake__court-query">Query: <code>Морозов Роман · ПІБ · всі області</code></div>
        <div class="fake__court-list">
          <div class="fake__court-case">
            <div class="fake__court-h">📄 Справа №520/1428/19 · 2019-03-12 · Голосіївський р/с Києва</div>
            <div class="fake__court-body">Позовна заява <em>ТОВ «Автосалон Схід»</em> проти <strong>Морозова Р.М.</strong>: стягнення заборгованості 340 000 грн за фактично отриманий бонусний фонд. <br><strong>Рішення:</strong> у задоволенні позову відмовлено, справу закрито за відсутністю достатніх доказів.</div>
            <small>Судова колегія: 1 суддя. Апеляція: не подавалась. Доступ: публічний.</small>
          </div>
          <div class="fake__court-case">
            <div class="fake__court-h">📄 Справа №910/8834/21 · 2021-09-04 · Господарський суд Києва</div>
            <div class="fake__court-body">Банкрутство <strong>ТОВ «Прайм Кепітал Груп»</strong>. Морозов Р.М. — свідок. Опитування підтверджено. Розмір кредиторки: 12.4 млн грн. Судові збори покриті ліквідатором. <em>Дата ліквідації: 2022-04-18.</em></div>
            <small>Прайм Кепітал = одна з компаній з LinkedIn (позначена як «page taken down»).</small>
          </div>
        </div>
        <div class="fake__court-hint">Закриття справи ≠ невинуватість — це відсутність доказів. Свідок ≠ підозрюваний, але зв'язок з тепер-збанкрутілою фірмою — інформація до досьє.</div>
      </div>`;
    case 'insead-alumni':
      if (d.insead_query) {
        return `
          <div class="fake fake--insead">
            <div class="fake__topbar">🎓 <span>${L('Верифікація освіти (state + alumni реєстри)', 'Education Verification (state + alumni registries)')}</span></div>
            <div class="fake__insead-query">${escapeHtml(d.insead_query)}</div>
            <div class="fake__insead-result" style="background:rgba(163,230,163,.06)">
              <div class="fake__insead-result-icon" style="color:#a3e6a3">✓</div>
              <div class="fake__insead-result-title" style="color:#a3e6a3">${escapeHtml(d.insead_result_title)}</div>
              <div class="fake__insead-result-body">${escapeHtml(tr(d,'insead_result_body'))}</div>
            </div>
          </div>`;
      }
      return `
      <div class="fake fake--insead">
        <div class="fake__topbar">🎓 <span>${L('INSEAD Alumni Directory (публічний пошук)', 'INSEAD Alumni Directory (public search)')}</span></div>
        <div class="fake__insead-query">${L('Перевіряю заявку з CV', 'Verifying claim from CV')}: <code>Roman Morozov · MBA · INSEAD · 2013—2014</code></div>
        <div class="fake__insead-search">
          <div class="fake__insead-row">▸ ${L('Публічний пошук alumni по 2013—2015 когортам…', 'Public alumni search over 2013—2015 cohorts…')}</div>
          <div class="fake__insead-row">▸ ${L('Варіанти', 'Variants')}: Morozov, Морозов, R. Morozov, Roman M…</div>
          <div class="fake__insead-row">▸ ${L('Крос-перевірка LinkedIn INSEAD alumni group…', 'Cross-check LinkedIn INSEAD alumni group…')}</div>
        </div>
        <div class="fake__insead-result">
          <div class="fake__insead-result-icon">?</div>
          <div class="fake__insead-result-title">${L('НЕМАЄ ПУБЛІЧНОГО МАТЧУ', 'NO PUBLIC MATCH')}</div>
          <div class="fake__insead-result-body">
            ${L('Публічний каталог', 'Public directory')}: <strong>0 ${L('збігів', 'matches')}</strong> ${L('за точним запитом', 'for the exact query')}.<br>
            <small>${L('Примітка: ~40% alumni INSEAD відмовляються від публічної видимості. Офіційна верифікація вимагає підписаного дозволу кандидата до INSEAD Career Services.', 'Note: ~40% of INSEAD alumni opt out of public directory visibility. Official verification requires a signed release from the candidate to INSEAD Career Services.')}</small>
          </div>
        </div>
        <div class="fake__insead-hint">${L('Інтерпретуй уважно: публічна відсутність ≠ доказ фальсифікації. Але для такої специфічної заяви — відсутність + жодного членства в LinkedIn INSEAD group + жодного сліду thesis/публікацій = схиляє до підозри.', 'Interpret carefully: public absence ≠ fabrication proof. But for a claim this specific, absence + no LinkedIn INSEAD group membership + no thesis / publication trail = tilts toward suspicion.')}</div>
      </div>`;
    case 'osint-industries':
      if (d.osint_industries_results) {
        return `
          <div class="fake fake--oi">
            <div class="fake__topbar">🔎 <span>${L('OSINT Industries · агрегатор', 'OSINT Industries · Aggregator')}</span></div>
            <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.osint_industries_query)}</code></div>
            <table class="fake__oi-table">
              <thead><tr><th>${L('Платформа','Platform')}</th><th>${L('Статус','Status')}</th><th>${L('Деталь','Detail')}</th></tr></thead>
              <tbody>
                ${d.osint_industries_results.map(r => `
                  <tr class="fake__oi-row fake__oi-row--${r.status}">
                    <td><strong>${escapeHtml(r.platform)}</strong></td>
                    <td>${r.status === 'found' ? '✓' : r.status === 'private' ? '🔒' : r.status === 'empty' ? '∅' : '—'} ${escapeHtml(r.status)}</td>
                    <td><small>${escapeHtml(tr(r,"detail") || r.detail || "")}</small></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
      }
      break;
    case 'hibp-stealer':
      if (d.stealer_log_hit) {
        return `
          <div class="fake fake--hibp">
            <div class="fake__topbar">🔥 <span>HIBP + BreachDirectory</span></div>
            <div class="fake__hibp-email">Email: <code>${escapeHtml(cand.email)}</code> · Phone: <code>${escapeHtml(cand.phone)}</code></div>
            <div class="fake__hibp-status"><strong>HIBP · ${d.hibp_breaches.length} baseline breaches</strong></div>
            <div class="fake__hibp-list">
              ${d.hibp_breaches.map(b => `<div class="fake__hibp-row"><strong>${escapeHtml(b.name)}</strong> · ${b.year} · ${escapeHtml(b.size)}</div>`).join('')}
            </div>
            <div class="fake__hibp-status" style="margin-top:1rem"><strong>BreachDirectory · stealer log hit</strong></div>
            <div class="fake__hibp-list">
              <div class="fake__hibp-row"><strong>${L('Джерело', 'Source')}:</strong> ${escapeHtml(d.stealer_log_hit.source)}</div>
              <div class="fake__hibp-row"><strong>${L('Телефон', 'Phone')}:</strong> ${escapeHtml(d.stealer_log_hit.phone)}</div>
              <div class="fake__hibp-row"><strong>Telegram (public):</strong> ${escapeHtml(d.stealer_log_hit.telegram_id_public)}</div>
              <div class="fake__hibp-row" style="color:#ffc864"><strong>Telegram (extra ID):</strong> ${escapeHtml(d.stealer_log_hit.telegram_id_extra)}</div>
            </div>
          </div>`;
      }
      break;
    case 'google-dorks-family':
      if (d.google_dorks_results && d.google_dorks_query) {
        return `
          <div class="fake fake--google">
            <div class="fake__topbar">🌐 <span>${L('Google Dorks · через сімʼю', 'Google Dorks · Family Angle')}</span></div>
            <div class="fake__google-query"><code>${escapeHtml(d.google_dorks_query)}</code></div>
            <div class="fake__google-results">
              ${d.google_dorks_results.map(r => `
                <div class="fake__google-row">
                  <div class="fake__google-link">${escapeHtml(r.url)}</div>
                  <div class="fake__google-snippet">${escapeHtml(r.snippet)}</div>
                </div>`).join('')}
            </div>
          </div>`;
      }
      break;
    case 'instagram-family':
      if (d.instagram_wife) {
        const w = d.instagram_wife;
        const s = d.instagram_sister;
        const tagged = (w.tagged_as_sister || []);
        return `
          <div class="fake fake--ig">
            <div class="fake__topbar">📸 <span>${L('Instagram · pivot через сімʼю', 'Instagram · Family Pivot')}</span></div>
            <div class="fake__ig-block">
              <div class="fake__ig-h">${escapeHtml(w.handle)} · <span>${escapeHtml(w.status)} · ${w.posts} posts · ${w.followers} followers</span></div>
              <div class="fake__ig-body">${L('Свіжий контент', 'Recent content')}: ${escapeHtml(w.recent)}</div>
              ${tagged.length ? `
                <div class="fake__ig-highlights"><strong>${L('Тегнуті як «сестра» в різних постах', 'Tagged as «sister» in various posts')}:</strong>
                  <ul style="margin:.5rem 0 0;padding-left:1.2rem">
                    ${tagged.map(t => `<li><code>${escapeHtml(t.handle)}</code> — <em>${escapeHtml(t.note)}</em></li>`).join('')}
                  </ul>
                </div>` : ''}
            </div>
            <div class="fake__ig-arrow">↓</div>
            <div class="fake__ig-block fake__ig-block--highlight">
              <div class="fake__ig-h">${escapeHtml(s.handle)} · <span>${escapeHtml(s.status)} · ${s.posts} posts · ${s.followers} followers</span></div>
              <div class="fake__ig-body">Highlights: ${s.highlights.map(h => `<span class="fake__ig-tag">${escapeHtml(h)}</span>`).join(' ')}</div>
              <div class="fake__ig-photo">
                <img src="${escapeHtml(s.family_photo_2023.img)}" alt="family photo" onerror="this.style.display='none'">
                <div class="fake__ig-caption">${escapeHtml(s.family_photo_2023.caption)}</div>
                <div class="fake__ig-tagged"><strong>${L('Тегнуті на цьому фото', 'Tagged in this photo')}:</strong> ${escapeHtml(s.family_photo_2023.tagged)}</div>
              </div>
              <div class="fake__ig-highlights">${escapeHtml(s.highlights_content)}</div>
            </div>
          </div>`;
      }
      break;
    case 'classifieds':
      if (d.classifieds_ads) {
        return `
          <div class="fake fake--court">
            <div class="fake__topbar">📰 <span>${L('Дошки оголошень (архів) · OLX + Безплатка', 'Local Classifieds Archive · OLX + Bezplatka')}</span></div>
            <div class="fake__court-list">
              ${d.classifieds_ads.map(a => `
                <div class="fake__court-case">
                  <div class="fake__court-h">${escapeHtml(a.site)}</div>
                  <div class="fake__court-body"><strong>${escapeHtml(a.title)}</strong><br>${L('Контакт', 'Contact')}: <code>${escapeHtml(a.contact)}</code><br>${escapeHtml(a.note)}</div>
                  ${a.img ? `<img src="${escapeHtml(a.img)}" class="fake__court-doc" alt="ad screenshot" onerror="this.style.display='none'">` : ''}
                </div>`).join('')}
            </div>
          </div>`;
      }
      break;
    case 'telegram-reverse':
      if (d.telegram_reverse_result) {
        const tr2 = d.telegram_reverse_result;
        const accs = [tr2.account_1, tr2.account_2, tr2.account_3].filter(Boolean);
        return `
          <div class="fake fake--tg">
            <div class="fake__topbar">📱 <span>${L('Telegram · reverse-lookup', 'Telegram Reverse Lookup')}</span></div>
            <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.telegram_reverse_query)}</code> · ${L('Знайдено акаунтів', 'Accounts found')}: <strong>${tr2.accounts_found}</strong></div>
            ${accs.map((a, i) => `
              <div class="fake__tg-account${a.channels && a.channels.length >= 3 ? ' fake__tg-account--red' : ''}">
                <div class="fake__tg-h">Account ${i+1}: ${escapeHtml(a.handle)}</div>
                <div class="fake__tg-body">${L('Власник', 'Owner')}: ${escapeHtml(a.owner)}</div>
                ${a.channels && a.channels.length ? `<div class="fake__tg-channels">${L('Канали', 'Channels')}:<ul>${a.channels.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul></div>` : ''}
                ${a.activity ? `<div class="fake__tg-quote">${escapeHtml(a.activity)}</div>` : ''}
                ${a.screenshot ? `<img src="${escapeHtml(a.screenshot)}" class="fake__court-doc" alt="" onerror="this.style.display='none'">` : ''}
              </div>`).join('')}
          </div>`;
      }
      break;
    case 'linkedin-clean':
      if (d.linkedin_clean) {
        const l = d.linkedin_clean;
        return `
          <div class="fake fake--linkedin">
            <div class="fake__topbar">💼 <span>${L('LinkedIn · прямий пошук', 'LinkedIn · Direct')}</span></div>
            <div class="fake__li-profile">
              <div class="fake__li-name">${escapeHtml(l.name)} · <span>${escapeHtml(l.headline)}</span></div>
              <div class="fake__li-meta">📍 ${l.years} years · ${l.connections} connections</div>
              <div class="fake__li-exp">
                ${l.experience.map(e => `<div class="fake__li-row">${escapeHtml(e)}</div>`).join('')}
              </div>
              <div class="fake__li-endorsements"><small>${escapeHtml(l.posts)}</small></div>
            </div>
          </div>`;
      }
      break;
    case 'sanctions-clean':
      if (d.sanctions_grid) {
        return `
          <div class="fake fake--sanctions">
            <div class="fake__topbar">⚖️ <span>${L('Санкції & PEP · скринінг', 'Sanctions & PEP Screening')}</span></div>
            <div class="fake__sanc-name">${L('Запит', 'Query')}: <code>${escapeHtml(tr(cand,'name'))}</code></div>
            <div class="fake__sanc-grid">
              ${d.sanctions_grid.map(g => `
                <div class="fake__sanc-cell fake__sanc-cell--ok">
                  <span>${escapeHtml(g.list)}</span><strong>✓ CLEAN</strong>
                </div>`).join('')}
            </div>
          </div>`;
      }
      break;
    case 'wayback':
      if (d.wayback_snapshots) {
        return `
          <div class="fake fake--wayback">
            <div class="fake__topbar">🕰️ <span>${L('Internet Archive · Wayback', 'Internet Archive · Wayback Machine')}</span></div>
            <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.wayback_query)}</code></div>
            <img src="img/uploads/simulator/case4/wayback-archive.png" class="fake__court-doc" alt="" onerror="this.style.display='none'" style="max-width:100%;margin:0;">
            <div class="fake__court-list">
              ${d.wayback_snapshots.map(s => `
                <div class="fake__court-case">
                  <div class="fake__court-h">📄 ${escapeHtml(s.url)} · ${escapeHtml(s.date)}</div>
                  <div class="fake__court-body">${escapeHtml(tr(s,"detail") || s.detail || "")}</div>
                </div>`).join('')}
            </div>
          </div>`;
      }
      break;
    case 'telegram-history':
      if (d.telegram_username_history) {
        return `
          <div class="fake fake--court">
            <div class="fake__topbar">📊 <span>${L('Telegram · історія username', 'Telegram Username History')}</span></div>
            <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.telegram_username_query)}</code></div>
            <table class="fake__oi-table">
              <thead><tr><th>Handle</th><th>${L('Період','Period')}</th><th>${L('Статус','Status')}</th></tr></thead>
              <tbody>
                ${d.telegram_username_history.map(h => `
                  <tr class="fake__oi-row fake__oi-row--${h.status}">
                    <td><strong>${escapeHtml(h.handle)}</strong></td>
                    <td><small>${escapeHtml(h.since || h.period || '')}</small></td>
                    <td>${escapeHtml(h.status)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
            ${d.telegram_note ? `<div class="fake__court-hint">${escapeHtml(d.telegram_note)}</div>` : ''}
          </div>`;
      }
      break;
    case 'osint-industries-c4':
      if (d.osint_industries_c4_results) {
        return `
          <div class="fake fake--oi">
            <div class="fake__topbar">🔎 <span>${L('OSINT Industries · крос-платформ', 'OSINT Industries · cross-platform')}</span></div>
            <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.osint_industries_c4_query)}</code></div>
            <table class="fake__oi-table">
              <thead><tr><th>${L('Платформа','Platform')}</th><th>${L('Знахідка','Hit')}</th><th>${L('Примітка','Note')}</th></tr></thead>
              <tbody>
                ${d.osint_industries_c4_results.map(r => `
                  <tr class="fake__oi-row fake__oi-row--found">
                    <td><strong>${escapeHtml(r.platform)}</strong></td>
                    <td><code>${escapeHtml(r.hit)}</code></td>
                    <td><small>${escapeHtml(tr(r,"note") || r.note || "")}</small></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
      }
      break;
    case 'multi-reverse-c4':
      if (d.reverse_engines) {
        const renderMatch = (m) => `
          <div class="fake__match${m.warn?' fake__match--warn':''}">
            <img src="${escapeHtml(m.img)}" alt="" onerror="this.style.display='none'">
            <div><strong>${escapeHtml(m.site)}</strong><br><small>${escapeHtml(m.label)} · ${escapeHtml(m.conf)}</small></div>
          </div>`;
        return `
          <div class="fake fake--multi-reverse">
            <div class="fake__topbar">🔎 <span>${LANG()==='en'?'Multi-Engine Reverse Face Search':'Пошук обличчя · 4 движки'}</span></div>
            <div class="fake__search-row">
              <img src="${cand.photo}" class="fake__input-img" alt="query">
              <div class="fake__query">${LANG()==='en'?'Uploaded':'Завантажено'}: <code>candidate.jpg</code> · ${LANG()==='en'?'Queried 4 engines':'Опитано 4 движки'}.</div>
            </div>
            <div class="fake__engines">
              ${d.reverse_engines.map(e => `
                <div class="fake__engine">
                  <div class="fake__engine-h">${escapeHtml(e.name)} <span>· ${escapeHtml(e.meta)}</span></div>
                  <div class="fake__engine-body">
                    ${e.matches && e.matches.length ? e.matches.map(renderMatch).join('') : '<small>no matches</small>'}
                  </div>
                </div>`).join('')}
            </div>
          </div>`;
      }
      break;
    case 'instagram-friends-c4':
      if (d.instagram_friends) {
        return `
          <div class="fake fake--ig">
            <div class="fake__topbar">📸 <span>${L('Instagram · pivot через друзів', 'Instagram · Friends Pivot')}</span></div>
            <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.instagram_friends_query)}</code></div>
            ${d.instagram_friends.map(f => `
              <div class="fake__ig-block${f.notable_post ? ' fake__ig-block--highlight' : ''}">
                <div class="fake__ig-h">${escapeHtml(f.handle)} <span>· ${f.posts_with_target} posts with target</span></div>
                <div class="fake__ig-body">${escapeHtml(tr(f,"note") || f.note || "")}</div>
                ${f.notable_post ? `
                  <div class="fake__ig-photo">
                    ${f.notable_post.img ? `<img src="${escapeHtml(f.notable_post.img)}" alt="carousel" onerror="this.style.display='none'">` : ''}
                    <div class="fake__ig-caption">${escapeHtml(f.notable_post.date)} · ${escapeHtml(f.notable_post.type)}<br>«${escapeHtml(f.notable_post.caption)}»</div>
                    ${f.notable_post.video_note ? `<div class="fake__ig-tagged">${escapeHtml(f.notable_post.video_note)}</div>` : ''}
                  </div>` : ''}
              </div>`).join('')}
          </div>`;
      }
      break;
    case 'voice-biometric':
      if (d.voice_samples) {
        return `
          <div class="fake fake--voice">
            <div class="fake__topbar">🎤 <span>${L('Голосова біометрія — порівняння', 'Voice Biometric Comparison')}</span></div>
            <div class="fake__court-query">3 samples available · pick a pair to compare</div>
            <img src="img/uploads/simulator/case4/voice-waveform.png" class="fake__court-doc" alt="" onerror="this.style.display='none'" style="max-width:100%;margin:0;">
            <div class="fake__voice-samples">
              ${d.voice_samples.map(s => `
                <div class="fake__voice-sample">
                  <div class="fake__voice-h">${escapeHtml(s.id)}</div>
                  <div class="fake__voice-label">${escapeHtml(tr(s,'label'))}</div>
                  <div class="fake__voice-meta">
                    <span>${L('тривалість','duration')}: <strong>${escapeHtml(s.duration)}</strong></span>
                    <span>F0 avg: <strong>${escapeHtml(s.f0_avg)}</strong></span>
                    <span>${L('форманти','formants')}: <strong>${escapeHtml(s.formants)}</strong></span>
                  </div>
                  ${tr(s,'note') ? `<div class="fake__voice-note">${escapeHtml(tr(s,'note'))}</div>` : ''}
                </div>`).join('')}
            </div>
            <div class="fake__voice-pairs">
              <div class="fake__voice-pairs-h">${L('Результати порівняння (всі пари)', 'Comparison results (all pairs)')}:</div>
              ${d.voice_pairs.map(p => `
                <div class="fake__voice-pair">
                  <strong>${escapeHtml(p.a)} ↔ ${escapeHtml(p.b)}</strong>: ${escapeHtml(tr(p,'verdict'))}
                </div>`).join('')}
            </div>
          </div>`;
      }
      break;
    case 'facebook-clean-c4':
      if (d.facebook_curated) {
        const fb = d.facebook_curated;
        return `
          <div class="fake fake--linkedin">
            <div class="fake__topbar">📘 <span>${L('Facebook · прямий пошук', 'Facebook · Direct')}</span></div>
            <div class="fake__li-profile">
              <div class="fake__li-name">${escapeHtml(fb.name)}</div>
              <div class="fake__li-meta">${fb.followers} followers · ${fb.friends_shown} friends shown · ${fb.photos_visible} photos visible</div>
              <div class="fake__li-exp">
                <div class="fake__li-row">${escapeHtml(fb.posts_yearly)}</div>
              </div>
            </div>
          </div>`;
      }
      break;
    case 'sanctions-clean-c4':
      if (d.sanctions_grid) {
        return `
          <div class="fake fake--sanctions">
            <div class="fake__topbar">⚖️ <span>${L('Санкції & PEP · скринінг', 'Sanctions & PEP Screening')}</span></div>
            <div class="fake__sanc-name">${L('Запит', 'Query')}: <code>${escapeHtml(tr(cand,'name'))}</code></div>
            <div class="fake__sanc-grid">
              ${d.sanctions_grid.map(g => `
                <div class="fake__sanc-cell fake__sanc-cell--ok">
                  <span>${escapeHtml(g.list)}</span><strong>✓ CLEAN</strong>
                </div>`).join('')}
            </div>
          </div>`;
      }
      break;
    case 'osint-c5':
      if (d.osint_c5_results) {
        return `<div class="fake fake--oi">
          <div class="fake__topbar">🔎 <span>${L('OSINT Industries · крос-платформ', 'OSINT Industries · cross-platform')}</span></div>
          <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.osint_c5_query)}</code></div>
          <table class="fake__oi-table">
            <thead><tr><th>${L('Платформа','Platform')}</th><th>${L('Знахідка','Hit')}</th><th>${L('Примітка','Note')}</th></tr></thead>
            <tbody>${d.osint_c5_results.map(r => `<tr class="fake__oi-row fake__oi-row--${r.hit.includes('not found') || r.hit === 'no match' ? 'null' : 'found'}"><td><strong>${escapeHtml(r.platform)}</strong></td><td><code>${escapeHtml(r.hit)}</code></td><td><small>${escapeHtml(tr(r,"note") || r.note || "")}</small></td></tr>`).join('')}</tbody>
          </table>
        </div>`;
      }
      break;
    case 'wayback-c5':
      if (d.wayback_snapshots) {
        return `<div class="fake fake--wayback">
          <div class="fake__topbar">🕰️ <span>Internet Archive · Wayback</span></div>
          <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.wayback_query)}</code></div>
          <div class="fake__court-list">${d.wayback_snapshots.map(s => `<div class="fake__court-case"><div class="fake__court-h">📄 ${escapeHtml(s.url)} · ${escapeHtml(s.date)}</div><div class="fake__court-body">${escapeHtml(tr(s,"detail") || s.detail || "")}</div></div>`).join('')}</div>
        </div>`;
      }
      break;
    case 'reverse-c5':
      if (d.reverse_engines) {
        const rm = (m) => `<div class="fake__match${m.warn?' fake__match--warn':''}"><img src="${escapeHtml(m.img)}" alt="" onerror="this.style.display='none'"><div><strong>${escapeHtml(m.site)}</strong><br><small>${escapeHtml(m.label)} · ${escapeHtml(m.conf)}</small></div></div>`;
        return `<div class="fake fake--multi-reverse">
          <div class="fake__topbar">🔎 <span>${LANG()==='en'?'Multi-Engine Reverse Face Search':'Пошук обличчя · 4 движки'}</span></div>
          <div class="fake__search-row"><img src="${cand.photo}" class="fake__input-img"><div class="fake__query">${L('Завантажено','Uploaded')}: candidate.jpg · ${L('Опитано 4 движки','Queried 4 engines')}.</div></div>
          <div class="fake__engines">${d.reverse_engines.map(e => `<div class="fake__engine"><div class="fake__engine-h">${escapeHtml(e.name)} <span>· ${escapeHtml(e.meta)}</span></div><div class="fake__engine-body">${e.matches && e.matches.length ? e.matches.map(rm).join('') : '<small>no matches</small>'}</div></div>`).join('')}</div>
        </div>`;
      }
      break;
    case 'vk-russian':
      if (d.vk_russian_results) {
        return `<div class="fake fake--court">
          <div class="fake__topbar">🇷🇺 <span>${L('VK / Однокласники · архів', 'VK / Odnoklassniki Archive')}</span></div>
          <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.vk_russian_query)}</code></div>
          <div class="fake__court-list">${d.vk_russian_results.map(r => `<div class="fake__court-case"><div class="fake__court-h">${escapeHtml(r.type)} · ${escapeHtml(r.url)}</div><div class="fake__court-body">${escapeHtml(tr(r,"detail") || r.detail || "")}</div></div>`).join('')}</div>
        </div>`;
      }
      break;
    case 'financial-c5':
      if (d.financial_wallets) {
        return `<div class="fake fake--court">
          <div class="fake__topbar">💳 <span>${L('Blockchain · OTC-фінансовий слід', 'Blockchain / OTC Financial Trace')}</span></div>
          <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.financial_c5_query)}</code></div>
          <img src="img/uploads/simulator/case5/crypto-wallet-trace.png" class="fake__court-doc" alt="" onerror="this.style.display='none'" style="max-width:100%;margin:.5rem 0;">
          <div class="fake__court-list">${d.financial_wallets.map(w => `<div class="fake__court-case"><div class="fake__court-h">💰 ${escapeHtml(w.wallet)} · confidence: ${escapeHtml(w.confidence)}</div><div class="fake__court-body">${w.flows.length ? w.flows.map(f => `<div>← ${escapeHtml(f.in_from)}<br><small>${escapeHtml(tr(f,"note") || f.note || "")}</small></div>`).join('<hr style="opacity:.2;margin:.5rem 0">') : '<em>no flows on record</em>'}</div></div>`).join('')}</div>
        </div>`;
      }
      break;
    case 'deepweb-c5':
      if (d.deepweb_results) {
        return `<div class="fake fake--court">
          <div class="fake__topbar">🕳️ <span>${L('Deep-web · витоки корп-чатів', 'Deep-Web / Leaked Corp Chats')}</span></div>
          <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.deepweb_c5_query)}</code></div>
          <img src="img/uploads/simulator/case5/deepweb-chat.png" class="fake__court-doc" alt="" onerror="this.style.display='none'" style="max-width:100%;margin:.5rem 0;">
          <div class="fake__court-list">${d.deepweb_results.map(r => `<div class="fake__court-case"><div class="fake__court-h">📎 ${escapeHtml(r.source)}</div><div class="fake__court-body">${escapeHtml(tr(r,"detail") || r.detail || "")}</div></div>`).join('')}</div>
        </div>`;
      }
      break;
    case 'cell-c5':
      if (d.cell_pings) {
        return `<div class="fake fake--court">
          <div class="fake__topbar">📡 <span>${L('Cell metadata · пінги BTS', 'Cell Metadata / Tower Pings')}</span></div>
          <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.cell_c5_query)}</code></div>
          <img src="img/uploads/simulator/case5/cell-tower-map.png" class="fake__court-doc" alt="" onerror="this.style.display='none'" style="max-width:100%;margin:.5rem 0;">
          <table class="fake__oi-table">
            <thead><tr><th>${L('Дата/Час','Date/Time')}</th><th>BTS</th><th>${L('Примітка','Note')}</th></tr></thead>
            <tbody>${d.cell_pings.map(p => `<tr class="fake__oi-row"><td><strong>${escapeHtml(p.date)}</strong></td><td><code>${escapeHtml(p.bts)}</code></td><td>${escapeHtml(tr(p,"note") || p.note || "")}</td></tr>`).join('')}</tbody>
          </table>
        </div>`;
      }
      break;
    case 'gh-tech-c5':
      if (d.github_tech) {
        const g = d.github_tech;
        return `<div class="fake fake--court">
          <div class="fake__topbar">🌐 <span>${L('GitHub · аналіз комітів', 'GitHub Commit Analysis')}</span></div>
          <div class="fake__court-query">${L('Запит', 'Query')}: <code>${escapeHtml(d.github_tech_query)}</code></div>
          <div class="fake__court-case"><div class="fake__court-h">Handle: ${escapeHtml(g.handle)} · ${L('Репо', 'Repos')}: ${g.repos}</div>
            <div class="fake__court-body">${L('Часові пояси комітів', 'Commit timezones')}:<br>${g.commit_timezones.map(t => `→ <code>${escapeHtml(t.tz)}</code>: <strong>${escapeHtml(t.share)}</strong> · ${escapeHtml(t.period)}`).join('<br>')}<br><br><em>${escapeHtml(g.note)}</em></div>
          </div>
        </div>`;
      }
      break;
    case 'voice-c5':
      if (d.voice_samples) {
        return `<div class="fake fake--voice">
          <div class="fake__topbar">🎤 <span>${L('Голосова біометрія — порівняння', 'Voice Biometric Comparison')}</span></div>
          <div class="fake__voice-samples">${d.voice_samples.map(s => `<div class="fake__voice-sample"><div class="fake__voice-h">${escapeHtml(s.id)}</div><div class="fake__voice-label">${escapeHtml(tr(s,'label'))}</div><div class="fake__voice-meta"><span>F0: <strong>${escapeHtml(s.f0_avg)}</strong></span><span>${L('форманти','formants')}: <strong>${escapeHtml(s.formants)}</strong></span></div></div>`).join('')}</div>
          <div class="fake__voice-pairs"><div class="fake__voice-pairs-h">${L('Порівняння', 'Comparison')}:</div>${d.voice_pairs.map(p => `<div class="fake__voice-pair"><strong>${escapeHtml(p.a)} ↔ ${escapeHtml(p.b)}</strong>: ${escapeHtml(tr(p,'verdict'))}</div>`).join('')}</div>
        </div>`;
      }
      break;
    case 'linkedin-c5':
      if (d.linkedin_c5) {
        const l = d.linkedin_c5;
        return `<div class="fake fake--linkedin"><div class="fake__topbar">💼 <span>LinkedIn</span></div>
          <div class="fake__li-profile"><div class="fake__li-name">${escapeHtml(l.name)} · <span>${escapeHtml(l.headline)}</span></div>
            <div class="fake__li-meta">${l.years} yrs on LinkedIn · ${l.connections} connections</div>
            <div class="fake__li-exp">${l.experience.map(e => `<div class="fake__li-row">${escapeHtml(e)}</div>`).join('')}</div>
            <div class="fake__li-endorsements"><small>${escapeHtml(l.posts)}</small></div>
          </div>
        </div>`;
      }
      break;
    case 'sanctions-c5':
      if (d.sanctions_c5) {
        return `<div class="fake fake--sanctions">
          <div class="fake__topbar">⚖️ <span>${L('Санкції & PEP · скринінг', 'Sanctions & PEP Screening')}</span></div>
          <div class="fake__sanc-grid">${d.sanctions_c5.map(g => {
            const cls = g.status === 'clean' ? 'ok' : 'warn';
            const label = g.status === 'clean' ? L('✓ ЧИСТО','✓ CLEAN') : g.status === 'flag_hit' ? L('🚨 ХІТ','🚨 HIT') : L('⚠ ПЕРЕВІРКА','⚠ REVIEW');
            return `<div class="fake__sanc-cell fake__sanc-cell--${cls}"><span>${escapeHtml(g.list)} · <em>«${escapeHtml(g.query_name)}»</em></span><strong>${label}</strong>${g.note ? `<small>${escapeHtml(g.note)}</small>` : ''}</div>`;
          }).join('')}</div>
        </div>`;
      }
      break;
    case 'youcontrol': return `
      <div class="fake fake--youcontrol">
        <div class="fake__topbar">📄 <span>${L('YouControl — пошук юрособи', 'YouControl — Legal Entity Search')}</span></div>
        <div class="fake__yc-search">${L('Пошук', 'Search')}: <code>${escapeHtml(cand.phone)}</code></div>
        <div class="fake__yc-empty">
          <div class="fake__yc-empty-icon">∅</div>
          <div class="fake__yc-empty-title">${L('Немає юросіб привʼязаних до цього номера', 'No legal entities linked to this phone')}</div>
          <div class="fake__yc-empty-hint">${L('YouControl індексує компанії та їх контактні дані, не особисті телефони. Використовуй його ПІСЛЯ ідентифікації назви компанії.', 'YouControl indexes companies and their contact data, not personal phones. Use it after you identify a company name.')}</div>
        </div>
      </div>`;

    // ============ SIM #02 / CORPORATE INVESTIGATIONS UIs ============
    case 'matches': if (tool.matches) return `
      <div class="fake fake--matches">
        <div class="fake__topbar">${tool.icon || '🔎'} <span>${escapeHtml(tr(tool, 'name') || tool.name || '')}</span></div>
        <div class="fake__search-row"><div class="fake__query">${escapeHtml(tool.provider || '')}</div></div>
        <div class="fake__matches-list">
          ${tool.matches.map(m => `
            <div class="fake__match-row">
              ${m.img ? `<div class="fake__match-img"><img src="${escapeHtml(m.img)}" alt="" loading="lazy"></div>` : ''}
              <div class="fake__match-body">
                <div class="fake__match-site"><strong>${escapeHtml(m.site || '')}</strong>${m.url && m.url !== '—' ? ` · <code>${escapeHtml(m.url)}</code>` : ''}</div>
                ${(tr(m, 'note') || m.note) ? `<div class="fake__match-note">${escapeHtml(tr(m, 'note') || m.note)}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>`;
      break;

    case 'opencorp': if (tool.opencorp) return `
      <div class="fake fake--opencorp">
        <div class="fake__topbar">🏢 <span>OpenCorporates + ${L('ЄДР', 'State Registry')}</span></div>
        <div class="fake__search-row"><div class="fake__query">${L('Пошук', 'Search')}: <code>${escapeHtml(tool.opencorp.query || '')}</code></div></div>
        <div class="fake__oc-row"><span>${L('Компанія', 'Company')}</span><strong>${escapeHtml(tool.opencorp.company_name || '')}</strong></div>
        <div class="fake__oc-row"><span>${L('Реєстраційний №', 'Registration #')}</span><code>${escapeHtml(tool.opencorp.reg_no || '')}</code></div>
        <div class="fake__oc-row"><span>${L('Створено', 'Founded')}</span><strong>${escapeHtml(tool.opencorp.founded || '')}</strong></div>
        <div class="fake__oc-row"><span>${L('Юридична адреса', 'Legal address')}</span><strong>${escapeHtml(tr(tool.opencorp,'address') || tool.opencorp.address || '')}</strong></div>
        <div class="fake__oc-row"><span>${L('Тип', 'Type')}</span><strong>${escapeHtml(tool.opencorp.entity_type || 'LLC')}</strong></div>
        <div class="fake__oc-row"><span>${L('Статус', 'Status')}</span><strong style="color:#7dc98a">${escapeHtml(tool.opencorp.status || 'Active')}</strong></div>
        <div class="fake__oc-section"><h4>${L('Директори / посадові особи', 'Directors / Officers')}</h4>
          ${(tool.opencorp.officers || []).map(o => `
            <div class="fake__oc-officer">
              <div><strong>${escapeHtml(tr(o,'name') || o.name)}</strong> · <span style="color:var(--text-mute)">${escapeHtml(tr(o,'role') || o.role || '')}</span></div>
              ${o.note ? `<div style="color:var(--text-mute);font-size:.85em">${escapeHtml(tr(o,'note') || o.note)}</div>` : ''}
            </div>`).join('')}
        </div>
        <div class="fake__oc-section"><h4>${L('Засновники (KYC)', 'Founders (KYC)')}</h4>
          ${(tool.opencorp.founders || []).map(f => `
            <div class="fake__oc-officer">
              <div><strong>${escapeHtml(tr(f,'name') || f.name)}</strong> · ${escapeHtml(f.share || '')}%</div>
              ${f.note ? `<div style="color:var(--text-mute);font-size:.85em">${escapeHtml(tr(f,'note') || f.note)}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>`;
      break;

    case 'email-chain': if (tool.email_chain) return `
      <div class="fake fake--email">
        <div class="fake__topbar">✉ <span>${L('Ланцюжок листувань', 'Email chain')}</span> · <code>${escapeHtml(tool.email_chain.thread_subj || '')}</code></div>
        ${(tool.email_chain.messages || []).map(m => `
          <div class="fake__email-msg${m.highlight ? ' fake__email-msg--hi' : ''}">
            <div class="fake__email-head">
              <span><strong>${escapeHtml(m.from || '')}</strong> → ${escapeHtml(m.to || '')}</span>
              <span style="color:var(--text-mute);font-family:var(--font-mono);font-size:.75em">${escapeHtml(m.date || '')}</span>
            </div>
            <div class="fake__email-body">${escapeHtml(tr(m,'body') || m.body || '')}</div>
            ${m.attachment ? `<div class="fake__email-attach">📎 ${escapeHtml(m.attachment)}</div>` : ''}
          </div>`).join('')}
      </div>`;
      break;

    case 'invoice-analysis': if (tool.invoices) return `
      <div class="fake fake--invoices">
        <div class="fake__topbar">💰 <span>${L('Аналіз інвойсів (SAP export)', 'Invoice analysis (SAP export)')}</span></div>
        <table class="fake__inv-table">
          <thead><tr>
            <th>${L('Інвойс #','Invoice #')}</th>
            <th>${L('Дата','Date')}</th>
            <th>${L('Постачальник','Vendor')}</th>
            <th>${L('Сума','Amount')}</th>
            <th>${L('Затверджено','Approved by')}</th>
          </tr></thead>
          <tbody>
            ${tool.invoices.map(i => `
              <tr${i.highlight ? ' class="fake__inv-row--hi"' : ''}>
                <td><code>${escapeHtml(i.number || '')}</code></td>
                <td>${escapeHtml(i.date || '')}</td>
                <td>${escapeHtml(i.vendor || '')}</td>
                <td style="text-align:right"><strong>${escapeHtml(i.amount || '')}</strong></td>
                <td>${escapeHtml(i.approver || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        ${tool.invoices_note ? `<div class="fake__inv-note"><em>${escapeHtml(tr(tool,'invoices_note') || tool.invoices_note)}</em></div>` : ''}
      </div>`;
      break;

    case 'panama-lookup': if (tool.panama) return `
      <div class="fake fake--panama">
        <div class="fake__topbar">🌴 <span>ICIJ Offshore Leaks · Panama Papers</span></div>
        <div class="fake__search-row"><div class="fake__query">${L('Пошук', 'Search')}: <code>${escapeHtml(tool.panama.query || '')}</code></div></div>
        ${(tool.panama.results || []).map(r => `
          <div class="fake__panama-row">
            <div><strong>${escapeHtml(r.entity || '')}</strong> · <span style="color:var(--text-mute)">${escapeHtml(r.jurisdiction || '')}</span></div>
            <div style="color:var(--text-mute);font-size:.85em">${L('Роль','Role')}: ${escapeHtml(tr(r,'role') || r.role || '')} · ${L('Джерело','Source')}: ${escapeHtml(r.source || '')}</div>
            ${r.note ? `<div style="margin-top:.3em">${escapeHtml(tr(r,'note') || r.note)}</div>` : ''}
          </div>`).join('')}
      </div>`;
      break;

    case 'meeting-minutes': if (tool.doc) return `
      <div class="fake fake--doc">
        <div class="fake__topbar">📄 <span>${escapeHtml(tool.doc.title || 'Meeting minutes')}</span></div>
        <div class="fake__doc-meta">
          <div><strong>${L('Дата','Date')}:</strong> ${escapeHtml(tool.doc.date || '')}</div>
          <div><strong>${L('Учасники','Attendees')}:</strong> ${escapeHtml(tool.doc.attendees || '')}</div>
          <div><strong>${L('Класифікація','Classification')}:</strong> <span style="color:#e97373">${escapeHtml(tool.doc.classification || 'INTERNAL')}</span></div>
        </div>
        <div class="fake__doc-body">${(tool.doc.paragraphs || []).map(p => `<p>${escapeHtml(tr({ text_uk: p.text_uk, text_en: p.text_en }, 'text') || p.text || '')}</p>`).join('')}</div>
      </div>`;
      break;
  }
  return `<div class="fake fake--empty">No UI for tool: ${tool.ui_component}</div>`;
}

// ==================== RENDER: TIMELINE PHASE (Sim #02, optional) ====================
function computeTimelineScore(order, correctOrder) {
  let score = 0, pairsOk = 0, pairsBad = 0;
  const idx = new Map(correctOrder.map((id, i) => [id, i]));
  for (let i = 0; i < order.length - 1; i++) {
    const a = idx.get(order[i]);
    const b = idx.get(order[i + 1]);
    if (b === a + 1) { score += 5; pairsOk++; }
    else             { score -= 3; pairsBad++; }
  }
  return { score, pairsOk, pairsBad, total: order.length - 1 };
}
function renumberTimeline() {
  document.querySelectorAll('#tl-list .tl-event').forEach((el, i) => {
    const num = el.querySelector('.tl-event__num');
    if (num) num.textContent = String(i + 1).padStart(2, '0');
  });
}
function updateTimelineLiveScore() {
  const tp = State.scenario.timeline_phase;
  if (!tp) return;
  const { score, pairsOk, total } = computeTimelineScore(State.timelineOrder, tp.correct_order);
  const el = document.getElementById('tl-live-val');
  if (el) el.textContent = `${score > 0 ? '+' : ''}${score} (${pairsOk}/${total})`;
}
function renderTimelinePhase() {
  const tp = State.scenario.timeline_phase;
  if (!tp || !tp.events || !tp.correct_order) {
    State.phase = 'phase3'; renderPhase3(); return;
  }
  // Initialize shuffled order once per session (deterministic per case+nick)
  if (!State.timelineOrder.length) {
    const seed = hashStr(State.scenario.id + '|tl|' + (State.nickname || ''));
    let shuffled = seededShuffle(tp.events.map(e => e.id), seed);
    if (shuffled.join() === tp.correct_order.join()) shuffled = shuffled.slice().reverse();
    State.timelineOrder = shuffled;
  }
  const events = State.timelineOrder.map(id => tp.events.find(e => e.id === id));
  const isEn = LANG() === 'en';
  const title = tr(tp, 'title') || (isEn ? 'Build the event timeline' : 'Побудуй хронологію подій');
  const instr = tr(tp, 'instruction') ||
    (isEn ? 'Arrange the events in the correct chronological and causal order. Each correct adjacent pair +5, wrong pair −3.'
          : 'Розстав події у правильному хронологічному й причинно-наслідковому порядку. Правильна пара сусідніх +5, помилкова −3.');
  const submitLbl = tr(tp, 'submit_btn') || (isEn ? 'Submit timeline →' : 'Підтвердити хронологію →');

  const html = `
    ${progressBar('timeline')}
    <div class="game-phase game-phase--timeline">
      <div class="game-phase__head">
        <div class="game-phase__num">2.5 / 05</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(instr)}</p>
      </div>
      <ol class="tl-list" id="tl-list">
        ${events.map((e, i) => `
          <li class="tl-event" data-id="${escapeHtml(e.id)}">
            <div class="tl-event__num">${String(i + 1).padStart(2, '0')}</div>
            <div class="tl-event__body">
              <div class="tl-event__date">${escapeHtml(e.date || '')}</div>
              <div class="tl-event__text">${escapeHtml(tr(e, 'text'))}</div>
            </div>
            <div class="tl-event__grip">⋮⋮</div>
          </li>`).join('')}
      </ol>
      <div class="game-phase__foot">
        <div class="tl-live-score">
          <span>${isEn ? 'Live score' : 'Поточний рахунок'}:</span>
          <strong id="tl-live-val">—</strong>
        </div>
        <button class="btn btn--filled" id="btn-tl-submit">${escapeHtml(submitLbl)}</button>
      </div>
    </div>`;
  $('#game-root').innerHTML = html;
  fadeInRoot();
  if (typeof renderHelpPanel === 'function') renderHelpPanel();

  const listEl = $('#tl-list');
  if (typeof Sortable === 'undefined') {
    console.warn('SortableJS not loaded — skipping timeline phase');
    State.phase = 'phase3'; renderPhase3(); return;
  }
  const sortable = Sortable.create(listEl, {
    animation: 180,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    touchStartThreshold: 3,
    swapThreshold: 0.65,
    group: { name: 'sim-timeline', pull: false, put: false },
    onEnd: () => {
      State.timelineOrder = [...listEl.children].map(el => el.dataset.id);
      renumberTimeline();
      updateTimelineLiveScore();
    }
  });
  updateTimelineLiveScore();

  $('#btn-tl-submit').addEventListener('click', () => submitTimeline(sortable));
}
function submitTimeline(sortable) {
  if (State.timelineSubmitted) return;
  State.timelineSubmitted = true;
  if (sortable) sortable.option('disabled', true);
  const tp = State.scenario.timeline_phase;
  const { score, pairsOk, pairsBad, total } = computeTimelineScore(State.timelineOrder, tp.correct_order);
  State.timelinePoints = score;
  State.points += score;
  track('game-timeline-submit', { score, pairs_ok: pairsOk, pairs_bad: pairsBad });

  // Visual feedback: mark each event pair as ok/bad
  const idx = new Map(tp.correct_order.map((id, i) => [id, i]));
  const events = [...document.querySelectorAll('#tl-list .tl-event')];
  events.forEach(el => el.classList.add('tl-event--locked'));
  for (let i = 0; i < State.timelineOrder.length - 1; i++) {
    const a = idx.get(State.timelineOrder[i]);
    const b = idx.get(State.timelineOrder[i + 1]);
    const pairOk = (b === a + 1);
    events[i + 1].classList.add(pairOk ? 'tl-event--pair-ok' : 'tl-event--pair-bad');
    const grip = events[i + 1].querySelector('.tl-event__grip');
    if (grip) {
      const badge = document.createElement('div');
      badge.className = `tl-event__badge tl-event__badge--${pairOk ? 'ok' : 'bad'}`;
      badge.textContent = pairOk ? '+5' : '−3';
      grip.replaceWith(badge);
    }
  }
  // Replace footer with results + next button
  const isEn = LANG() === 'en';
  const foot = $('#btn-tl-submit')?.parentElement;
  if (foot) {
    foot.innerHTML = `
      <div class="tl-live-score">
        <span>${isEn ? 'Timeline score' : 'Очки за хронологію'}:</span>
        <strong>${score > 0 ? '+' : ''}${score}</strong>
        <span style="margin-left:.4rem">${pairsOk}/${total} ${isEn ? 'correct' : 'правильних'}</span>
      </div>
      <button class="btn btn--filled" id="btn-tl-next">${isEn ? 'Next → Verification' : 'Далі → Верифікація'}</button>`;
    $('#btn-tl-next').addEventListener('click', () => {
      State.phase = 'phase3';
      track('game-phase3', { tools_used: Object.keys(State.toolsUsed).length, timeline_score: score });
      renderPhase3();
      scrollTop();
    });
  }
  updateHud();
}

// ==================== RENDER: PHASE 3 (QUESTIONS) ====================
function renderPhase3() {
  const p = State.scenario.phase3;
  const questionCard = (q, i) => {
    const answered = State.q3Answers[q.id];
    // Shuffle options once per session using deterministic seed
    if (!State.q3Order[q.id]) {
      const seed = hashStr(State.nickname + State.startedAt + q.id);
      State.q3Order[q.id] = seededShuffle(q.options.map((_, i) => i), seed);
    }
    const order = State.q3Order[q.id];
    const optHtml = order.map((origIdx) => {
      const opt = q.options[origIdx];
      let cls = 'q-opt';
      if (answered) {
        if (origIdx === answered.optIdx) cls += ' q-opt--picked';
        cls += ' q-opt--disabled';
      }
      const disabled = answered ? 'disabled' : '';
      return `<button class="${cls}" data-q="${q.id}" data-opt="${origIdx}" ${disabled}>${escapeHtml(tr(opt,'text'))}</button>`;
    }).join('');
    const feedback = answered ? `<div class="q-feedback q-feedback--muted">${LANG()==='en'?'✓ answer locked — review at end':'✓ відповідь зафіксовано — розбір у кінці'}</div>` : '';
    return `
      <div class="q-card">
        <div class="q-card__num">Q${i+1} / ${p.questions.length}</div>
        <div class="q-card__text">${escapeHtml(tr(q,'text'))}</div>
        <div class="q-card__opts">${optHtml}</div>
        ${feedback}
      </div>`;
  };
  const allAnswered = p.questions.every(q => State.q3Answers[q.id]);
  const html = `
    ${progressBar('phase3')}
    <div class="game-phase">
      <div class="game-phase__head">
        <div class="game-phase__num">03 / 04</div>
        <h2>${escapeHtml(tr(p,'title'))}</h2>
        <p>${escapeHtml(tr(p,'instruction'))}</p>
      </div>
      <div class="q-list">${p.questions.map(questionCard).join('')}</div>
      <div class="game-phase__foot">
        <button class="btn btn--filled" id="btn-next" ${allAnswered ? '' : 'disabled'}>${escapeHtml(tr(p,'next_btn'))}</button>
      </div>
    </div>`;
  $('#game-root').innerHTML = html;
  fadeInRoot();
  if (typeof renderHelpPanel === 'function') renderHelpPanel();
  $('#game-root').querySelectorAll('.q-opt:not(.q-opt--disabled)').forEach(btn => {
    btn.addEventListener('click', () => answerQ3(btn.dataset.q, parseInt(btn.dataset.opt,10)));
  });
  const nextBtn = $('#btn-next');
  if (nextBtn && !nextBtn.disabled) {
    nextBtn.addEventListener('click', () => {
      // Route: phase3 → memo (Sim #02 replaces citation+phase4) OR → citation (legacy Sim #01)
      const hasMemo = !!State.scenario.memo_phase;
      const nextPhase = hasMemo ? 'memo' : 'citation';
      State.phase = nextPhase;
      track('game-' + nextPhase, { q_answered: Object.keys(State.q3Answers).length });
      if (nextPhase === 'memo') renderMemoPhase();
      else renderCitationPhase();
      scrollTop();
    });
  }
}

// ==================== RENDER: CITATION PHASE (3.5) ====================
function renderCitationPhase() {
  const cp = State.scenario.citation_phase;
  if (!cp) { State.phase = 'phase4'; renderPhase4(); return; }
  const usedTools = State.scenario.phase2.tools.filter(t => State.toolsUsed[t.id]);
  if (usedTools.length < 3) {
    // shouldn't happen (min_tools_used=4), but fallback
    State.phase = 'phase4'; renderPhase4(); return;
  }
  const max = cp.max_picks || 3;
  const picks = new Set(State.citations);
  const cardFor = (t) => {
    const picked = picks.has(t.id);
    return `
      <button class="cite-card${picked?' cite-card--picked':''}" data-cite="${t.id}">
        <div class="cite-card__icon">${t.icon}</div>
        <div class="cite-card__body">
          <div class="cite-card__name">${escapeHtml(tr(t,'name'))}</div>
          <div class="cite-card__clue">${escapeHtml(tr(t,'clue'))}</div>
        </div>
        <div class="cite-card__check">${picked?'✓':''}</div>
      </button>`;
  };
  const html = `
    ${progressBar('phase3')}
    <div class="game-phase game-phase--cite">
      <div class="game-phase__head">
        <div class="game-phase__num">3.5 / 04</div>
        <h2>${escapeHtml(tr(cp,'title'))}</h2>
        <p>${escapeHtml(tr(cp,'instruction'))}</p>
        <div class="cite-counter">${LANG()==='en'?'Picked':'Обрано'}: <strong id="cite-count">${picks.size}</strong> / ${max}</div>
      </div>
      <div class="cite-grid">${usedTools.map(cardFor).join('')}</div>
      <div class="game-phase__foot">
        <button class="btn btn--filled" id="btn-cite-next" ${picks.size===max?'':'disabled'}>${escapeHtml(tr(cp,'next_btn'))}</button>
      </div>
    </div>`;
  $('#game-root').innerHTML = html;
  fadeInRoot();
  if (typeof renderHelpPanel === 'function') renderHelpPanel();
  $('#game-root').querySelectorAll('.cite-card').forEach(btn => {
    btn.addEventListener('click', () => toggleCitation(btn.dataset.cite, max));
  });
  const nb = $('#btn-cite-next');
  if (nb && !nb.disabled) nb.addEventListener('click', () => {
    commitCitations();
    State.phase = 'phase4';
    track('game-phase4');
    renderPhase4();
    scrollTop();
  });
}
function toggleCitation(toolId, max) {
  const idx = State.citations.indexOf(toolId);
  if (idx >= 0) State.citations.splice(idx, 1);
  else if (State.citations.length < max) State.citations.push(toolId);
  else return;
  renderCitationPhase();
}
function commitCitations() {
  const cp = State.scenario.citation_phase;
  const tools = State.scenario.phase2.tools;
  let score = 0;
  State.citations.forEach(tid => {
    const t = tools.find(x => x.id === tid);
    if (!t) return;
    const w = t.weight || 'supporting';
    score += (cp.scoring && cp.scoring[w]) || 0;
  });
  State.citationScore = score;
  State.points += score;
  updateHud();
}

function answerQ3(qId, optIdx) {
  const p = State.scenario.phase3;
  const q = p.questions.find(x => x.id === qId);
  const opt = q.options[optIdx];
  State.q3Answers[qId] = {
    optIdx, correct: opt.correct, points: opt.points, feedback: tr(opt, 'feedback')
  };
  State.points += opt.points;
  updateHud();
  renderPhase3();
}

// ==================== RENDER: MEMO PHASE (Sim #02, optional; replaces citation+phase4) ====================
function computeMemoScore() {
  const mp = State.scenario.memo_phase;
  if (!mp) return { total: 0, rows: [], breach: false };
  const rows = [];
  let total = 0;
  let breach = false;
  // Subject
  const subj = (mp.subjects || []).find(s => s.id === State.memoSubject);
  if (subj) { rows.push({ lbl: LANG()==='en'?'Subject':'Тема', val: tr(subj,'text'), pts: subj.points || 0 }); total += (subj.points || 0); }
  else rows.push({ lbl: LANG()==='en'?'Subject':'Тема', val: '—', pts: 0 });
  // Evidence
  const ids = State.memoEvidence;
  const minSlots = mp.min_evidence_slots || 3;
  const maxSlots = mp.max_evidence_slots || 5;
  if (ids.length < minSlots) {
    const penalty = -20;
    rows.push({ lbl: LANG()==='en'?'Evidence':'Докази', val: LANG()==='en'?`Too few (${ids.length}/${minSlots} min)`:`Замало (${ids.length}/${minSlots} мін)`, pts: penalty });
    total += penalty;
  } else if (ids.length > maxSlots) {
    const penalty = -15;
    rows.push({ lbl: LANG()==='en'?'Evidence':'Докази', val: LANG()==='en'?`Too many (${ids.length}/${maxSlots} max)`:`Забагато (${ids.length}/${maxSlots} макс)`, pts: penalty });
    total += penalty;
  } else {
    const weightPts = mp.weight_points || { 5: 25, 4: 15, 3: 5, 2: -5, 1: -15 };
    let evPts = 0;
    ids.forEach(id => {
      const e = (mp.evidence_pool || []).find(x => x.id === id);
      if (e) evPts += (weightPts[e.weight] || 0);
    });
    rows.push({ lbl: LANG()==='en'?'Evidence':'Докази', val: `${ids.length} ${LANG()==='en'?'cards':'карток'}`, pts: evPts });
    total += evPts;
  }
  // Risk
  const riskPts = mp.risk_points || { low: -15, medium: -5, high: 20, critical: 10 };
  if (State.memoRisk) {
    const p = riskPts[State.memoRisk] || 0;
    rows.push({ lbl: LANG()==='en'?'Risk':'Ризик', val: State.memoRisk.toUpperCase(), pts: p });
    total += p;
  } else rows.push({ lbl: LANG()==='en'?'Risk':'Ризик', val: '—', pts: 0 });
  // Recommendation
  const rec = (mp.recommendations || []).find(r => r.id === State.memoRecommendation);
  if (rec) {
    rows.push({ lbl: LANG()==='en'?'Recommendation':'Рекомендація', val: tr(rec,'text'), pts: rec.points || 0, feedback: tr(rec,'feedback') });
    total += (rec.points || 0);
    if (rec.policy_breach) {
      breach = true;
      const bp = (mp.policy && mp.policy.breach_penalty) || -30;
      rows.push({ lbl: LANG()==='en'?'Policy Compliance':'Дотримання політики', val: LANG()==='en'?'❌ Breach':'❌ Порушено', pts: bp });
      total += bp;
    }
  } else rows.push({ lbl: LANG()==='en'?'Recommendation':'Рекомендація', val: '—', pts: 0 });
  return { total, rows, breach };
}
function renderMemoPhase() {
  const mp = State.scenario.memo_phase;
  if (!mp) {
    // fallback — go to legacy citation/phase4
    State.phase = 'citation'; renderCitationPhase(); return;
  }
  const isEn = LANG() === 'en';
  const title = tr(mp,'title') || (isEn ? 'Fill in the corporate memorandum' : 'Заповни корпоративний меморандум');
  const instr = tr(mp,'instruction') || (isEn
    ? 'Fill Subject / Evidence / Risk / Recommendation. Corporate Policy MUST be respected.'
    : 'Заповни Subject / Evidence / Risk / Recommendation. Політика компанії має бути дотримана.');
  const policyText = tr(mp.policy || {}, 'text') || '';
  const minSlots = mp.min_evidence_slots || 3;
  const maxSlots = mp.max_evidence_slots || 5;
  const submitLbl = tr(mp, 'submit_btn') || (isEn ? 'Submit Memo' : 'Подати меморандум');

  // Shuffle subject + recommendation each render (deterministic per case+nick)
  const seed = hashStr(State.scenario.id + '|memo|' + (State.nickname || ''));
  const subjects = seededShuffle(mp.subjects || [], seed);
  const recs     = seededShuffle(mp.recommendations || [], seed + 1);
  const pool     = seededShuffle(mp.evidence_pool || [], seed + 2);

  // Filter pool to exclude cards already dropped into zone (persist across re-renders)
  const inZone = new Set(State.memoEvidence);
  const zoneCards = State.memoEvidence.map(id => (mp.evidence_pool || []).find(e => e.id === id)).filter(Boolean);
  const poolCards = pool.filter(e => !inZone.has(e.id));

  const html = `
    ${progressBar('memo')}
    <div class="game-phase game-phase--memo">
      <div class="game-phase__head">
        <div class="game-phase__num">${State.scenario.timeline_phase ? '05 / 05' : '04 / 04'}</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(instr)}</p>
      </div>
      ${policyText ? `
        <div class="mb-policy">
          <span class="mb-policy__label">${isEn ? '📋 COMPANY POLICY (mandatory)' : '📋 ПОЛІТИКА КОМПАНІЇ (обовʼязково)'}</span>
          <div>${escapeHtml(policyText)}</div>
        </div>` : ''}

      <div class="mb-grid">
        <div class="mb-memo">
          <div class="mb-memo__header">
            <div>TO: <strong>${isEn ? 'Board of Directors' : 'Правління'}</strong></div>
            <div>FROM: <strong>${isEn ? 'Investigations Unit' : 'Розслідувальний підрозділ'}</strong></div>
            <div>DATE: <strong>${new Date().toISOString().slice(0, 10)}</strong></div>
            <div>RE: <strong>${escapeHtml(tr(State.scenario,'title'))}</strong></div>
          </div>

          <div class="mb-memo__section">
            <div class="mb-memo__label">${isEn ? 'Subject' : 'Тема (Subject)'}</div>
            <select class="mb-select" id="mb-subject">
              <option value="">— ${isEn ? 'Choose…' : 'Обери…'} —</option>
              ${subjects.map(s => `<option value="${escapeHtml(s.id)}"${State.memoSubject === s.id ? ' selected' : ''}>${escapeHtml(tr(s,'text'))}</option>`).join('')}
            </select>
          </div>

          <div class="mb-memo__section">
            <div class="mb-memo__label">${isEn ? `Key Evidence (drag ${minSlots}–${maxSlots} items from the pool)` : `Ключові докази (перетягни ${minSlots}–${maxSlots} карток з пулу)`}</div>
            <div class="mb-dropzone" id="mb-evidence-zone" data-placeholder="${isEn ? 'drag evidence cards here…' : 'перетягни картки-докази сюди…'}">
              ${zoneCards.map(e => `<div class="mb-card" data-id="${escapeHtml(e.id)}" data-weight="${e.weight}"><div>${escapeHtml(tr(e,'text'))}</div></div>`).join('')}
            </div>
          </div>

          <div class="mb-memo__section">
            <div class="mb-memo__label">${isEn ? 'Risk Assessment' : 'Оцінка ризику'}</div>
            <div class="mb-risk" id="mb-risk">
              ${['low','medium','high','critical'].map(lvl => `
                <button class="mb-risk__btn${State.memoRisk === lvl ? ' mb-risk__btn--active' : ''}" data-level="${lvl}">${lvl.charAt(0).toUpperCase() + lvl.slice(1)}</button>
              `).join('')}
            </div>
          </div>

          <div class="mb-memo__section">
            <div class="mb-memo__label">${isEn ? 'Recommendation' : 'Рекомендація'}</div>
            <select class="mb-select" id="mb-recommendation">
              <option value="">— ${isEn ? 'Choose…' : 'Обери…'} —</option>
              ${recs.map(r => `<option value="${escapeHtml(r.id)}"${State.memoRecommendation === r.id ? ' selected' : ''}>${escapeHtml(tr(r,'text'))}</option>`).join('')}
            </select>
          </div>
        </div>

        <div>
          <div class="mb-pool">
            <div class="mb-pool__head">${isEn ? 'Evidence pool (drag into Memo)' : 'Пул доказів (перетягуй у меморандум)'}</div>
            <div class="mb-pool__list" id="mb-pool-list">
              ${poolCards.map(e => `<div class="mb-card" data-id="${escapeHtml(e.id)}" data-weight="${e.weight}"><div>${escapeHtml(tr(e,'text'))}</div></div>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="game-phase__foot" style="margin-top:1.5rem">
        <div class="mb-live-hint" id="mb-live-hint" style="font-family:var(--font-mono);font-size:.8rem;color:var(--text-mute)"></div>
        <button class="btn btn--filled" id="btn-memo-submit">${escapeHtml(submitLbl)}</button>
      </div>
    </div>`;

  $('#game-root').innerHTML = html;
  fadeInRoot();
  if (typeof renderHelpPanel === 'function') renderHelpPanel();

  // Init SortableJS on both zone + pool
  if (typeof Sortable === 'undefined') {
    console.warn('SortableJS not loaded — memo phase falling back to phase4');
    State.phase = 'phase4'; renderPhase4(); return;
  }
  const zone = document.getElementById('mb-evidence-zone');
  const pool2 = document.getElementById('mb-pool-list');
  const sortableOpts = {
    group: { name: 'memo-cards', pull: true, put: true },
    animation: 180,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    touchStartThreshold: 3,
    onSort: () => { State.memoEvidence = [...zone.querySelectorAll('.mb-card')].map(c => c.dataset.id); updateMemoHint(); }
  };
  const sortableZone = Sortable.create(zone, sortableOpts);
  const sortablePool = Sortable.create(pool2, sortableOpts);

  // Wire form
  document.getElementById('mb-subject').addEventListener('change', (e) => { State.memoSubject = e.target.value; updateMemoHint(); });
  document.getElementById('mb-recommendation').addEventListener('change', (e) => { State.memoRecommendation = e.target.value; updateMemoHint(); });
  document.querySelectorAll('.mb-risk__btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.mb-risk__btn').forEach(x => x.classList.remove('mb-risk__btn--active'));
      b.classList.add('mb-risk__btn--active');
      State.memoRisk = b.dataset.level;
      updateMemoHint();
    });
  });

  document.getElementById('btn-memo-submit').addEventListener('click', () => submitMemo(sortableZone, sortablePool));
  updateMemoHint();
}
function updateMemoHint() {
  const el = document.getElementById('mb-live-hint');
  if (!el) return;
  const mp = State.scenario.memo_phase;
  const min = mp.min_evidence_slots || 3;
  const max = mp.max_evidence_slots || 5;
  const isEn = LANG() === 'en';
  const problems = [];
  if (!State.memoSubject) problems.push(isEn ? 'Subject' : 'Тема');
  if (State.memoEvidence.length < min) problems.push(isEn ? `Evidence (${State.memoEvidence.length}/${min})` : `Докази (${State.memoEvidence.length}/${min})`);
  if (State.memoEvidence.length > max) problems.push(isEn ? `Evidence overflow (>${max})` : `Доказів забагато (>${max})`);
  if (!State.memoRisk) problems.push(isEn ? 'Risk' : 'Ризик');
  if (!State.memoRecommendation) problems.push(isEn ? 'Recommendation' : 'Рекомендація');
  if (problems.length === 0) {
    el.textContent = isEn ? '✓ Memo is ready — you can submit.' : '✓ Меморандум готовий — можна подавати.';
    el.style.color = '#7dc98a';
  } else {
    el.textContent = (isEn ? 'Missing: ' : 'Не заповнено: ') + problems.join(', ');
    el.style.color = 'var(--text-mute)';
  }
}
async function submitMemo(sortableZone, sortablePool) {
  if (State.memoSubmitted) return;
  const mp = State.scenario.memo_phase;
  const min = mp.min_evidence_slots || 3;
  if (!State.memoSubject || State.memoEvidence.length < min || !State.memoRisk || !State.memoRecommendation) {
    updateMemoHint();
    return;
  }
  State.memoSubmitted = true;
  State.ended = true;
  stopTimer();

  const { total, rows, breach } = computeMemoScore();
  State.memoPoints = total;
  State.memoPolicyBreach = breach;
  State.points += total;

  // The chosen recommendation defines "verdict correctness" for cooldown / unlock / cert
  const rec = (mp.recommendations || []).find(r => r.id === State.memoRecommendation);
  const isCorrect = !!(rec && rec.correct);
  State.finalVerdict = {
    id: rec?.id || 'memo',
    verdict: isCorrect ? 'success' : 'fail',
    correct: isCorrect,
    label_uk: (rec && (rec.text_uk || rec.text)) || 'Memo',
    label_en: (rec && (rec.text_en || rec.text)) || 'Memo',
    feedback_uk: (rec && rec.feedback_uk) || '',
    feedback_en: (rec && rec.feedback_en) || '',
    points: total,
    _memo: { rows, breach }
  };

  // Cooldown + unlock (same rules as phase4)
  const s = State.scenario;
  if (!isCorrect || State.points < 100) setCooldown(s.id, s.cooldown_sec);
  else clearCooldown(s.id);
  if (isCorrect) localStorage.setItem('ss.completed.' + s.id, '1');

  // Time bonus if correct
  const timeUsed = s.time_limit_sec - State.timeLeft;
  const timeFraction = timeUsed / s.time_limit_sec;
  let timeBonus = 0;
  if (isCorrect) {
    if (timeFraction < 0.35) timeBonus = 60;
    else if (timeFraction < 0.55) timeBonus = 35;
    else if (timeFraction < 0.75) timeBonus = 15;
  }
  State.points += timeBonus;

  track('game-memo-submit', { total, breach, correct: isCorrect, evidence_count: State.memoEvidence.length });
  track(isCorrect ? 'game-completed' : 'game-failed', { verdict: rec?.id, points: Math.max(0, State.points) });

  showResult({ verdict: State.finalVerdict, timeBonus, submitted: false });

  if (State.nickname && !State.isDemo) {
    const res = await submitScore(State.nickname, State.points, s.id, isCorrect);
    showResult({ verdict: State.finalVerdict, timeBonus, submitted: true, submitResult: res });
  }
}

// ==================== RENDER: PHASE 4 (VERDICT) ====================
function renderPhase4() {
  const p = State.scenario.phase4;
  if (!State.verdictOrder.length) {
    const seed = hashStr(State.nickname + State.startedAt + 'verdict');
    State.verdictOrder = seededShuffle(p.options.map((_, i) => i), seed);
  }
  const optHtml = State.verdictOrder.map(i => p.options[i]).map((opt) => `
    <button class="verdict-opt verdict-opt--${opt.id}" data-verdict="${opt.id}">
      <div class="verdict-opt__label">${escapeHtml(tr(opt,'label'))}</div>
    </button>`).join('');
  const html = `
    ${progressBar('phase4')}
    <div class="game-phase game-phase--verdict">
      <div class="game-phase__head">
        <div class="game-phase__num">04 / 04</div>
        <h2>${escapeHtml(tr(p,'title'))}</h2>
        <p>${escapeHtml(tr(p,'instruction'))}</p>
      </div>
      <div class="verdict-grid">${optHtml}</div>
    </div>`;
  $('#game-root').innerHTML = html;
  fadeInRoot();
  if (typeof renderHelpPanel === 'function') renderHelpPanel();
  $('#game-root').querySelectorAll('.verdict-opt').forEach(btn => {
    btn.addEventListener('click', () => submitVerdict(btn.dataset.verdict));
  });
}
async function submitVerdict(verdictId) {
  const p = State.scenario.phase4;
  const opt = p.options.find(x => x.id === verdictId);
  State.points += opt.points;
  State.finalVerdict = opt;
  State.ended = true;
  stopTimer();
  track('game-verdict', { verdict: verdictId, correct: !!opt.correct, points: State.points });
  track(opt.correct ? 'game-completed' : 'game-failed', { verdict: verdictId, points: Math.max(0, State.points) });

  // Tiered time bonus — fast+correct gets much more than slow+correct
  const s = State.scenario;
  const timeUsed = s.time_limit_sec - State.timeLeft;
  const timeFraction = timeUsed / s.time_limit_sec;
  let timeBonus = 0;
  if (opt.correct) {
    if (timeFraction < 0.35) timeBonus = 60;      // under 35% of budget = huge
    else if (timeFraction < 0.55) timeBonus = 35; // decent pace
    else if (timeFraction < 0.75) timeBonus = 15; // acceptable
    // else 0 — took too long
  }
  State.points += timeBonus;

  // Set cooldown if fail
  if (opt.verdict === 'fail' || State.points < 100) {
    setCooldown(s.id, s.cooldown_sec);
  } else {
    clearCooldown(s.id);
  }

  // Mark case as completed if correct verdict — unlocks next case in sequence
  // Demo doesn't count toward progress
  if (opt.correct && !State.isDemo) {
    localStorage.setItem('ss.completed.' + s.id, '1');
  }

  showResult({ verdict: opt, timeBonus, submitted: false });

  // Submit to Firebase (skip in demo mode)
  if (State.nickname && !State.isDemo) {
    const res = await submitScore(State.nickname, State.points, s.id, !!opt.correct);
    showResult({ verdict: opt, timeBonus, submitted: true, submitResult: res });
  }
}

// ==================== RENDER: RESULT ====================
function calcRank(points) {
  const rs = State.scenario.ranks;
  for (const k of ['master', 'senior', 'junior', 'trainee']) {
    if (points >= rs[k].min) return { key: k, ...rs[k] };
  }
  return { key: 'trainee', ...rs.trainee };
}
function showResult({ verdict = null, timeBonus = 0, submitted = false, submitResult = null, timedOut = false }) {
  const s = State.scenario;
  const points = Math.max(0, State.points);
  const rank = calcRank(points);
  const timeUsed = s.time_limit_sec - Math.max(0, State.timeLeft);
  const cd = getCooldownRemaining(s.id);
  const cdRow = cd > 0
    ? `<div class="result__cooldown">⏳ ${LANG()==='en'?'Cooldown':'Кулдаун'} ${fmtTime(cd)} ${LANG()==='en'?'before you can replay this case':'до наступної спроби цього кейсу'}</div>` : '';
  const timeoutRow = timedOut
    ? `<div class="result__timeout">⏰ ${LANG()==='en'?'Time is up. Verdict was not submitted.':'Час вичерпано. Вердикт не подано.'}</div>` : '';
  const verdictRow = verdict ? `
    <div class="result__verdict result__verdict--${verdict.verdict}">
      <div class="result__verdict-label">${escapeHtml(tr(verdict,'label'))}</div>
      <div class="result__verdict-fb">${escapeHtml(tr(verdict,'feedback'))}</div>
    </div>` : '';
  // On FAIL — show the correct verdict + its explanation right up top
  let lessonRow = '';
  if (verdict && !verdict.correct) {
    const correctOpt = (s.phase4?.options || []).find(o => o.correct && (o.points || 0) > 0);
    if (correctOpt) {
      lessonRow = `
        <div class="result__lesson">
          <div class="result__lesson-head">🎯 ${LANG()==='en' ? 'The correct verdict was' : 'Правильний вердикт був'}: <strong>${escapeHtml(tr(correctOpt,'label'))}</strong></div>
          <div class="result__lesson-fb">${escapeHtml(tr(correctOpt,'feedback'))}</div>
        </div>`;
    }
  }
  const submitRow = submitted && submitResult && submitResult.ok
    ? `<div class="result__submit result__submit--ok">✓ ${LANG()==='en'?'Score submitted to global leaderboard':'Очки відправлено у глобальний leaderboard'}. ${LANG()==='en'?'Total':'Всього'}: <strong>${submitResult.total}</strong> pts</div>`
    : submitted ? `<div class="result__submit result__submit--err">⚠️ ${LANG()==='en'?'Could not submit — check console':'Не вдалося відправити — див. консоль'}</div>`
    : `<div class="result__submit result__submit--pending">${LANG()==='en'?'Submitting to leaderboard…':'Відправка у leaderboard…'}</div>`;
  const html = `
    <div class="result">
      <div class="result__pre">${LANG()==='en'?'CASE COMPLETED':'КЕЙС ЗАВЕРШЕНО'}</div>
      <h2 class="result__title">${escapeHtml(tr(s,'title'))}</h2>
      ${timeoutRow}
      ${verdictRow}
      ${lessonRow}
      <div class="result__score">
        <div class="result__score-num">${points} <span>pts</span></div>
        <div class="result__rank" style="color:${rank.color}">${escapeHtml(tr(rank,'label'))}</div>
        <div class="result__rank-msg">${escapeHtml(tr(rank,'msg'))}</div>
      </div>
      <div class="result__stats">
        <div><span>${LANG()==='en'?'Tools used':'Інструментів'}</span><strong>${Object.keys(State.toolsUsed).length}</strong></div>
        <div><span>${LANG()==='en'?'Questions answered':'Питань'}</span><strong>${Object.keys(State.q3Answers).length}/3</strong></div>
        <div><span>${LANG()==='en'?'Time used':'Часу'}</span><strong>${fmtTime(timeUsed)}</strong></div>
        <div><span>${LANG()==='en'?'Time bonus':'Бонус за час'}</span><strong>+${timeBonus}</strong></div>
      </div>
      ${cdRow}
      ${pivotChainHtml()}
      ${State.nickname ? submitRow : ''}
      <div class="result__share">
        <button class="btn" id="btn-share">📤 ${LANG()==='en'?'Share result':'Поділитись результатом'}</button>
      </div>
      <div class="result__actions">
        <a href="simulator.html" class="btn btn--filled">← ${LANG()==='en'?'Back to Simulator':'До Симулятора'}</a>
        <a href="simulator.html#leaderboard" class="btn">🏆 Leaderboard</a>
      </div>
    </div>`;
  $('#game-root').innerHTML = html;
  fadeInRoot();
  if (typeof renderHelpPanel === 'function') renderHelpPanel();
  scrollTop();
  const shareBtn = $('#btn-share');
  if (shareBtn) shareBtn.addEventListener('click', () => shareResult(points, rank, tr(s,'title')));
}

function pivotChainHtml() {
  const positive = State.toolResults.filter(r => r.correct && r.points > 0);
  const negative = State.toolResults.filter(r => !r.correct || r.points < 0);
  const q3Rev = renderQ3Review();
  const citeRev = renderCitationReview();
  if (positive.length === 0 && negative.length === 0 && !q3Rev && !citeRev) return '';
  const weightBadge = (w) => {
    const map = {
      diagnostic: { l: 'DIAGNOSTIC', c: '#7fd6ff' },
      supporting: { l: 'SUPPORTING', c: '#a3e6a3' },
      noise:      { l: 'NOISE',      c: '#a67c52' },
      decoy:      { l: 'DECOY',      c: '#ff5a5a' }
    };
    return map[w] || map.supporting;
  };
  const tools = State.scenario.phase2.tools;
  const titleUk = '🧭 Pivot-Chain — твої підтверджені сигнали';
  const titleEn = '🧭 Pivot-Chain — your confirmed signals';
  const rows = positive.map((r, i) => {
    const tool = tools.find(t => tr(t,'name') === r.tool);
    const wt = weightBadge(tool?.weight || 'supporting');
    return `
      <li class="pivot__row">
        <div class="pivot__num">${String(i+1).padStart(2,'0')}</div>
        <div class="pivot__body">
          <div class="pivot__tool">${escapeHtml(r.tool)}</div>
          <div class="pivot__clue">${escapeHtml(r.clue)}</div>
        </div>
        <div class="pivot__conf" style="color:${wt.c};border-color:${wt.c}">${wt.l}</div>
      </li>`;
  }).join('');
  const negRows = negative.length ? `
    <div class="pivot__neg-title">${LANG()==='en'?'⚠️ Wasted moves':'⚠️ Марні ходи'}</div>
    <ul class="pivot__list pivot__list--neg">${negative.map(r => `
      <li class="pivot__row pivot__row--neg">
        <div class="pivot__body">
          <div class="pivot__tool">${escapeHtml(r.tool)}</div>
          <div class="pivot__clue">${escapeHtml(r.clue)}</div>
        </div>
        <div class="pivot__conf pivot__conf--neg">-${Math.abs(r.points)} pts</div>
      </li>`).join('')}</ul>` : '';
  return `
    <div class="pivot">
      <h3 class="pivot__title">${LANG()==='en'?titleEn:titleUk}</h3>
      ${positive.length ? `<ul class="pivot__list">${rows}</ul>` : ''}
      ${negRows}
      ${citeRev}
      ${q3Rev}
    </div>`;
}

function renderCitationReview() {
  if (!State.citations.length) return '';
  const cp = State.scenario.citation_phase;
  if (!cp) return '';
  const tools = State.scenario.phase2.tools;
  const scoring = cp.scoring || {};
  const rows = State.citations.map(tid => {
    const t = tools.find(x => x.id === tid);
    if (!t) return '';
    const w = t.weight || 'supporting';
    const pts = scoring[w] || 0;
    const cls = pts > 0 ? 'ok' : (pts < 0 ? 'bad' : 'neu');
    const wLabel = { diagnostic:'DIAGNOSTIC', supporting:'SUPPORTING', noise:'NOISE', decoy:'DECOY' }[w] || w.toUpperCase();
    return `
      <li class="cite-review cite-review--${cls}">
        <div class="cite-review__name">${t.icon} ${escapeHtml(tr(t,'name'))}</div>
        <div class="cite-review__meta"><span class="cite-review__weight cite-review__weight--${w}">${wLabel}</span> <strong>${pts>0?'+':''}${pts} pts</strong></div>
      </li>`;
  }).join('');
  const totalPts = State.citationScore;
  const totalCls = totalPts > 0 ? 'ok' : (totalPts < 0 ? 'bad' : 'neu');
  return `
    <div class="pivot__cite-title">${LANG()==='en'?'📋 Your citations (Phase 3.5)':'📋 Твої цитати (Фаза 3.5)'}</div>
    <ul class="pivot__cite-list">${rows}</ul>
    <div class="pivot__cite-total pivot__cite-total--${totalCls}">${LANG()==='en'?'Citation score':'Оцінка цитат'}: <strong>${totalPts>0?'+':''}${totalPts} pts</strong></div>`;
}

function renderQ3Review() {
  const p = State.scenario.phase3;
  if (!p) return '';
  const rows = p.questions.map((q, i) => {
    const ans = State.q3Answers[q.id];
    if (!ans) return '';
    const chosen = q.options[ans.optIdx];
    const correct = q.options.find(o => o.correct);
    const cls = ans.correct ? 'pivot__q pivot__q--ok' : 'pivot__q pivot__q--bad';
    const feedback = ans.correct
      ? `<div class="pivot__q-fb pivot__q-fb--ok">${escapeHtml(ans.feedback)}</div>`
      : `<div class="pivot__q-fb pivot__q-fb--bad">${escapeHtml(ans.feedback)}</div>
         <div class="pivot__q-correct"><strong>${LANG()==='en'?'Correct answer would have been':'Правильна відповідь була б'}:</strong> ${escapeHtml(tr(correct,'text'))}</div>`;
    return `
      <li class="${cls}">
        <div class="pivot__q-num">Q${i+1}</div>
        <div class="pivot__q-body">
          <div class="pivot__q-text">${escapeHtml(tr(q,'text'))}</div>
          <div class="pivot__q-yours"><span>${LANG()==='en'?'Your answer':'Твоя відповідь'}:</span> ${escapeHtml(tr(chosen,'text'))} <strong>(${ans.points > 0 ? '+' : ''}${ans.points} pts)</strong></div>
          ${feedback}
        </div>
      </li>`;
  }).filter(Boolean).join('');
  if (!rows) return '';
  return `
    <div class="pivot__q-title">${LANG()==='en'?'📝 Verification review':'📝 Розбір верифікації'}</div>
    <ul class="pivot__q-list">${rows}</ul>`;
}

function shareResult(points, rank, caseTitle) {
  const url = 'https://yehorselin.com/simulator.html';
  const text = LANG()==='en'
    ? `I scored ${points} pts (${rank.label_en || rank.label}) on Shadow Simulator · ${caseTitle}. Test your OSINT skills 👇`
    : `Пройшов ${caseTitle} у Shadow Simulator · ${points} pts (${rank.label_uk || rank.label}). Перевір свої OSINT-навички 👇`;
  const shareData = { title: 'Shadow Simulator', text, url };
  if (navigator.share) {
    navigator.share(shareData).catch(() => copyShareText(text + '\n' + url));
  } else {
    copyShareText(text + '\n' + url);
  }
}
function copyShareText(txt) {
  navigator.clipboard.writeText(txt).then(() => {
    const btn = $('#btn-share');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = LANG()==='en' ? '✓ Copied — paste in LinkedIn/X' : '✓ Скопійовано — вставляй у LinkedIn/X';
      setTimeout(() => { btn.textContent = orig; }, 3000);
    }
  }).catch(() => alert(txt));
}

// ==================== HUD ====================
function updateHud() {
  const pts = $('#hud-points');
  if (pts) pts.textContent = Object.keys(State.toolsUsed).length;
}

function renderCooldownScreen(sec) {
  const html = `
    <div class="cooldown-screen">
      <div class="cooldown-screen__icon">⏳</div>
      <h2>${LANG()==='en'?'Cooldown active':'Активний кулдаун'}</h2>
      <p>${LANG()==='en'?'You failed the last attempt of this case. You can retry after':'Ти провалив попередню спробу цього кейсу. Наступна спроба буде доступна через'}:</p>
      <div class="cooldown-screen__timer" id="cd-timer">${fmtTime(sec)}</div>
      <p class="cooldown-screen__hint">${LANG()==='en'?'Take a break — read the guide, try another simulator when it opens.':'Візьми паузу — прочитай гайд, спробуй інший симулятор (коли відкриється).'}</p>
      <a href="simulator.html" class="btn">← ${LANG()==='en'?'Back to Simulator':'До Симулятора'}</a>
    </div>`;
  $('#game-root').innerHTML = html;
  const el = $('#cd-timer');
  const iv = setInterval(() => {
    const r = getCooldownRemaining(State.scenario.id);
    if (r <= 0) { clearInterval(iv); location.reload(); }
    else if (el) el.textContent = fmtTime(r);
  }, 1000);
}

// ==================== HUD MOUNT ====================
function mountHud() {
  const hud = document.createElement('div');
  hud.className = 'game-hud';
  hud.innerHTML = `
    <div class="game-hud__cell"><span>${LANG()==='en'?'Agent':'Агент'}</span><strong>${escapeHtml(State.nickname || '—')}</strong></div>
    <div class="game-hud__cell"><span>${LANG()==='en'?'Case':'Кейс'}</span><strong>${escapeHtml(tr(State.scenario,'title'))}</strong></div>
    <div class="game-hud__cell game-hud__cell--score"><span>${LANG()==='en'?'Tools':'Тулів'}</span><strong id="hud-points">${Object.keys(State.toolsUsed).length}</strong></div>
    <div class="game-hud__cell game-hud__cell--time"><span>${LANG()==='en'?'Time':'Час'}</span><strong id="hud-time">${fmtTime(State.timeLeft)}</strong></div>`;
  const root = $('#game-root');
  root.parentNode.insertBefore(hud, root);
}

// ==================== ANALYTICS ====================
function track(event, data = {}) {
  try {
    if (window.umami && typeof window.umami.track === 'function') {
      const payload = { case_id: State.scenario?.id || 'unknown', ...data };
      window.umami.track(event, payload);
    }
  } catch (_) { /* silent */ }
}

// ==================== INIT ====================
async function init() {
  const params = new URLSearchParams(location.search);
  const caseId = params.get('case') || 'fake-cfo';
  State.isDemo = params.get('demo') === '1';
  // Load scenario
  try {
    const res = await fetch(`content/simulator/${caseId}.json?t=${Date.now()}`, { cache: 'no-store' });
    State.scenario = await res.json();
  } catch (e) {
    $('#game-root').innerHTML = `<div class="game-error">Не вдалося завантажити сценарій: ${escapeHtml(e.message)}</div>`;
    return;
  }
  // Demo mode: double timer, anonymous, no leaderboard submit
  State.timeLeft = State.isDemo
    ? Math.round((State.scenario.time_limit_sec || 720) * 2)
    : State.scenario.time_limit_sec;
  // Nickname — demo allowed anonymous
  const nick = getNickname();
  if (!nick && !State.isDemo) {
    location.href = 'simulator.html';
    return;
  }
  State.nickname = nick || (State.isDemo ? 'DEMO' : '');
  // Demo ribbon
  if (State.isDemo) {
    const ribbon = document.createElement('div');
    ribbon.className = 'demo-ribbon';
    ribbon.innerHTML = (LANG() === 'en'
      ? '🎓 DEMO MODE · scores are not saved · double time · <a href="simulator.html">exit</a>'
      : '🎓 ДЕМО-РЕЖИМ · очки не зберігаються · подвійний час · <a href="simulator.html">вийти</a>');
    document.body.appendChild(ribbon);
  }
  // Live re-render on language toggle — install BEFORE any early-return
  // so cooldown/briefing/all phases pick up lang switches.
  document.addEventListener('langchange', () => {
    // Re-mount HUD if it's on the page (skipped on cooldown screen where no HUD)
    const oldHud = document.querySelector('.game-hud');
    if (oldHud) {
      oldHud.remove();
      mountHud();
      const el = document.getElementById('hud-time');
      if (el) el.textContent = fmtTime(Math.max(0, State.timeLeft));
    }
    // Re-render current phase
    if (State.phase === 'briefing') renderBriefing();
    else if (State.phase === 'phase2') renderPhase2();
    else if (State.phase === 'timeline') renderTimelinePhase();
    else if (State.phase === 'phase3') renderPhase3();
    else if (State.phase === 'citation') renderCitationPhase();
    else if (State.phase === 'memo') renderMemoPhase();
    else if (State.phase === 'phase4') renderPhase4();
    else if (State.phase === 'result') showResult({ verdict: State.finalVerdict });
    else if (State.phase === 'cooldown') {
      const cd = getCooldownRemaining(State.scenario.id);
      renderCooldownScreen(cd);
    }
    // Re-render help panel with new lang (if mounted)
    if (typeof renderHelpPanel === 'function') renderHelpPanel();
  });

  // Cooldown check
  const cd = getCooldownRemaining(State.scenario.id);
  if (cd > 0) {
    State.phase = 'cooldown';
    renderCooldownScreen(cd);
    return;
  }
  // Mount HUD + help panel + render briefing
  mountHud();
  mountHelpPanel();
  State.phase = 'briefing';
  renderBriefing();
  renderHelpPanel();
  track('game-briefing-open');
}
init();

// ==================== HELP PANEL (how to play, per-phase) ====================
const HELP = {
  briefing: {
    uk: {
      title: 'Брифінг',
      intro: 'Ти OSINT-скринер. Клієнт (HR / compliance / служба безпеки) питає: чи можна довіряти цій людині? Твоя робота — дослідити її через фейкові тули (соцмережі, реєстри, витоки) і винести ВЕРДИКТ: <strong>APPROVE</strong> (взяти) · <strong>REJECT</strong> (відмовити) · <strong>INSUFFICIENT</strong> (мало даних) · <strong>ESCALATE</strong> (передати вище). Гра — 5 кейсів різного профілю.',
      steps: [
        'Прочитай завдання клієнта уважно — тут вся вихідна інформація.',
        'Зверни увагу на: фото кандидата, ПІБ, email, телефон, роль, зарплату, компанію.',
        'Клікни ▶ Розпочати коли готовий — таймер піде.',
        'Час — це очки: чим швидше пройдеш при правильному вердикті, тим більше бонус.'
      ]
    },
    en: {
      title: 'Briefing',
      intro: 'You are an OSINT screener. A client (HR / compliance / security) asks: can we trust this person? Your job — investigate them via fake tools (social, registries, leaks) and deliver a VERDICT: <strong>APPROVE</strong> (hire) · <strong>REJECT</strong> (decline) · <strong>INSUFFICIENT</strong> (not enough data) · <strong>ESCALATE</strong> (kick upstairs). The game — 5 cases of different profiles.',
      steps: [
        'Read the client brief carefully — all baseline info is here.',
        'Note: candidate photo, full name, email, phone, role, salary, company.',
        'Click ▶ Start when ready — timer begins.',
        'Time = points: faster + correct verdict = larger bonus.'
      ]
    }
  },
  phase2: {
    uk: {
      title: 'Фаза 2 · Розслідування',
      steps: [
        'Обирай тули що дадуть тобі докази для вердикту.',
        'Наведи на ⓘ на картці тула → зʼявиться опис що робить цей тул.',
        'КОЖЕН клік коштує часу (показано під картинкою тула).',
        'Не всі тули корисні у кожному кейсі — деякі є NOISE, деякі DECOY.',
        'YouControl показує WARNING перед кліком — читай уважно.',
        'Фото у результатах можна ЗБІЛЬШИТИ — клац на нього.',
        'Мінімум 4-7 тулів (залежно від кейсу) щоб перейти далі.'
      ]
    },
    en: {
      title: 'Phase 2 · Investigation',
      steps: [
        'Pick tools that give you evidence for the verdict.',
        'Hover on ⓘ on a tool card → tooltip explains what the tool does.',
        'EACH click costs time (shown below tool icon).',
        'Not every tool is useful in every case — some are NOISE, some DECOY.',
        'YouControl shows a WARNING before commit — read it.',
        'Match photos can be ENLARGED — click on any thumbnail.',
        'Minimum 4-7 tools (depends on case) to proceed.'
      ]
    }
  },
  phase3: {
    uk: {
      title: 'Фаза 3 · Крос-верифікація',
      steps: [
        '3 питання за знайденими доказами.',
        'Читай ВСІ варіанти — правильний часто НЕ найдраматичніший.',
        'Порядок варіантів рандомізовано — читай СЕНС, не позицію.',
        'Розбір з правильними відповідями буде у ФІНАЛІ, не одразу.',
        'Кожна відповідь дає ±очки. Погана відповідь мінусує.'
      ]
    },
    en: {
      title: 'Phase 3 · Cross-verification',
      steps: [
        '3 questions based on your findings.',
        'Read ALL options — the correct one is often NOT the most dramatic.',
        'Option order is randomized — read MEANING, not position.',
        'Review with correct answers comes at the END, not immediately.',
        'Each answer gives ± points. Wrong answer subtracts.'
      ]
    }
  },
  citation: {
    uk: {
      title: 'Фаза 3.5 · Обґрунтування',
      steps: [
        'Обери 3 знахідки що НАЙБІЛЬШЕ вплинули на твій вердикт.',
        'Оцінка: DIAGNOSTIC +15 · SUPPORTING +5 · NOISE -3 · DECOY -10',
        'Уявляй що пишеш compliance-меморандум: клієнт прочитає САМЕ ці 3.',
        'Не обирай тули які не використовував — не рахуються.'
      ]
    },
    en: {
      title: 'Phase 3.5 · Source Citation',
      steps: [
        'Pick 3 findings that MOST drove your verdict.',
        'Scoring: DIAGNOSTIC +15 · SUPPORTING +5 · NOISE -3 · DECOY -10',
        'Imagine writing a compliance memo: the client will read THESE 3.',
        'Don\'t pick tools you didn\'t use — won\'t count.'
      ]
    }
  },
  phase4: {
    uk: {
      title: 'Фаза 4 · Фінальний вердикт',
      steps: [
        'Твоє фінальне рішення для клієнта.',
        'НЕМАЄ «безпечного» вердикту: INSUFFICIENT теж штрафується.',
        'Приймай рішення на основі того що ти РЕАЛЬНО знайшов.',
        'Для defense-кейсів REJECT недостатньо — потрібна ескалація.',
        'Розбір, точки, ранг і сертифікат — на наступному екрані.'
      ]
    },
    en: {
      title: 'Phase 4 · Final Verdict',
      steps: [
        'Your final decision for the client.',
        'NO «safe» verdict: INSUFFICIENT is also penalized.',
        'Decide based on what you ACTUALLY found.',
        'For defense cases REJECT alone is not enough — escalation required.',
        'Review, points, rank and certificate — on next screen.'
      ]
    }
  },
  result: {
    uk: {
      title: 'Результат',
      steps: [
        'Дивись Pivot-Chain — які знахідки були DIAGNOSTIC vs NOISE.',
        'Читай розбір Q3 — де помилився і чому.',
        'Прогрес до сертифіката: 1000+ pts + 5 кейсів = розблокує.',
        'Провал → 1 година кулдаун на цей кейс. Наступний доступний.',
        'Клац Share щоб поділитись результатом.'
      ]
    },
    en: {
      title: 'Result',
      steps: [
        'Review Pivot-Chain — which findings were DIAGNOSTIC vs NOISE.',
        'Read Q3 review — where you erred and why.',
        'Cert progress: 1000+ pts + 5 cases = unlocks certificate.',
        'Fail → 1 hour cooldown on this case. Next one available.',
        'Click Share to share your result.'
      ]
    }
  }
};

const HELP_GLOSSARY = {
  uk: {
    title: 'Словник термінів',
    items: [
      ['DIAGNOSTIC', 'ключовий доказ — саме він мав вплинути на вердикт (+15 при цитуванні).'],
      ['SUPPORTING', 'підтверджуючий факт — не вирішальний, але у копилку (+5).'],
      ['NOISE', 'шум — тул спрацював, але результат до кейсу не стосується (-3 якщо цитуєш).'],
      ['DECOY', 'пастка — виглядає як доказ, але веде не туди. Не цитуй (-10).'],
      ['Pivot-Chain', 'ланцюжок «від тула до тула»: кожна знахідка веде до наступного кроку.'],
      ['Defense-кейс', 'кейс де погроза = розвідка/зрада. Просто REJECT мало — треба ESCALATE (передати профільній службі).'],
      ['Compliance', 'юридична/безпекова відповідність. Твій вердикт — це меморандум який клієнт покаже юристу.']
    ]
  },
  en: {
    title: 'Glossary',
    items: [
      ['DIAGNOSTIC', 'key evidence — the one that should drive the verdict (+15 when cited).'],
      ['SUPPORTING', 'confirming fact — not decisive, but helpful (+5).'],
      ['NOISE', 'noise — tool returned data but irrelevant to the case (-3 if cited).'],
      ['DECOY', 'trap — looks like evidence but leads nowhere. Do not cite (-10).'],
      ['Pivot-Chain', 'the "tool-to-tool" chain: each finding points to the next step.'],
      ['Defense case', 'case where the threat = espionage/betrayal. Plain REJECT is not enough — ESCALATE (kick to the proper agency).'],
      ['Compliance', 'legal / security compliance. Your verdict = a memo the client will hand to a lawyer.']
    ]
  }
};

function renderHelpPanel() {
  const phase = State.phase || 'briefing';
  const key = ['briefing','phase2','phase3','citation','phase4','result'].includes(phase) ? phase : 'briefing';
  const content = HELP[key][LANG()] || HELP[key].uk;
  const gloss = HELP_GLOSSARY[LANG()] || HELP_GLOSSARY.uk;
  const panel = document.getElementById('help-panel');
  if (panel) {
    panel.querySelector('.help-panel__title').textContent = content.title;
    const introHtml = content.intro ? `<div class="help-panel__intro">${content.intro}</div>` : '';
    const stepsHtml = `<ol class="help-panel__list">${content.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`;
    const glossHtml = `<div class="help-panel__gloss"><h4 class="help-panel__gloss-title">${escapeHtml(gloss.title)}</h4><dl class="help-panel__gloss-list">${gloss.items.map(([term, def]) => `<div class="help-panel__gloss-row"><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(def)}</dd></div>`).join('')}</dl></div>`;
    panel.querySelector('.help-panel__content').innerHTML = introHtml + stepsHtml + glossHtml;
  }
  const label = document.getElementById('help-btn-label');
  if (label) label.textContent = LANG() === 'en' ? 'How to play' : 'Як грати';
}

function mountHelpPanel() {
  if (document.getElementById('help-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'help-panel';
  panel.className = 'help-panel';
  panel.innerHTML = `
    <div class="help-panel__body">
      <div class="help-panel__head">
        <h3 class="help-panel__title">—</h3>
        <button class="help-panel__close" aria-label="Close">✕</button>
      </div>
      <div class="help-panel__content"></div>
    </div>`;
  document.body.appendChild(panel);
  const openIt = () => { panel.classList.add('help-panel--open'); renderHelpPanel(); };
  const closeIt = () => panel.classList.remove('help-panel--open');
  const btn = document.getElementById('help-btn');
  if (btn) btn.addEventListener('click', openIt);
  panel.querySelector('.help-panel__close').addEventListener('click', closeIt);
  panel.addEventListener('click', (e) => { if (e.target === panel) closeIt(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeIt(); });
  renderHelpPanel();
}

// Global click-to-zoom lightbox for tool images
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLImageElement)) return;
  if (!t.matches('.fake__match img, .fake__ig-photo img, .fake__court-doc, .fake__insead img, .fake__ig-block img')) return;
  if (!t.src || t.src.endsWith('#')) return;
  e.preventDefault();
  const lb = document.createElement('div');
  lb.className = 'img-lightbox';
  lb.innerHTML = `<button class="img-lightbox__close" aria-label="Close">✕</button><img class="img-lightbox__img" src="${t.src}" alt="">`;
  const close = () => lb.remove();
  lb.addEventListener('click', close);
  const esc = (ev) => { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } };
  document.addEventListener('keydown', esc);
  document.body.appendChild(lb);
});
