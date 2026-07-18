// Shadow Simulator — engine + Firebase leaderboard
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase, ref, set, get, query, orderByChild, limitToLast
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const NICK_KEY = 'ss.nickname';
const SCORE_KEY = 'ss.local'; // fallback if offline

// ==================== NICKNAME ====================
export function getNickname() {
  return localStorage.getItem(NICK_KEY) || '';
}
export function saveNickname(nick) {
  localStorage.setItem(NICK_KEY, nick);
}
export function validateNickname(nick) {
  return /^[A-Za-z0-9_.-]{3,16}$/.test(nick);
}

// ==================== LOCAL SCORE ====================
export function getLocalStats() {
  try { return JSON.parse(localStorage.getItem(SCORE_KEY)) || { total: 0, games: 0, best_rank: null }; }
  catch { return { total: 0, games: 0, best_rank: null }; }
}
export function saveLocalStats(stats) {
  localStorage.setItem(SCORE_KEY, JSON.stringify(stats));
}

// ==================== RANKS ====================
export function calcRankByGame(points) {
  if (points >= 200) return { key: 'master',  label: 'Master · Shadow Hunter', icon: '💎', color: '#7fd6ff' };
  if (points >= 150) return { key: 'senior',  label: 'Senior Investigator',    icon: '🥇', color: '#ffc864' };
  if (points >= 100) return { key: 'junior',  label: 'Junior Analyst',         icon: '🥈', color: '#c0c8d8' };
  return               { key: 'trainee', label: 'Trainee',                icon: '🥉', color: '#a67c52' };
}
export function calcRankByTotal(total) {
  if (total >= 1000) return { key: 'certified', label: 'Certified Investigator', icon: '💎', color: '#7fd6ff' };
  if (total >= 500)  return { key: 'analyst',   label: 'Analyst',                icon: '🥇', color: '#ffc864' };
  return                { key: 'trainee',   label: 'Trainee',                icon: '🥉', color: '#a67c52' };
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
    total_points: newTotal,
    games_played: newGames,
    last_case: gameCaseId,
    last_points: gamePoints,
    updated: nowIso,
  };
  try {
    await set(userRef, payload);
    // Also mirror to local cache
    saveLocalStats({ total: newTotal, games: newGames, best_rank: calcRankByTotal(newTotal).key });
    return { ok: true, total: newTotal, games: newGames };
  } catch (e) {
    console.error('submitScore failed', e);
    return { ok: false, error: e.message };
  }
}

