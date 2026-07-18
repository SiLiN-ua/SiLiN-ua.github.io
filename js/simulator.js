// Shadow Simulation — engine + Firebase leaderboard
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase, ref, set, get, query, orderByChild, limitToLast
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const NICK_KEY = 'ss.nickname';
const SCORE_KEY = 'ss.local';

// ==================== NICKNAME ====================
export function getNickname() { return localStorage.getItem(NICK_KEY) || ''; }
export function saveNickname(nick) { localStorage.setItem(NICK_KEY, nick); }
export function validateNickname(nick) { return /^[A-Za-z0-9_.-]{3,16}$/.test(nick); }

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
export async function submitScore(nickname, gamePoints, gameCaseId) {
  const nowIso = new Date().toISOString();
  const userRef = ref(db, `leaderboard/${nickname}`);
  let existing = {};
  try {
    const snap = await get(userRef);
    if (snap.exists()) existing = snap.val();
  } catch (e) { console.warn('read own record failed', e); }
  const newTotal = (existing.total_points || 0) + gamePoints;
  const newGames = (existing.games_played || 0) + 1;
  const payload = {
    total_points: newTotal, games_played: newGames,
    last_case: gameCaseId, last_points: gamePoints, updated: nowIso,
  };
  try {
    await set(userRef, payload);
    saveLocalStats({ total: newTotal, games: newGames });
    return { ok: true, total: newTotal, games: newGames };
  } catch (e) {
    console.error('submitScore failed', e);
    return { ok: false, error: e.message };
  }
}

export async function fetchLeaderboard(topN = 50) {
  try {
    const q = query(ref(db, 'leaderboard'), orderByChild('total_points'), limitToLast(topN));
    const snap = await get(q);
    if (!snap.exists()) return [];
    const rows = [];
    snap.forEach(child => {
      const v = child.val();
      rows.push({
        nickname: child.key,
        total_points: v.total_points || 0,
        games_played: v.games_played || 0,
        updated: v.updated || '',
      });
    });
    rows.sort((a, b) => b.total_points - a.total_points);
    return rows;
  } catch (e) {
    console.error('fetchLeaderboard failed', e);
    return null;
  }
}

// ==================== UI HELPERS ====================
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  modal.innerHTML = `
    <div class="ss-modal__backdrop"></div>
    <div class="ss-modal__box">
      <span class="ss-modal__ret ss-r-tl"></span>
      <span class="ss-modal__ret ss-r-tr"></span>
      <span class="ss-modal__ret ss-r-bl"></span>
      <span class="ss-modal__ret ss-r-br"></span>
      <div class="ss-modal__label">SHADOW SIMULATION · REGISTRATION</div>
      <h3>Обери свій оперативний позивний</h3>
      <p>Твій нікнейм з'явиться у публічному Leaderboard, коли пройдеш перший кейс. Без email, без пароля — тільки нік. Зберігається у твоєму браузері.</p>
      <input type="text" id="ss-nick-input" placeholder="напр. shadow_hunter_25" autocomplete="off" spellcheck="false" maxlength="16">
      <div class="ss-modal__hint">3-16 символів · латиниця, цифри, _ - .</div>
      <div class="ss-modal__err" id="ss-nick-err" style="display:none"></div>
      <div class="ss-modal__actions">
        <button class="btn btn--filled" id="ss-nick-go">Enter the Simulation →</button>
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
      err.textContent = 'Невалідний нік. Правило: 3-16 символів, англ. літери / цифри / _ - .';
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
export function renderAgentPanel(targetSelector, nickname) {
  const target = document.querySelector(targetSelector);
  if (!target) return;
  const stats = getLocalStats();
  const rank = calcRankByTotal(stats.total);
  const progress = Math.min(100, (stats.total / 1000) * 100).toFixed(1);
  target.innerHTML = `
    <div class="ap">
      <div class="ap__label">AGENT PROFILE</div>
      <div class="ap__grid">
        <div class="ap__cell">
          <div class="ap__cell-label">Nickname</div>
          <div class="ap__nick">${escapeHtml(nickname)}</div>
          <div class="ap__rank" style="color:${rank.color}">${rank.icon} ${escapeHtml(rank.label)}</div>
        </div>
        <div class="ap__cell">
          <div class="ap__cell-label">Score</div>
          <div class="ap__score">${stats.total} <span>pts</span></div>
          <div class="ap__sub">${stats.games} ${stats.games === 1 ? 'кейс' : 'кейсів'} пройдено</div>
        </div>
        <div class="ap__cell">
          <div class="ap__cell-label">Progress to Certificate</div>
          <div class="ap__bar"><div class="ap__bar-fill" style="width:${progress}%"></div></div>
          <div class="ap__sub">${stats.total} / 1000 pts · unlocks at 1000+</div>
        </div>
      </div>
    </div>`;
}

// ==================== LEADERBOARD ====================
export async function renderLeaderboard(targetSelector, currentNick) {
  const target = document.querySelector(targetSelector);
  if (!target) return;
  target.innerHTML = `<div class="lb__loading">Завантаження leaderboard…</div>`;
  const rows = await fetchLeaderboard(50);
  if (rows === null) {
    target.innerHTML = `<div class="lb__err">Не вдалося завантажити leaderboard. Firebase-помилка (можливо, rules ще не опубліковані).</div>`;
    return;
  }
  if (!rows.length) {
    target.innerHTML = `<div class="lb__empty">
      <div class="lb__empty-icon">📊</div>
      <div class="lb__empty-title">Leaderboard порожній</div>
      <div class="lb__empty-sub">Стань першим, хто пройде кейс — твій нік з'явиться тут.</div>
    </div>`;
    return;
  }
  const fmt = (n) => new Intl.NumberFormat('uk').format(n);
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
            <th class="lb__th-nick">Nickname</th>
            <th class="lb__th-pts">Total pts</th>
            <th class="lb__th-games">Games</th>
            <th class="lb__th-rank">Rank</th>
          </tr>
        </thead>
        <tbody>${rows.map(rowHtml).join('')}</tbody>
      </table>
    </div>`;
}
