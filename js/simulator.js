// Shadow Simulator — engine + Firebase leaderboard
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase, ref, set, get, remove, query, orderByChild, limitToLast
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const NICK_KEY = 'ss.nickname';
const SCORE_KEY = 'ss.local';

// Case → track membership map (used to compute per-track leaderboard totals from points_by_case).
// Update this whenever a new case is added.
export const TRACK_CASES = {
  sim01: ['fake-cfo', 'suspicious-consultant', 'family-chain',
          'shadow-candidate', 'coordinate-hunter'],
  sim02: ['leaking-engineer', 'procurement-ghost', 'fake-vendor-network',
          'executive-coi', 'insider-trading', 'careful-watch'],
};
export function caseTrack(caseId) {
  for (const t of Object.keys(TRACK_CASES)) {
    if (TRACK_CASES[t].includes(caseId)) return t;
  }
  return null;
}

// ==================== NICKNAME ====================
// Firebase Realtime DB path chars: no . # $ [ ] /
export function sanitizeNickname(nick) { return String(nick || '').replace(/[.#$\[\]\/]/g, '_'); }
export function getNickname() {
  const raw = localStorage.getItem(NICK_KEY) || '';
  const clean = sanitizeNickname(raw);
  if (raw && raw !== clean) localStorage.setItem(NICK_KEY, clean);
  return clean;
}
export function saveNickname(nick) { localStorage.setItem(NICK_KEY, sanitizeNickname(nick)); }
export function validateNickname(nick) { return /^[A-Za-z0-9_-]{3,16}$/.test(nick); }

// ==================== LOCAL SCORE ====================
export function getLocalStats() {
  try { return JSON.parse(localStorage.getItem(SCORE_KEY)) || { total: 0, games: 0 }; }
  catch { return { total: 0, games: 0 }; }
}
export function saveLocalStats(stats) { localStorage.setItem(SCORE_KEY, JSON.stringify(stats)); }

// ==================== RANKS ====================
export function calcRankByTotal(total) {
  if (total >= 1000) return { key: 'certified', label: 'Certified Investigator', icon: '💎', color: '#7fd6ff' };
  if (total >= 500)  return { key: 'analyst',   label: 'Analyst',                icon: '🥇', color: '#ffc864' };
  if (total >= 100)  return { key: 'trainee_plus', label: 'Trainee+',           icon: '🥈', color: '#c0c8d8' };
  return                { key: 'trainee', label: 'Trainee',                icon: '🥉', color: '#a67c52' };
}

// ==================== FIREBASE ====================
export async function submitScore(nickname, gamePoints, gameCaseId, correct = false) {
  try {
    const cleanNick = sanitizeNickname(nickname);
    if (!cleanNick || cleanNick.length < 3) {
      return { ok: false, error: 'invalid_nick' };
    }
    const nowIso = new Date().toISOString();
    const userRef = ref(db, `leaderboard/${cleanNick}`);
    let existing = {};
    try {
      const snap = await get(userRef);
      if (snap.exists()) existing = snap.val();
    } catch (e) { console.warn('read own record failed', e); }
    const newTotal = (existing.total_points || 0) + gamePoints;
    const newGames = (existing.games_played || 0) + 1;
    // Track completed cases so a returning player on another browser still sees unlock state
    const priorCompleted = Array.isArray(existing.completed_cases) ? existing.completed_cases : [];
    const completed_cases = correct && !priorCompleted.includes(gameCaseId)
      ? [...priorCompleted, gameCaseId]
      : priorCompleted;
    // Per-case best-score map — enables per-track leaderboard aggregation
    const priorByCase = (existing.points_by_case && typeof existing.points_by_case === 'object') ? existing.points_by_case : {};
    const priorCaseBest = priorByCase[gameCaseId] || 0;
    const points_by_case = { ...priorByCase };
    if (gamePoints > priorCaseBest) points_by_case[gameCaseId] = gamePoints;
    const payload = {
      total_points: newTotal, games_played: newGames,
      last_case: gameCaseId, last_points: gamePoints, updated: nowIso,
      completed_cases, points_by_case,
    };
    await set(userRef, payload);
    saveLocalStats({ total: newTotal, games: newGames });
    // Mirror completed cases to localStorage so simulator gallery reflects Firebase truth
    completed_cases.forEach(cid => localStorage.setItem('ss.completed.' + cid, '1'));
    return { ok: true, total: newTotal, games: newGames };
  } catch (e) {
    console.error('submitScore failed', e);
    return { ok: false, error: e.message || String(e) };
  }
}

// Sync Firebase-side completed cases into localStorage — call on simulator page load
// so a player returning on the same device (or after cache clear) sees their unlocks.
export async function syncProgressFromFirebase(nickname) {
  try {
    const cleanNick = sanitizeNickname(nickname);
    if (!cleanNick || cleanNick.length < 3) return { ok: false };
    const snap = await get(ref(db, `leaderboard/${cleanNick}`));
    if (!snap.exists()) return { ok: true, synced: 0 };
    const v = snap.val();
    let synced = 0;
    if (Array.isArray(v.completed_cases)) {
      v.completed_cases.forEach(cid => {
        localStorage.setItem('ss.completed.' + cid, '1');
        synced++;
      });
    }
    // Legacy records without completed_cases: use last_case as best-effort seed
    else if (v.last_case && v.total_points >= 100) {
      localStorage.setItem('ss.completed.' + v.last_case, '1');
      synced = 1;
    }
    saveLocalStats({ total: v.total_points || 0, games: v.games_played || 0 });
    return { ok: true, synced };
  } catch (e) {
    console.warn('syncProgressFromFirebase failed', e);
    return { ok: false, error: e.message };
  }
}

// Nicknames excluded from leaderboard render (dev/test accounts).
// Firebase rules block deletion, so we filter client-side.
const HIDDEN_NICKS = new Set(['C2Test','V5Test','TestAgent','HardTest','V4Test','V3Test','C4Test','C5Test','C5Wire','C4Wire','C3Test','C3Hard','Case2Vis','LangTest','PhotoTest','CertTest','CertHero','TestGallery','yehor_dev','testnew1','test_991','test_dot413','hc_check_7','mrs_smith']);

export async function fetchLeaderboard(topN = 50, trackId = null) {
  try {
    // Always pull the full board — we now compute best-per-case sums client-side
    // (fair play: replay-farming can't inflate score; only your BEST per case counts).
    const qRef = ref(db, 'leaderboard');
    const snap = await get(qRef);
    if (!snap.exists()) return [];
    const rows = [];
    const trackCases = trackId ? (TRACK_CASES[trackId] || []) : null;
    // All-tracks case pool for global view
    const allCases = Object.values(TRACK_CASES).flat();
    snap.forEach(child => {
      if (HIDDEN_NICKS.has(child.key)) return;
      const v = child.val();
      const byCase = (v.points_by_case && typeof v.points_by_case === 'object') ? v.points_by_case : {};
      const targetCases = trackId ? trackCases : allCases;
      let pts = 0, uniqueCases = 0;
      targetCases.forEach(cid => {
        if (byCase[cid] != null) { pts += byCase[cid]; uniqueCases++; }
      });
      // Legacy fallback for old records without points_by_case
      if (uniqueCases === 0 && v.last_case && v.last_points && targetCases.includes(v.last_case)) {
        pts = v.last_points; uniqueCases = 1;
      }
      // Global view: also honor legacy total_points if truly no per-case data (very old accounts)
      if (!trackId && uniqueCases === 0 && v.total_points > 0) {
        pts = v.total_points;
        uniqueCases = Array.isArray(v.completed_cases) ? v.completed_cases.length : (v.games_played || 0);
      }
      if (pts <= 0) return;
      // Cap unique-cases to total available so replay-farmers don't show "8 / 6"
      const totalAvail = targetCases.length;
      const displayCases = Math.min(uniqueCases, totalAvail);
      rows.push({
        nickname: child.key,
        total_points: pts,
        games_played: displayCases,
        updated: v.updated || '',
      });
    });
    rows.sort((a, b) => b.total_points - a.total_points);
    return rows.slice(0, topN);
  } catch (e) {
    console.error('fetchLeaderboard failed', e);
    return null;
  }
}

// ==================== UI HELPERS ====================
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function LANG() { return (document.documentElement.lang || 'uk'); }
function T(key, fallback = '') {
  const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
  return dict[key] || fallback;
}

// ==================== REGISTRATION MODAL ====================
export function ensureRegistered() {
  return new Promise((resolve) => {
    const existing = getNickname();
    if (existing) return resolve(existing);
    showRegistrationModal((nick) => {
      saveNickname(nick);
      resolve(nick);
    });
  });
}

function showRegistrationModal(onDone) {
  // Scroll lock
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.id = 'ss-register-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const lbl = T('ss.modal.label', 'SHADOW SIMULATOR · REGISTRATION');
  const ttl = T('ss.modal.title', 'Обери свій оперативний позивний');
  const txt = T('ss.modal.text', "Твій нікнейм з'явиться у публічному Leaderboard, коли пройдеш перший кейс. Без email, без пароля — тільки нік. Зберігається у твоєму браузері.");
  const ph  = T('ss.modal.placeholder', 'напр. shadow_hunter_25');
  const hnt = T('ss.modal.hint', '3-16 символів · латиниця, цифри, _ - .');
  const btn = T('ss.modal.enter', 'Enter the Simulator →');
  modal.innerHTML = `
    <div class="ss-modal__backdrop"></div>
    <div class="ss-modal__box">
      <span class="ss-modal__ret ss-r-tl"></span>
      <span class="ss-modal__ret ss-r-tr"></span>
      <span class="ss-modal__ret ss-r-bl"></span>
      <span class="ss-modal__ret ss-r-br"></span>
      <div class="ss-modal__label">${escapeHtml(lbl)}</div>
      <h3>${escapeHtml(ttl)}</h3>
      <p>${escapeHtml(txt)}</p>
      <input type="text" id="ss-nick-input" placeholder="${escapeHtml(ph)}" autocomplete="off" spellcheck="false" maxlength="16">
      <div class="ss-modal__hint">${escapeHtml(hnt)}</div>
      <div class="ss-modal__err" id="ss-nick-err" style="display:none"></div>
      <div class="ss-modal__actions">
        <button class="btn btn--filled" id="ss-nick-go">${escapeHtml(btn)}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const input = modal.querySelector('#ss-nick-input');
  const err = modal.querySelector('#ss-nick-err');
  const go = modal.querySelector('#ss-nick-go');
  setTimeout(() => input.focus(), 100);
  const submit = () => {
    const v = input.value.trim();
    if (!validateNickname(v)) {
      err.textContent = T('ss.modal.err', 'Невалідний нік. Правило: 3-16 символів, англ. літери / цифри / _ - .');
      err.style.display = 'block';
      input.focus();
      return;
    }
    modal.remove();
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    onDone(v);
  };
  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

// ==================== AGENT PROFILE PANEL ====================
// ==================== CHANGE NICKNAME ====================
// Prompts the player for a new nickname, validates it, and — if they already
// have a leaderboard record — migrates all their progress (points, games,
// per-case bests, completed cases) from the old node to the new one so their
// stats aren't orphaned. Returns { ok, nick } on success.
export async function changeNickname() {
  const isEn = LANG() === 'en';
  const currentRaw = localStorage.getItem(NICK_KEY) || '';
  const current = sanitizeNickname(currentRaw);
  const promptMsg = isEn
    ? `Enter new nickname (3–16 chars, letters/digits/_-).\nYour progress will move to the new name.`
    : `Введи новий нікнейм (3–16 символів, літери/цифри/_-).\nТвій прогрес переїде на новий нік.`;
  const raw = window.prompt(promptMsg, current);
  if (raw === null) return { ok: false, cancelled: true };
  const next = sanitizeNickname(raw.trim());
  if (!validateNickname(next)) {
    alert(isEn ? 'Invalid nickname. Use 3–16 chars: letters, digits, _ or -.' : 'Невалідний нік. 3–16 символів: літери, цифри, _ або -.');
    return { ok: false, error: 'invalid' };
  }
  if (next === current) return { ok: true, nick: next, noop: true };
  // Migrate leaderboard record if there is one and the target slot is free
  // (or, if not free, merge — take max of each numeric field).
  try {
    const oldRef = ref(db, `leaderboard/${current}`);
    const newRef = ref(db, `leaderboard/${next}`);
    const [oldSnap, newSnap] = await Promise.all([get(oldRef), get(newRef)]);
    const oldVal = oldSnap.exists() ? oldSnap.val() : null;
    const newVal = newSnap.exists() ? newSnap.val() : null;
    if (oldVal) {
      const merged = mergeLeaderboardEntries(oldVal, newVal);
      await set(newRef, merged);
      if (current && current !== next) await remove(oldRef);
    } else if (!newVal) {
      // No prior record anywhere — nothing to migrate; new node is created on first submit.
    }
    // else: newVal exists but oldVal doesn't — nothing to do, we just adopt the existing slot.
  } catch (e) {
    console.error('nickname migration failed', e);
    alert(isEn ? 'Could not migrate progress. Please try again.' : 'Не вдалося перенести прогрес. Спробуй ще раз.');
    return { ok: false, error: e.message || String(e) };
  }
  saveNickname(next);
  // Reflect on UI immediately — safest is a reload so leaderboard/agent-panel/HUD all repaint
  location.reload();
  return { ok: true, nick: next };
}

function mergeLeaderboardEntries(a, b) {
  if (!a) return b || {};
  if (!b) return a;
  const out = { ...a, ...b };
  out.total_points   = Math.max(a.total_points || 0, b.total_points || 0);
  out.games_played   = Math.max(a.games_played || 0, b.games_played || 0);
  out.last_points    = (a.last_points || 0) + (b.last_points || 0) > 0
    ? Math.max(a.last_points || 0, b.last_points || 0) : 0;
  // last_case: keep whichever record has the newer 'updated' timestamp
  const aTs = a.updated ? Date.parse(a.updated) : 0;
  const bTs = b.updated ? Date.parse(b.updated) : 0;
  if (aTs >= bTs) { out.last_case = a.last_case; out.updated = a.updated; }
  else            { out.last_case = b.last_case; out.updated = b.updated; }
  // completed_cases: union
  const setC = new Set([...(a.completed_cases || []), ...(b.completed_cases || [])]);
  out.completed_cases = [...setC];
  // points_by_case: per-case max
  const pa = a.points_by_case || {}, pb = b.points_by_case || {};
  const pbc = {};
  for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
    pbc[k] = Math.max(pa[k] || 0, pb[k] || 0);
  }
  out.points_by_case = pbc;
  return out;
}

export function renderAgentPanel(targetSelector, nickname) {
  const target = document.querySelector(targetSelector);
  if (!target) return;
  const stats = getLocalStats();
  const rank = calcRankByTotal(stats.total);
  const progress = Math.min(100, (stats.total / 1000) * 100).toFixed(1);
  const lang = LANG();
  const gamesWord = lang === 'en'
    ? (stats.games === 1 ? 'case completed' : 'cases completed')
    : (stats.games === 1 ? 'кейс пройдено' : 'кейсів пройдено');
  const hint = (T('ss.ap.progress.hint', '{n} / 1000 pts · розблокується на 1000+')).replace('{n}', stats.total);
  target.innerHTML = `
    <div class="ap">
      <div class="ap__label">${T('ss.ap.label', 'ПРОФІЛЬ АГЕНТА')}</div>
      <div class="ap__grid">
        <div class="ap__cell">
          <div class="ap__cell-label">${T('ss.ap.nickname', 'Нікнейм')}</div>
          <div class="ap__nick">${escapeHtml(nickname)} <button type="button" class="ap__nick-edit" data-action="change-nick" title="${T('ss.ap.nickname.change', 'Змінити нік')}" aria-label="${T('ss.ap.nickname.change', 'Змінити нік')}" style="margin-left:.4rem;background:transparent;border:1px solid var(--border);color:var(--text-mute);padding:.15rem .45rem;font-size:.75rem;cursor:pointer;border-radius:4px;vertical-align:middle">✎</button></div>
          <div class="ap__rank" style="color:${rank.color}">${rank.icon} ${escapeHtml(rank.label)}</div>
        </div>
        <div class="ap__cell">
          <div class="ap__cell-label">${T('ss.ap.score', 'Очки')}</div>
          <div class="ap__score">${stats.total} <span>pts</span></div>
          <div class="ap__sub">${stats.games} ${gamesWord}</div>
        </div>
        <div class="ap__cell">
          <div class="ap__cell-label">${T('ss.ap.progress', 'Прогрес до сертифіката')}</div>
          <div class="ap__bar"><div class="ap__bar-fill" style="width:${progress}%"></div></div>
          <div class="ap__sub">${escapeHtml(hint)}</div>
        </div>
      </div>
    </div>`;
  const editBtn = target.querySelector('[data-action="change-nick"]');
  if (editBtn) editBtn.addEventListener('click', () => { changeNickname(); });
}

// ==================== LEADERBOARD ====================
export async function renderLeaderboard(targetSelector, currentNick, trackId = null) {
  const target = document.querySelector(targetSelector);
  if (!target) return;
  target.innerHTML = `<div class="lb__loading">${T('ss.lb.loading', 'Завантаження leaderboard…')}</div>`;
  const rows = await fetchLeaderboard(50, trackId);
  const lang = LANG();
  if (rows === null) {
    target.innerHTML = `<div class="lb__err">${T('ss.lb.err', 'Не вдалося завантажити leaderboard. Firebase-помилка (можливо, rules ще не опубліковані).')}</div>`;
    return;
  }
  if (!rows.length) {
    target.innerHTML = `<div class="lb__empty">
      <div class="lb__empty-icon">📊</div>
      <div class="lb__empty-title">${T('ss.lb.empty.title', 'Leaderboard порожній')}</div>
      <div class="lb__empty-sub">${T('ss.lb.empty.sub', "Стань першим, хто пройде кейс — твій нік з'явиться тут.")}</div>
    </div>`;
    return;
  }
  const fmt = (n) => new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'uk').format(n);
  const rowHtml = (r, i) => {
    const rank = calcRankByTotal(r.total_points);
    const isMe = currentNick && r.nickname === currentNick;
    return `
      <tr class="lb__row${isMe ? ' lb__row--me' : ''}">
        <td class="lb__pos">${String(i+1).padStart(2,'0')}</td>
        <td class="lb__nick">${escapeHtml(r.nickname)}${isMe ? ' <span class="lb__you">YOU</span>' : ''}</td>
        <td class="lb__pts">${fmt(r.total_points)}</td>
        <td class="lb__games">${r.games_played}</td>
        <td class="lb__rank"><span style="color:${rank.color}">${rank.icon} ${escapeHtml(rank.label)}</span></td>
      </tr>`;
  };
  target.innerHTML = `
    <div class="lb__box">
      <table class="lb__table">
        <thead>
          <tr>
            <th class="lb__th-pos">#</th>
            <th class="lb__th-nick">${T('ss.lb.th.nickname', 'Нікнейм')}</th>
            <th class="lb__th-pts">${T('ss.lb.th.pts', 'Всього pts')}</th>
            <th class="lb__th-games">${T('ss.lb.th.games', 'Кейсів')}</th>
            <th class="lb__th-rank">${T('ss.lb.th.rank', 'Ранг')}</th>
          </tr>
        </thead>
        <tbody>${rows.map(rowHtml).join('')}</tbody>
      </table>
    </div>`;
}