export async function fetchLeaderboard(topN = 20) {
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
        last_points: v.last_points || 0,
      });
    });
    rows.sort((a, b) => b.total_points - a.total_points);
    return rows;
  } catch (e) {
    console.error('fetchLeaderboard failed', e);
    return null; // signal error
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
  const modal = document.createElement('div');
  modal.className = 'ss-modal';
  modal.innerHTML = `
    <div class="ss-modal__backdrop"></div>
    <div class="ss-modal__box">
      <div class="ss-modal__reticle ss-r-tl"></div>
      <div class="ss-modal__reticle ss-r-tr"></div>
      <div class="ss-modal__reticle ss-r-bl"></div>
      <div class="ss-modal__reticle ss-r-br"></div>
      <div class="ss-modal__label">Shadow Simulator · Registration</div>
      <h3>Обери свій нікнейм для рейтингу</h3>
      <p>Твоє ім'я з'явиться у публічному Leaderboard, коли пройдеш першу гру. Без email, без пароля — тільки нік. Зберігається у твоєму браузері.</p>
      <input type="text" id="ss-nick-input" placeholder="e.g. shadow_hunter_25" autocomplete="off" spellcheck="false" maxlength="16">
      <div class="ss-modal__hint">3-16 символів · латиниця, цифри, _ - .</div>
      <div class="ss-modal__err" id="ss-nick-err" style="display:none"></div>
      <div class="ss-modal__actions">
        <button class="btn btn--filled" id="ss-nick-go">Enter the Simulator →</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const input = modal.querySelector('#ss-nick-input');
  const err = modal.querySelector('#ss-nick-err');
  const go = modal.querySelector('#ss-nick-go');
  input.focus();
  const submit = () => {
    const v = input.value.trim();
    if (!validateNickname(v)) {
      err.textContent = 'Невалідний нік. Правило: 3-16 символів, англ. літери / цифри / _ - .';
      err.style.display = 'block';
      input.focus();
      return;
    }
    modal.remove();
    onDone(v);
  };
  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

// ==================== LEADERBOARD RENDER ====================
export async function renderLeaderboard(targetSelector, currentNick) {
  const target = document.querySelector(targetSelector);
  if (!target) return;
  target.innerHTML = `<p class="ss-lb__loading">Завантаження leaderboard…</p>`;
  const rows = await fetchLeaderboard(50);
  if (rows === null) {
    target.innerHTML = `<p class="ss-lb__err">Не вдалося завантажити leaderboard. Firebase-помилка (можливо, rules ще не опубліковані).</p>`;
    return;
  }
  if (!rows.length) {
    target.innerHTML = `<div class="ss-lb__empty">
      <div class="ss-lb__empty-title">Leaderboard порожній.</div>
      <div class="ss-lb__empty-sub">Стань першим, хто пройде кейс.</div>
    </div>`;
    return;
  }
  const myIndex = currentNick ? rows.findIndex(r => r.nickname === currentNick) : -1;
  const fmt = (n) => new Intl.NumberFormat('uk').format(n);
  const rowHtml = (r, i) => {
    const rank = calcRankByTotal(r.total_points);
    const isMe = currentNick && r.nickname === currentNick;
    return `
      <tr class="ss-lb__row${isMe ? ' ss-lb__row--me' : ''}">
        <td class="ss-lb__pos">${String(i+1).padStart(2,'0')}</td>
        <td class="ss-lb__nick">${escapeHtml(r.nickname)}${isMe ? ' <span class="ss-lb__you">YOU</span>' : ''}</td>
        <td class="ss-lb__pts">${fmt(r.total_points)}</td>
        <td class="ss-lb__games">${r.games_played}</td>
        <td class="ss-lb__rank"><span style="color:${rank.color}">${rank.icon} ${escapeHtml(rank.label)}</span></td>
      </tr>`;
  };
  target.innerHTML = `
    <table class="ss-lb__table">
      <thead>
        <tr>
          <th>#</th><th>Nickname</th><th>Total pts</th><th>Games</th><th>Rank</th>
        </tr>
      </thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table>
    ${myIndex < 0 && currentNick ? `<p class="ss-lb__note">Ти ще не зіграв жодної гри. Стартуй кейс — з'явишся у списку.</p>` : ''}`;
}

// ==================== CURRENT-USER PANEL ====================
export function renderMyPanel(targetSelector, nickname) {
  const target = document.querySelector(targetSelector);
  if (!target) return;
  const stats = getLocalStats();
  const rank = calcRankByTotal(stats.total);
  target.innerHTML = `
    <div class="ss-me">
      <div class="ss-me__label">You are logged in as</div>
      <div class="ss-me__nick">${escapeHtml(nickname)}</div>
      <div class="ss-me__stats">
        <div><span>Total</span><strong>${stats.total} pts</strong></div>
        <div><span>Games</span><strong>${stats.games}</strong></div>
        <div><span>Rank</span><strong style="color:${rank.color}">${rank.icon} ${escapeHtml(rank.label)}</strong></div>
      </div>
      <div class="ss-me__toward">
        <div class="ss-me__toward-label">Certificate progress</div>
        <div class="ss-me__bar"><div class="ss-me__bar-fill" style="width:${Math.min(100, (stats.total/1000)*100).toFixed(1)}%"></div></div>
        <div class="ss-me__toward-hint">${stats.total} / 1000 pts · certificate unlocks at 1000+</div>
      </div>
    </div>`;
}
