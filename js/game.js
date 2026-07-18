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
async function submitScore(nickname, gamePoints, caseId) {
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
  phase: 'loading',     // loading | cooldown | briefing | phase2 | phase3 | phase4 | result
  points: 0,
  timeLeft: 720,
  timerId: null,
  toolsUsed: {},        // {toolId: true}
  toolResults: [],      // [{tool, clue, points}]
  q3Answers: {},        // {qId: {optIdx, correct, points, feedback}}
  finalVerdict: null,
  startedAt: 0,
  ended: false,
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
  const phases = ['briefing', 'phase2', 'phase3', 'phase4'];
  const labels = LANG()==='en'
    ? ['Briefing', 'Investigation', 'Verification', 'Verdict']
    : ['Брифінг', 'Розслідування', 'Верифікація', 'Вердикт'];
  return `<div class="game-progress">${phases.map((p, i) => {
    const cur = phases.indexOf(current);
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
      <div class="game-brief__bg" style="background-image:url('/img/uploads/simulator/shadow-simulator-splash.jpg')"></div>
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
  $('#btn-start').addEventListener('click', () => {
    State.phase = 'phase2';
    State.startedAt = Date.now();
    startTimer();
    renderPhase2();
    scrollTop();
  });
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
          <div class="tool-log ${r.points<0?'tool-log--neg':'tool-log--pos'}">
            <div class="tool-log__head">${escapeHtml(r.tool)} · <strong>${r.points>0?'+':''}${r.points} pts</strong> · -${r.time}s</div>
            <div class="tool-log__clue">${escapeHtml(r.clue)}</div>
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
  $('#game-root').querySelectorAll('.tool-btn:not(.tool-btn--used)').forEach(btn => {
    btn.addEventListener('click', () => useTool(btn.dataset.tool));
  });
  const nextBtn = $('#btn-next');
  if (nextBtn && !nextBtn.disabled) {
    nextBtn.addEventListener('click', () => {
      State.phase = 'phase3';
      renderPhase3();
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
  const points = tool.points;
  const pointsCls = points >= 0 ? 'tool-modal__pts--pos' : 'tool-modal__pts--neg';
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
      <div class="tool-modal__clue">${escapeHtml(tr(tool,'clue'))}</div>
      <div class="tool-modal__foot">
        <div class="tool-modal__pts ${pointsCls}">${points > 0 ? '+' : ''}${points} pts</div>
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
  switch (tool.ui_component) {
    case 'multi-reverse':
    case 'yandex-reverse': return `
      <div class="fake fake--multi-reverse">
        <div class="fake__topbar">🔎 <span>Multi-Engine Reverse Face Search</span></div>
        <div class="fake__search-row">
          <img src="${cand.photo}" class="fake__input-img" alt="query">
          <div class="fake__query">Uploaded: <code>candidate.jpg</code> · <strong>Queried 4 engines</strong></div>
        </div>
        <div class="fake__engines">
          <div class="fake__engine fake__engine--strong">
            <div class="fake__engine-h">🎯 PimEyes <span>·  face-specific</span></div>
            <div class="fake__engine-body"><strong>1 strong match · 91% confidence</strong><br><small>Public photo, unattributed. Same face.</small></div>
          </div>
          <div class="fake__engine fake__engine--strong">
            <div class="fake__engine-h">🎯 FaceCheck.ID <span>· deep-web faces</span></div>
            <div class="fake__engine-body"><strong>2 matches · 88% + 84%</strong><br><small>Both from Ukrainian classifieds (2019, 2021).</small></div>
          </div>
          <div class="fake__engine fake__engine--strong">
            <div class="fake__engine-h">🔎 Yandex <span>· CIS-strong</span></div>
            <div class="fake__engine-body">
              <div class="fake__match fake__match--highlight">
                <img src="/img/uploads/simulator/candidate-vk.jpg" alt="">
                <div><strong>vk.com/roma_yellow_dnepr</strong><br><small>«Роман Ж.» · Дніпро · 92% match</small></div>
              </div>
            </div>
          </div>
          <div class="fake__engine">
            <div class="fake__engine-h">TinEye <span>· exact-copy</span></div>
            <div class="fake__engine-body"><small>0 exact matches (photo not indexed as-is)</small></div>
          </div>
        </div>
        <div class="fake__consensus">
          <strong>Consensus:</strong> 3 of 4 engines confirm same face under different identity («Роман Ж.», Dnipro). PimEyes 91% is decisive.
        </div>
      </div>`;
    case 'hibp': return `
      <div class="fake fake--hibp">
        <div class="fake__topbar">🔥 <span>Have I Been Pwned</span></div>
        <div class="fake__hibp-email">Email: <code>${escapeHtml(cand.email)}</code></div>
        <div class="fake__hibp-status">⚠️ <strong>Oh no — pwned in 3 breaches</strong></div>
        <div class="fake__hibp-list">
          <div class="fake__hibp-row"><strong>Ashley Madison</strong> · 2015 · 32M accounts leaked</div>
          <div class="fake__hibp-row"><strong>Cit0Day</strong> · 2020 · 226M accounts (combined)</div>
          <div class="fake__hibp-row"><strong>DatingSite2019</strong> · 2019 · 8.4M accounts</div>
        </div>
      </div>`;
    case 'getcontact': return `
      <div class="fake fake--getcontact">
        <div class="fake__topbar">📱 <span>GetContact</span></div>
        <div class="fake__gc-num">${escapeHtml(cand.phone)}</div>
        <div class="fake__gc-count"><strong>47 tags</strong> from other users</div>
        <div class="fake__gc-tags">
          <span class="fake__tag fake__tag--red">Рома Шахрай</span>
          <span class="fake__tag fake__tag--red">Кредит-обман</span>
          <span class="fake__tag fake__tag--red">Не давати гроші</span>
          <span class="fake__tag fake__tag--red">BMW Boryspil sales fraud</span>
          <span class="fake__tag fake__tag--red">Обманщик</span>
          <span class="fake__tag fake__tag--red">Ромик з БМВ</span>
          <span class="fake__tag">Рома BMW</span>
          <span class="fake__tag">Роман sales</span>
          <span class="fake__tag">Морозов Р.</span>
          <span class="fake__tag">+ 38 tags…</span>
        </div>
      </div>`;
    case 'google-dorks': return `
      <div class="fake fake--google">
        <div class="fake__topbar">🌐 <span>Google Search Operators</span></div>
        <div class="fake__google-query"><code>"Роман Морозов" site:linkedin.com OR site:job.ua filetype:pdf</code></div>
        <div class="fake__google-results">
          <div class="fake__google-row">
            <div class="fake__google-link">job.ua/resume/roman-morozov-sales-bmw-2020.pdf</div>
            <div class="fake__google-snippet">Роман Морозов — <strong>Sales Manager, BMW Boryspil</strong> (2018-2020). Освіта: КНЕУ, бакалавр економіки. Досвід у продажах преміум-авто...</div>
          </div>
          <div class="fake__google-row">
            <div class="fake__google-link">work.ua/resumes/9384021</div>
            <div class="fake__google-snippet">Роман Морозов — Sales Consultant. Останнє оновлення: 2020-11-15. Позиція: продавець автомобілів...</div>
          </div>
          <div class="fake__google-row">
            <div class="fake__google-link">insead.edu · <em>0 results</em></div>
            <div class="fake__google-snippet">Пошук MBA-alumni «Roman Morozov» — не знайдено жодного випускника з таким ім'ям.</div>
          </div>
        </div>
      </div>`;
    case 'linkedin': return `
      <div class="fake fake--linkedin">
        <div class="fake__topbar">💼 <span>LinkedIn</span></div>
        <div class="fake__li-profile">
          <div class="fake__li-name">Roman Morozov · <span>CFO at TechCorp (2 months)</span></div>
          <div class="fake__li-meta">📍 Kyiv, Ukraine · Joined LinkedIn 2 months ago · 12 connections</div>
          <div class="fake__li-warning">⚠️ Newly created profile · minimal history · connections all also recently joined</div>
          <div class="fake__li-exp">
            <div class="fake__li-row"><strong>CFO · TechCorp</strong><br>Sep 2024 — Present · «managing finance ops»</div>
            <div class="fake__li-row fake__li-row--gap">— GAP · 2018-2024 · 6 years — </div>
            <div class="fake__li-row"><strong>Financial Analyst · [company hidden]</strong><br>2016-2018 · unverified</div>
          </div>
        </div>
      </div>`;
    case 'sanctions-pep': return `
      <div class="fake fake--sanctions">
        <div class="fake__topbar">⚖️ <span>Sanctions & PEP Screening</span></div>
        <div class="fake__sanc-name">Query: <code>Roman Morozov · +380 67 ***-**-45</code></div>
        <div class="fake__sanc-grid">
          <div class="fake__sanc-cell fake__sanc-cell--ok"><span>OFAC (US Treasury)</span><strong>✓ CLEAN</strong></div>
          <div class="fake__sanc-cell fake__sanc-cell--ok"><span>EU Sanctions</span><strong>✓ CLEAN</strong></div>
          <div class="fake__sanc-cell fake__sanc-cell--ok"><span>UK HMT Sanctions</span><strong>✓ CLEAN</strong></div>
          <div class="fake__sanc-cell fake__sanc-cell--ok"><span>СБУ / РНБО (UA)</span><strong>✓ CLEAN</strong></div>
          <div class="fake__sanc-cell fake__sanc-cell--warn"><span>PEP database</span><strong>⚠ PARTIAL</strong><small>3rd-degree kin of district council deputy (2020-2024). Not disqualifying, must document.</small></div>
          <div class="fake__sanc-cell fake__sanc-cell--ok"><span>Interpol Red Notices</span><strong>✓ CLEAN</strong></div>
        </div>
      </div>`;
    case 'insead-alumni': return `
      <div class="fake fake--insead">
        <div class="fake__topbar">🎓 <span>INSEAD Alumni Directory</span></div>
        <div class="fake__insead-query">Verifying MBA claim: <code>Roman Morozov · MBA · INSEAD</code></div>
        <div class="fake__insead-search">
          <div class="fake__insead-row">▸ Searching alumni database (1957 — 2025)…</div>
          <div class="fake__insead-row">▸ Cross-referencing full MBA & EMBA cohorts…</div>
          <div class="fake__insead-row">▸ Checking name variants: Morozov, Морозов, Roman, Роман…</div>
        </div>
        <div class="fake__insead-result">
          <div class="fake__insead-result-icon">∅</div>
          <div class="fake__insead-result-title">NO RECORD FOUND</div>
          <div class="fake__insead-result-body">
            «Roman Morozov» — <strong>0 matches</strong> across all cohorts (MBA, EMBA, PhD, GEMBA, TIEMBA).<br>
            INSEAD Career Services confirms: <em>no alumni with this name have ever graduated</em>.
          </div>
        </div>
        <div class="fake__insead-verdict">💥 MBA claim on CV is <strong>fabricated</strong>. This is a material misrepresentation of qualifications.</div>
      </div>`;
    case 'youcontrol': return `
      <div class="fake fake--youcontrol">
        <div class="fake__topbar">📄 <span>YouControl — Legal Entity Search</span></div>
        <div class="fake__yc-search">Search: <code>${escapeHtml(cand.phone)}</code></div>
        <div class="fake__yc-empty">
          <div class="fake__yc-empty-icon">∅</div>
          <div class="fake__yc-empty-title">No legal entities linked to this phone</div>
          <div class="fake__yc-empty-hint">YouControl indexes companies and their contact data, not personal phones. Use it after you identify a company name.</div>
        </div>
      </div>`;
  }
  return `<div class="fake fake--empty">No UI for tool: ${tool.ui_component}</div>`;
}

// ==================== RENDER: PHASE 3 (QUESTIONS) ====================
function renderPhase3() {
  const p = State.scenario.phase3;
  const questionCard = (q, i) => {
    const answered = State.q3Answers[q.id];
    const optHtml = q.options.map((opt, oi) => {
      let cls = 'q-opt';
      if (answered) {
        if (oi === answered.optIdx) cls += answered.correct ? ' q-opt--correct' : ' q-opt--wrong';
        else if (opt.correct) cls += ' q-opt--reveal';
        cls += ' q-opt--disabled';
      }
      const disabled = answered ? 'disabled' : '';
      return `<button class="${cls}" data-q="${q.id}" data-opt="${oi}" ${disabled}>${escapeHtml(tr(opt,'text'))}</button>`;
    }).join('');
    const feedback = answered ? `<div class="q-feedback q-feedback--${answered.correct?'ok':'bad'}">${escapeHtml(answered.feedback)} <strong>(${answered.points > 0 ? '+' : ''}${answered.points} pts)</strong></div>` : '';
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
  $('#game-root').querySelectorAll('.q-opt:not(.q-opt--disabled)').forEach(btn => {
    btn.addEventListener('click', () => answerQ3(btn.dataset.q, parseInt(btn.dataset.opt,10)));
  });
  const nextBtn = $('#btn-next');
  if (nextBtn && !nextBtn.disabled) {
    nextBtn.addEventListener('click', () => {
      State.phase = 'phase4';
      renderPhase4();
      scrollTop();
    });
  }
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

// ==================== RENDER: PHASE 4 (VERDICT) ====================
function renderPhase4() {
  const p = State.scenario.phase4;
  const optHtml = p.options.map((opt) => `
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

  // Time bonus: if finished quickly, add up to 30 pts bonus
  const s = State.scenario;
  const timeUsed = s.time_limit_sec - State.timeLeft;
  const timeBonus = opt.correct ? Math.max(0, Math.floor((s.time_limit_sec - timeUsed) / s.time_limit_sec * 30)) : 0;
  State.points += timeBonus;

  // Set cooldown if fail
  if (opt.verdict === 'fail' || State.points < 100) {
    setCooldown(s.id, s.cooldown_sec);
  } else {
    clearCooldown(s.id);
  }

  showResult({ verdict: opt, timeBonus, submitted: false });

  // Submit to Firebase
  if (State.nickname) {
    const res = await submitScore(State.nickname, State.points, s.id);
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
  scrollTop();
  const shareBtn = $('#btn-share');
  if (shareBtn) shareBtn.addEventListener('click', () => shareResult(points, rank, tr(s,'title')));
}

function pivotChainHtml() {
  const positive = State.toolResults.filter(r => r.correct && r.points > 0);
  const negative = State.toolResults.filter(r => !r.correct || r.points < 0);
  if (positive.length === 0 && negative.length === 0) return '';
  const conf = (r) => {
    if (r.points >= 15) return { l: 'HIGH', c: '#7fd6ff' };
    if (r.points >= 10) return { l: 'MEDIUM', c: '#ffc864' };
    return { l: 'LOW', c: '#a67c52' };
  };
  const titleUk = '🧭 Pivot-Chain — твої підтверджені сигнали';
  const titleEn = '🧭 Pivot-Chain — your confirmed signals';
  const rows = positive.map((r, i) => {
    const cf = conf(r);
    return `
      <li class="pivot__row">
        <div class="pivot__num">${String(i+1).padStart(2,'0')}</div>
        <div class="pivot__body">
          <div class="pivot__tool">${escapeHtml(r.tool)}</div>
          <div class="pivot__clue">${escapeHtml(r.clue)}</div>
        </div>
        <div class="pivot__conf" style="color:${cf.c};border-color:${cf.c}">${cf.l}</div>
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
    </div>`;
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
  if (pts) pts.textContent = State.points;
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
    <div class="game-hud__cell game-hud__cell--score"><span>${LANG()==='en'?'Score':'Очки'}</span><strong id="hud-points">${State.points}</strong></div>
    <div class="game-hud__cell game-hud__cell--time"><span>${LANG()==='en'?'Time':'Час'}</span><strong id="hud-time">${fmtTime(State.timeLeft)}</strong></div>`;
  const root = $('#game-root');
  root.parentNode.insertBefore(hud, root);
}

// ==================== INIT ====================
async function init() {
  const params = new URLSearchParams(location.search);
  const caseId = params.get('case') || 'fake-cfo';
  // Load scenario
  try {
    const res = await fetch(`content/simulator/${caseId}.json?t=${Date.now()}`, { cache: 'no-store' });
    State.scenario = await res.json();
  } catch (e) {
    $('#game-root').innerHTML = `<div class="game-error">Не вдалося завантажити сценарій: ${escapeHtml(e.message)}</div>`;
    return;
  }
  State.timeLeft = State.scenario.time_limit_sec;
  // Nickname
  const nick = getNickname();
  if (!nick) {
    location.href = 'simulator.html';
    return;
  }
  State.nickname = nick;
  // Cooldown check
  const cd = getCooldownRemaining(State.scenario.id);
  if (cd > 0) {
    State.phase = 'cooldown';
    renderCooldownScreen(cd);
    return;
  }
  // Mount HUD + render briefing
  mountHud();
  State.phase = 'briefing';
  renderBriefing();
}
init();
