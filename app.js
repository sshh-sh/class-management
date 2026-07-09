import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";

const firebaseConfig = {
  apiKey: "AIzaSyCJ21x2-pBs7D1H6aZp4ErLF93QHd91lcQ",
  authDomain: "class-management-e58af.firebaseapp.com",
  projectId: "class-management-e58af",
  storageBucket: "class-management-e58af.firebasestorage.app",
  messagingSenderId: "133343719213",
  appId: "1:133343719213:web:145555eca16666dc052da4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// GAS API URL
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyCRha7rxMnyUR68UqYzDNsQp9SImlSLr2LWkau_oVl-NnL1h6LaK_5h6Uyya7DJnEX/exec';

const TIMES = ['09:00~09:40','09:50~10:30','10:40~11:20','11:30~12:10','13:00~13:40','13:50~14:30'];
const DAY_NAMES = ['일','월','화','수','목','금','토'];

let currentUser = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let selectedDate = null;
let selectedDow = 0;
let myTT = {1:['','','','',''],2:['','','','',''],3:['','','','',''],4:['','','','',''],5:['','','','',''],6:['','','','','']};
let myTTLabels = {};
let classTTList = [];
let syllabusData = {};
let conceptLinksData = {};
let journalData = [];
let progressData = [];
let progSem = 1;
let sheetsUrl = '';
let semYear = 2026;
let timetableEvents = {};
// 3번: 학사일정·시수
let semDatesByYear = {};
let subjectHoursData = {};
let fullTimetableData = {s1:[], s2:[]};
let fullTTSem = (new Date().getMonth() + 1) >= 8 ? 's2' : 's1';
let sylSem = fullTTSem; // 진도표 탭 화면에 표시할 학기
let subjectHoursClasses = [];
// 6번: API 응답 캐시
const apiCache = new Map();
const API_CACHE_TTL = 5 * 60 * 1000; // 5분
// 4번: 링크 자동저장 디바운서
let sylAutoSaveTimer = null;

function getSemDates(year, half) {
  const custom = semDatesByYear[year] && semDatesByYear[year][half === 1 ? 's1' : 's2'];
  if (custom && custom.start && custom.end) {
    return { label: `${year}학년도 ${half}학기`, start: new Date(custom.start), end: new Date(custom.end) };
  }
  if (half === 1) {
    return { label: `${year}학년도 1학기`, start: new Date(year, 2, 2), end: new Date(year, 6, 18) };
  } else {
    return { label: `${year}학년도 2학기`, start: new Date(year, 8, 1), end: new Date(year + 1, 0, 8) };
  }
}

function buildSemSelect() {
  const today = new Date();
  semYear = today.getMonth() >= 2 ? today.getFullYear() : today.getFullYear() - 1;
  const select = document.getElementById('sem-select');
  if (select) {
    const years = [];
    for (let i = -3; i <= 3; i++) {
      years.push(semYear + i);
    }
    select.innerHTML = years.map(y => `<option value="${y}" ${y === semYear ? 'selected' : ''}>${y}학년도</option>`).join('');
    select.value = semYear;
  }
}

window.changeSemYear = async () => {
  const select = document.getElementById('sem-select');
  semYear = parseInt(select.value);
  currentYear = semYear;
  currentMonth = 2; // 3월부터 시작
  selectedDate = 1;
  selectedDow = 1;
  await saveUserData();
  buildCalendar();
  buildProgress();
  buildFullTimetable();
  renderSemDateInputs();
  buildSyllabus();
  buildConceptIcons();
  renderWeek(1, 1);
}

// ==================== 초기화 ====================
window.addEventListener('DOMContentLoaded', () => {
  const agreed = localStorage.getItem('privacy_agreed');
  if (agreed) {
    document.getElementById('privacy-screen').classList.add('hidden');
  }
  onAuthStateChanged(auth, user => {
    if (user) {
      currentUser = user;
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      initApp();
    } else {
      document.getElementById('app').classList.add('hidden');
      if (agreed) {
        document.getElementById('privacy-screen').classList.add('hidden');
        document.getElementById('login-screen').classList.remove('hidden');
      }
    }
  });
});

async function initApp() {
  const photo = document.getElementById('user-photo');
  const name = document.getElementById('user-name');
  if (currentUser.photoURL) { photo.src = currentUser.photoURL; photo.style.display = 'inline-block'; }
  name.textContent = currentUser.displayName || currentUser.email;
  document.getElementById('sync-badge').style.display = 'inline';

  await loadUserData();
  buildSemSelect();
  currentYear = semYear;
  currentMonth = new Date().getMonth();

  buildCalendar();
  buildProgress();
  buildMyTT();
  renderClassTTs();
  buildFullTimetable();
  renderSemDateInputs();
  buildSyllabus();
  buildSubjectHoursFromGAS();
  filterJournal();
  updateJournalFilter();

  const today = new Date();
  selectedDate = today.getDate();
  selectedDow = today.getDay() === 0 ? 0 : today.getDay();
  renderWeek(today.getDate(), today.getDay());
}

// ==================== 개인정보 / 로그인 ====================
window.toggleAgree = () => {
  const checked = document.getElementById('agree-check').checked;
  document.getElementById('agree-btn').disabled = !checked;
};

window.goToLogin = () => {
  localStorage.setItem('privacy_agreed', 'true');
  document.getElementById('privacy-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
};

window.loginWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch(e) { console.error('로그인 실패:', e); }
};

window.logout = async () => {
  await signOut(auth);
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
};

// ==================== 데이터 로드/저장 ====================
function applyUserData(d) {
  if (d.myTT) myTT = d.myTT;
  if (d.myTTLabels) myTTLabels = d.myTTLabels;
  if (d.classTTList && d.classTTList.length) classTTList = d.classTTList;
  if (d.syllabusData && Object.keys(d.syllabusData).length) syllabusData = d.syllabusData;
  if (d.journals) journalData = d.journals.sort((a, b) => new Date(a.date) - new Date(b.date));
  if (d.timetableEvents) timetableEvents = d.timetableEvents;
  if (d.semDatesByYear) semDatesByYear = d.semDatesByYear;
  if (d.subjectHoursData) subjectHoursData = d.subjectHoursData;
  if (d.conceptLinks) { conceptLinksData = d.conceptLinks; buildConceptIcons(); }
  if (d.fullTimetable) fullTimetableData = d.fullTimetable;
  if (d.subjectHoursClasses) subjectHoursClasses = d.subjectHoursClasses;
}

async function loadUserData() {
  const userId = currentUser.email;
  const cacheKey = `userdata_${userId}`;
  const tsKey = `${cacheKey}_ts`;
  const now = Date.now();

  // 캐시된 데이터 즉시 화면에 표시 (GAS 응답 전)
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) applyUserData(JSON.parse(cached));
  } catch(e) {}

  // 【6번】localStorage 타임스탬프 기반 TTL — 새로고침 후에도 5분 내면 GAS 스킵
  const lastTs = parseInt(localStorage.getItem(tsKey) || '0');
  const isFresh = (now - lastTs) < API_CACHE_TTL;
  if (!isFresh) {
    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ app: 'journal-management', action: 'loadAll', userId })
      });
      const d = await res.json();
      if (d.success) {
        applyUserData(d);
        localStorage.setItem(tsKey, String(now));
        apiCache.set('loadAll_' + userId, { ts: now });
        localStorage.setItem(cacheKey, JSON.stringify({
          myTT, myTTLabels, classTTList, syllabusData, journals: journalData, timetableEvents,
          semDatesByYear, subjectHoursData, conceptLinks: conceptLinksData,
          fullTimetable: fullTimetableData, subjectHoursClasses
        }));
      }
    } catch(e) {
      console.log('데이터 로드 실패:', e);
    }
  }

}

async function saveUserData() {
  const userId = currentUser.email;
  const cacheKey = `userdata_${userId}`;
  const tsKey = `${cacheKey}_ts`;
  // 로컬 캐시 즉시 갱신 + 타임스탬프 초기화 (저장 직후엔 GAS 재요청 불필요)
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      myTT, myTTLabels, classTTList, syllabusData, journals: journalData, timetableEvents,
      semDatesByYear, subjectHoursData
    }));
    localStorage.setItem(tsKey, String(Date.now()));
  } catch(e) {}
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'saveMyTimetable', userId, ttData: myTT })
    });
    for (const subject in syllabusData) {
      for (const sem of ['s1', 's2']) {
        const items = sylItems(subject, sem);
        if (!items.length) continue;
        await fetch(GAS_URL, {
          method: 'POST',
          body: JSON.stringify({ app: 'journal-management', action: 'saveSyllabus', userId, subject, sylData: items, semester: sem === 's1' ? '1학기' : '2학기' })
        });
      }
    }
    apiCache.delete('loadAll_' + userId);
  } catch(e) {
    console.log('데이터 저장 실패:', e);
  }
}

// 4번: 진도표 필드 변경 시 자동저장 (디바운스 2초)
function scheduleSylAutoSave() {
  clearTimeout(sylAutoSaveTimer);
  sylAutoSaveTimer = setTimeout(async () => {
    const userId = currentUser?.email;
    if (!userId) return;
    try {
      for (const subject in syllabusData) {
        for (const sem of ['s1', 's2']) {
          const items = sylItems(subject, sem);
          if (!items.length) continue;
          await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ app: 'journal-management', action: 'saveSyllabus', userId, subject, sylData: items, semester: sem === 's1' ? '1학기' : '2학기' })
          });
        }
      }
      apiCache.delete('loadAll_' + userId);
      const badge = document.getElementById('sync-badge');
      if (badge) { badge.textContent = '자동저장 완료 ✓'; setTimeout(() => { badge.textContent = '동기화 완료 ✓'; }, 2000); }
    } catch(e) { console.log('자동저장 실패:', e); }
  }, 2000);
}

// ==================== 달력 ====================
window.changeMonth = (dir) => {
  currentMonth += dir;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  buildCalendar();
};

function buildCalendar() {
  document.getElementById('cal-title').textContent = `${currentYear}년 ${currentMonth + 1}월`;
  const body = document.getElementById('cal-body');
  const firstDow = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const offset = firstDow === 0 ? 6 : firstDow - 1;
  let startD = 1 - offset;
  let rows = '';
  const today = new Date();
  for (let r = 0; r < 7; r++) {
    if (startD > daysInMonth) break;
    rows += '<tr>';
    for (let c = 0; c < 5; c++) {
      const d = startD + c;
      if (d < 1 || d > daysInMonth) { rows += '<td></td>'; continue; }
      const isToday = d === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
      const isSel = d === selectedDate && currentMonth === today.getMonth();
      const cls = isToday ? 'day-cell today' : isSel ? 'day-cell selected' : 'day-cell';
      rows += `<td><div class="${cls}" onclick="selectDay(${d},${c+1})"><span>${d}</span></div></td>`;
    }
    rows += '</tr>';
    startD += 7;
  }
  body.innerHTML = rows;
}

window.selectDay = (d, dow) => {
  selectedDate = d;
  selectedDow = dow;
  buildCalendar();
  renderWeek(d, dow);
};

function getFullTTDaySlots(dateObj) {
  const s1 = getSemDates(semYear, 1), s2 = getSemDates(semYear, 2);
  let sem = null;
  if (dateObj >= s1.start && dateObj <= s1.end) sem = 's1';
  else if (dateObj >= s2.start && dateObj <= s2.end) sem = 's2';
  if (!sem) return null;
  const rows = fullTimetableData[sem] || [];
  for (const w of rows) {
    const m = String(w.period || '').match(/(\d+)\.\s*(\d+)\s*-\s*(\d+)\.\s*(\d+)/);
    if (!m) continue;
    const [sM, sD, eM, eD] = [m[1], m[2], m[3], m[4]].map(Number);
    const sYear = (sem === 's2' && sM < 8) ? semYear + 1 : semYear;
    const eYear = (sem === 's2' && eM < 8) ? semYear + 1 : semYear;
    const start = new Date(sYear, sM - 1, sD, 0, 0, 0, 0);
    const end = new Date(eYear, eM - 1, eD, 23, 59, 59, 999);
    if (dateObj >= start && dateObj <= end) {
      const dayIdx = dateObj.getDay() - 1; // 0=월..4=금
      if (dayIdx < 0 || dayIdx > 4) return null;
      return (w.days && w.days[dayIdx]) ? w.days[dayIdx] : null;
    }
  }
  return null;
}

function renderWeek(d, dow) {
  const dateObj = new Date(currentYear, currentMonth, d);
  const dayName = DAY_NAMES[dateObj.getDay()];
  document.getElementById('week-title').textContent = `${currentMonth + 1}월 ${d}일 (${dayName})`;
  const wc = document.getElementById('week-content');
  if (isNonSchoolDate(dateObj)) {
    wc.classList.remove('lesson-compact');
    wc.innerHTML = '<div class="no-lesson">수업이 없습니다</div>';
    return;
  }
  const fullSlots = getFullTTDaySlots(dateObj);
  const slots = [];
  for (let p = 1; p <= 6; p++) {
    const cls = fullSlots ? (fullSlots[p - 1] || null) : (myTT[p] && myTT[p][dow - 1] ? myTT[p][dow - 1] : null);
    if (cls) slots.push({ p, cls });
  }
  wc.classList.toggle('lesson-compact', slots.length >= 5);
  if (!slots.length) { wc.innerHTML = '<div class="no-lesson">수업이 없습니다</div>'; return; }
  const sylSemForDate = semesterKeyForDate(dateObj);
  wc.innerHTML = slots.map((s, idx) => {
    const isLast = idx === slots.length - 1;
    const syl = getSyllabusCurrent(s.cls, sylSemForDate);
    const finished = !syl && isSyllabusFinished(s.cls, sylSemForDate);
    const nextSyl = isLast ? getSyllabusNext(s.cls, sylSemForDate) : null;
    const isEnd = isLast && !nextSyl;
    const linkHtml = syl && syl.links ? syl.links.split('|').map(pair => {
      const ci = pair.indexOf(',');
      if (ci < 0) return '';
      const text = pair.slice(0, ci).trim(), url = pair.slice(ci+1).trim();
      if (!url) return '';
      return `<a href="${url.replace(/"/g,'&quot;')}" target="_blank" class="lesson-link-btn">${text || url}</a>`;
    }).filter(Boolean).join('') : '';
    const nextHtml = nextSyl ? `<div class="lesson-next">
      <div class="next-topic">${nextSyl.topic || ''}</div>
      <div class="next-prep">${[nextSyl.prep ? '준비물: ' + nextSyl.prep : '', nextSyl.memo].filter(Boolean).join(' | ')}</div>
    </div>` : (isEnd ? `<div class="lesson-next lesson-end"><div class="next-topic">수업종료</div></div>` : '');
    return `<div class="lesson-item${isLast && (nextSyl || isEnd) ? ' has-next' : ''}">
      <div class="lesson-left">
        <div class="lesson-period">${s.p}교시</div>
        <div class="lesson-time">${TIMES[s.p-1].replace('~','~<br>')}</div>
      </div>
      <div class="lesson-right">
        <div class="lesson-class">${s.cls}${syl ? ' ' + syl.unit + (syl.ch ? '(' + syl.ch + ')' : '') : ''}</div>
        <div class="lesson-detail">${syl ? syl.topic : (finished ? '수업종료' : '진도표 미등록')}</div>
        <div class="lesson-prep">${syl && (syl.prep || syl.memo) ? [syl.prep ? '준비물: ' + syl.prep : '', syl.memo].filter(Boolean).join(' | ') : ''}</div>
        ${linkHtml ? `<div class="lesson-links">${linkHtml}</div>` : ''}
      </div>
      ${nextHtml}
    </div>`;
  }).join('');
}

// 과목별 진도표는 학기(s1/s2)로 나뉜다. 구형(마이그레이션 전) 데이터는 배열 그대로 남아있을 수 있어 s1로 취급.
function sylItems(subject, sem) {
  const v = syllabusData[subject];
  if (!v) return [];
  if (Array.isArray(v)) return sem === 's1' ? v : [];
  return v[sem] || [];
}

// 편집 시 사용 — 구형(배열) 데이터는 1학기로 간주해 신형 구조로 옮겨준다.
function sylSubjectSem(subject) {
  const v = syllabusData[subject];
  if (!v || Array.isArray(v)) {
    syllabusData[subject] = { s1: Array.isArray(v) ? v : [], s2: [] };
  }
  return syllabusData[subject][sylSem];
}

function getSyllabusNext(cls, sem) {
  const grade = (cls.match(/\((\d+)-/) || [])[1] || cls.split('-')[0];
  for (const subject in syllabusData) {
    const subjGrade = (subject.match(/^(\d+)/) || [])[1];
    if (subjGrade !== grade) continue;
    const items = sylItems(subject, sem);
    if (!items || !items.length) continue;
    let foundFirst = false;
    for (const item of items) {
      if (!isDone(item)) {
        if (foundFirst) return { topic: item.topic || '', prep: item.prep || '', memo: item.memo || '' };
        foundFirst = true;
      }
    }
  }
  return null;
}

function isSyllabusFinished(cls, sem) {
  const grade = (cls.match(/\((\d+)-/) || [])[1] || cls.split('-')[0];
  let hasSubject = false;
  for (const subject in syllabusData) {
    const subjGrade = (subject.match(/^(\d+)/) || [])[1];
    if (subjGrade !== grade) continue;
    const items = sylItems(subject, sem);
    if (!items || !items.length) continue;
    hasSubject = true;
    if (items.some(i => !isDone(i))) return false;
  }
  return hasSubject;
}

function getSyllabusCurrent(cls, sem) {
  const grade = (cls.match(/\((\d+)-/) || [])[1] || cls.split('-')[0];
  for (const subject in syllabusData) {
    const subjGrade = (subject.match(/^(\d+)/) || [])[1];
    if (subjGrade !== grade) continue;
    const items = sylItems(subject, sem);
    if (!items || !items.length) continue;
    const doneCount = items.filter(i => isDone(i)).length;
    const next = items.find(i => !isDone(i));
    if (!next) continue;
    return { unit: next.unit, ch: next.ch||'', topic: next.topic, prep: next.prep||'', memo: next.memo||'', links: next.links||'', cur: doneCount + 1, total: items.length };
  }
  return null;
}

// ==================== 시수 현황 ====================
const SUBJ_KR = { 즐:'놀이', 과:'과학', 국:'국어', 수:'수학', 영:'영어', 도:'도덕', 사:'사회', 체:'체육', 음:'음악', 미:'미술', 실:'실과', 바:'바른생활', 슬:'슬기로운생활' };

function clsDisplayName(cls) {
  const m = cls.match(/^(.+)\((\d+)-(\d+)\)$/);
  if (!m) return cls;
  const subj = m[1].trim(), grade = m[2], classNum = m[3];
  const kr = SUBJ_KR[subj] || subj;
  if (subj === '즐') return `${grade}학년 ${classNum}반 ${kr}`;
  return `${grade}학년 ${kr}`;
}

function countActualHours(cls, sem) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const weeks = (sem === 1 ? fullTimetableData.s1 : fullTimetableData.s2) || [];
  let count = 0;
  for (const w of weeks) {
    const pm = String(w.period || '').match(/(\d+)\.\s*(\d+)/);
    if (!pm) continue;
    const wDate = new Date(semYear, parseInt(pm[1]) - 1, parseInt(pm[2]));
    if (wDate > today) continue;
    for (const day of w.days) for (const p of day) if (p === cls) count++;
  }
  return count;
}

window.toggleProgSem = (sem) => {
  progSem = sem;
  document.querySelectorAll('.prog-sem-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.sem) === sem));
  renderProgressRows();
};

function progCellHtml(cls) {
  const semKey = progSem === 1 ? 's1base' : 's2base';
  const d = subjectHoursData[cls] || {};
  const total = d[semKey] || 0;
  const done = countActualHours(cls, progSem);
  const pct = total ? Math.min(100, Math.round(done / total * 100)) : 0;
  const over = done > total && total > 0;
  const color = over ? '#F09595' : '#B5D4F4';
  return `<div class="prog-cell">
      <div class="prog-cell-name">${clsDisplayName(cls)}</div>
      <div class="prog-cell-track">
        <div class="prog-cell-fill" style="width:${pct}%;background:${color};">
          <div class="prog-cell-runner"><img src="images/hwanayong.jpg" alt="화나용"></div>
        </div>
      </div>
      <div class="prog-cell-num">${done}/${total}h${over ? ' <span class="prog-warn">초과</span>' : ''}</div>
    </div>`;
}

function renderProgressRows() {
  const body = document.getElementById('prog-rows');
  if (!body) return;
  const classes = subjectHoursClasses.length ? subjectHoursClasses : [];
  if (!classes.length) { body.innerHTML = '<div class="no-lesson">구글시트 연동 후 시수 데이터를 불러오세요</div>'; return; }

  // 열=과목+학년 그룹(첫 등장 순서), 행=반 번호로 매트릭스 정렬
  const groups = [];
  const groupIdx = {};
  classes.forEach(cls => {
    const m = cls.match(/^(.+)\((\d+)-(\d+)\)$/);
    if (!m) return;
    const key = m[1] + m[2];
    if (!(key in groupIdx)) { groupIdx[key] = groups.length; groups.push({ byRow: {} }); }
    groups[groupIdx[key]].byRow[parseInt(m[3])] = cls;
  });
  const maxRow = groups.reduce((mx, g) => Math.max(mx, ...Object.keys(g.byRow).map(Number)), 1);

  let cellsHtml = '';
  for (let row = 1; row <= maxRow; row++) {
    groups.forEach(g => {
      cellsHtml += g.byRow[row] ? progCellHtml(g.byRow[row]) : '<div class="prog-cell prog-cell-empty"></div>';
    });
  }
  body.innerHTML = `<div class="prog-grid" style="grid-template-columns:repeat(${groups.length || 1},minmax(0,1fr));">${cellsHtml}</div>`;
}

function buildProgress() {
  const card = document.getElementById('prog-card');
  card.innerHTML = `
    <div class="prog-sem-bar">
      <button class="prog-sem-btn active" data-sem="1" onclick="toggleProgSem(1)">1학기</button>
      <button class="prog-sem-btn" data-sem="2" onclick="toggleProgSem(2)">2학기</button>
    </div>
    <div id="prog-rows"></div>`;
  renderProgressRows();
}

// ==================== 수업일지 팝업 ====================
function openJournalPopup(d, dow) {
  const dateStr = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  document.getElementById('jp-date').value = dateStr;
  updateJournalPopupTitle();
  document.getElementById('jp-period').value = '';
  document.getElementById('jp-class').value = '';
  document.getElementById('jp-name').value = '';
  document.getElementById('jp-content').value = '';
  document.getElementById('journal-popup').classList.remove('hidden');
}

function updateJournalPopupTitle() {
  const val = document.getElementById('jp-date').value;
  if (!val) return;
  const [y, m, d] = val.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dayName = DAY_NAMES[dateObj.getDay()];
  document.getElementById('journal-popup-title').textContent = `${m}월 ${d}일 (${dayName}) 수업일지`;
}

window.onJournalDateChange = () => {
  const val = document.getElementById('jp-date').value;
  if (!val) return;
  const [y, m, d] = val.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  selectedDow = dateObj.getDay();
  updateJournalPopupTitle();
  document.getElementById('jp-class').value = '';
};

window.openNewJournal = () => {
  const today = new Date();
  currentYear = today.getFullYear();
  currentMonth = today.getMonth();
  selectedDate = today.getDate();
  selectedDow = today.getDay();
  openJournalPopup(selectedDate, selectedDow);
};

window.closeJournalPopup = (e) => {
  if (e.target === document.getElementById('journal-popup')) closeJournalPopupDirect();
};
window.closeJournalPopupDirect = () => document.getElementById('journal-popup').classList.add('hidden');

window.autoFillClass = () => {
  const p = document.getElementById('jp-period').value;
  if (!p) { document.getElementById('jp-class').value = ''; return; }
  const pNum = parseInt(p);
  const v = myTT[pNum] && myTT[pNum][selectedDow - 1] ? myTT[pNum][selectedDow - 1] : '';
  const m = v.match(/(\d+-\d+)/);
  document.getElementById('jp-class').value = m ? m[1] : (v || '(수업 없음)');
};

window.saveJournal = async () => {
  const period = document.getElementById('jp-period').value;
  const cls = document.getElementById('jp-class').value;
  const name = document.getElementById('jp-name').value.trim();
  const content = document.getElementById('jp-content').value.trim();
  const dateStr = document.getElementById('jp-date').value;
  if (!dateStr || !period || !name || !content) { showToast('날짜, 교시, 학생 이름, 지도내용을 모두 입력해 주세요.', 'error'); return; }

  const btn = document.querySelector('#journal-popup .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({
        app: 'journal-management',
        action: 'saveJournal',
        userId: currentUser.email,
        journalData: { date: dateStr, period, class: cls, name, content }
      })
    });
    const result = await res.json();
    if (result.success) {
      closeJournalPopupDirect();
      await loadJournal();
        } else {
      showToast('저장 실패: ' + result.message, 'error');
    }
  } catch(e) {
    showToast('저장 중 오류: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '저장'; }
  }
};

// ==================== 수업일지 탭 ====================
let deleteMode = false;
let selectedJournalYear = null;
let journalActiveSearch = { cls: '', name: '', month: '' };

function getSchoolYear(dateStr) {
  if (!dateStr) return null;
  const y = parseInt(String(dateStr).slice(0, 4));
  const m = parseInt(String(dateStr).slice(5, 7));
  if (isNaN(y) || isNaN(m)) return null;
  return m >= 3 ? y : y - 1;
}

async function loadJournal() {
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({
        app: 'journal-management',
        action: 'loadJournal',
        userId: currentUser.email
      })
    });
    const result = await res.json();
    if (result.success && result.journals) {
      journalData = result.journals.sort((a, b) => new Date(a.date) - new Date(b.date));
      // localStorage 캐시도 즉시 갱신
      try {
        const cacheKey = `userdata_${currentUser.email}`;
        const cached = JSON.parse(localStorage.getItem(cacheKey) || '{}');
        cached.journals = journalData;
        localStorage.setItem(cacheKey, JSON.stringify(cached));
      } catch(e) {}
    }
  } catch(e) {
    console.log('수업일지 로드 실패:', e);
  }
  filterJournal();
  updateJournalFilter();
}

function updateJournalFilter() {
  const sel = document.getElementById('js-class');
  if (sel) {
    const classes = [...new Set(journalData.map(j => fmtClass(j.class)).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">전체 학급</option>' + classes.map(c => `<option>${c}</option>`).join('');
    sel.value = journalActiveSearch.cls || '';
  }
  updateJournalYearOptions();
}

function updateJournalYearOptions() {
  const sel = document.getElementById('jl-year-select');
  if (!sel) return;
  if (selectedJournalYear === null) selectedJournalYear = semYear;
  const years = new Set(journalData.map(j => getSchoolYear(j.date)).filter(y => y !== null));
  years.add(semYear);
  years.add(selectedJournalYear);
  const sorted = [...years].sort((a, b) => b - a);
  sel.innerHTML = sorted.map(y => `<option value="${y}"${y === selectedJournalYear ? ' selected' : ''}>${y}학년도</option>`).join('');
}

window.onJournalYearChange = () => {
  const sel = document.getElementById('jl-year-select');
  selectedJournalYear = parseInt(sel.value);
  filterJournal();
};

window.openJournalSearchModal = () => {
  document.getElementById('js-class').value = journalActiveSearch.cls || '';
  document.getElementById('js-name').value = journalActiveSearch.name || '';
  document.getElementById('js-month').value = journalActiveSearch.month || '';
  document.getElementById('journal-search-popup').classList.remove('hidden');
};
window.closeJournalSearchModal = (e) => {
  if (e.target === document.getElementById('journal-search-popup')) closeJournalSearchModalDirect();
};
window.closeJournalSearchModalDirect = () => document.getElementById('journal-search-popup').classList.add('hidden');

window.applyJournalSearch = () => {
  journalActiveSearch = {
    cls: document.getElementById('js-class').value,
    name: document.getElementById('js-name').value.trim(),
    month: document.getElementById('js-month').value
  };
  closeJournalSearchModalDirect();
  filterJournal();
};

window.resetJournalSearch = () => {
  journalActiveSearch = { cls: '', name: '', month: '' };
  document.getElementById('js-class').value = '';
  document.getElementById('js-name').value = '';
  document.getElementById('js-month').value = '';
  filterJournal();
};

window.syncJournal = async () => {
  const btn = document.getElementById('jl-sync-btn');
  if (btn) { btn.disabled = true; btn.textContent = '불러오는 중...'; }
  await loadJournal();
  if (btn) { btn.disabled = false; btn.textContent = '☁ 구글시트 연동'; }
};

window.filterJournal = () => {
  if (selectedJournalYear === null) selectedJournalYear = semYear;
  let filtered = journalData.filter(j => getSchoolYear(j.date) === selectedJournalYear);
  // 이름·내용 모두 빈 행 제외
  filtered = filtered.filter(j => (j.name && j.name.trim()) || (j.content && j.content.trim()));
  if (journalActiveSearch.cls) filtered = filtered.filter(j => fmtClass(j.class) === journalActiveSearch.cls);
  if (journalActiveSearch.name) filtered = filtered.filter(j => j.name && j.name.includes(journalActiveSearch.name));
  if (journalActiveSearch.month) filtered = filtered.filter(j => j.date && j.date.startsWith(journalActiveSearch.month));
  renderJournal(filtered);
};

function fmtJournalDate(d) {
  if (!d) return '';
  const p = String(d).split('-');
  if (p.length < 3) return d;
  return `${parseInt(p[1])}월 ${parseInt(p[2])}일`;
}

function fmtClass(cls) {
  if (!cls) return '';
  const m = String(cls).match(/(\d+-\d+)/);
  return m ? m[1] : cls;
}

function renderJournal(data) {
  const tbody = document.getElementById('journal-body');
  const colSpan = deleteMode ? 7 : 6;
  if (!data.length) { tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;padding:16px;color:#aaa;">기록이 없습니다</td></tr>`; return; }
  tbody.innerHTML = data.map((j, idx) => `
    <tr>
      <td style="text-align:center;color:#aaa;font-size:12px;">${idx + 1}</td>
      <td>${fmtJournalDate(j.date)}</td>
      <td>${j.period || ''}</td>
      <td>${fmtClass(j.class)}</td>
      <td>${j.name || ''}</td>
      <td>${j.content || ''}</td>
      ${deleteMode ? `<td style="text-align:center;"><button class="jl-del-btn" onclick="deleteJournalRow(${j.rowNum})">✕</button></td>` : ''}
    </tr>`).join('');
}

window.toggleDeleteMode = () => {
  deleteMode = !deleteMode;
  const btn = document.getElementById('jl-delete-btn');
  btn.textContent = deleteMode ? '삭제 완료' : '삭제';
  btn.classList.toggle('active', deleteMode);
  const th = document.getElementById('jl-del-th');
  if (th) th.style.display = deleteMode ? '' : 'none';
  filterJournal();
};

window.deleteJournalRow = async (rowNum) => {
  if (!confirm('이 항목을 삭제할까요?')) return;
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'deleteJournal', userId: currentUser.email, rowNum })
    });
    const result = await res.json();
    if (result.success) {
      await loadJournal();
    } else {
      showToast('삭제 실패: ' + result.message, 'error');
    }
  } catch(e) {
    showToast('삭제 중 오류: ' + e.message, 'error');
  }
};

window.exportJournalExcel = () => {
  const rows = [['날짜','교시','학급','학생명','지도내용']];
  journalData.forEach(j => rows.push([j.date, j.period, j.class, j.name, j.content]));
  const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '수업일지.csv'; a.click();
};

// ==================== 시간표 ====================
// 시간표 셀 변경 - ES모듈 전역변수 문제 해결용 window 함수
window.updateMyTT = (p, d, val) => { myTT[p][d] = val; };

function buildMyTT() {
  const body = document.getElementById('my-tt-body');
  if (!body) return;
  body.innerHTML = [1,2,3,4,5,6].map(p => `<tr>
    <td class="period-cell">${myTTLabels[p] || (p + '교시')}<br><span style="font-size:10px;">${TIMES[p-1]}</span></td>
    ${[0,1,2,3,4].map(d => {
      const v = myTT[p]?.[d] || '';
      return `<td class="tt-read-cell${v ? '' : ' empty'}">${v || '—'}</td>`;
    }).join('')}
  </tr>`).join('');
}

window.saveMyTT = () => { /* 구글시트가 단일 원본 — 앱에서 시간표 저장 불필요 */ };

function buildFullTimetable() {
  const el = document.getElementById('full-timetable');
  if (!el) return;
  const semLabel = fullTTSem === 's1' ? '1학기' : '2학기';
  const otherLabel = fullTTSem === 's1' ? '2학기 보기' : '1학기 보기';
  const titleEl = document.getElementById('full-tt-title');
  if (titleEl) titleEl.textContent = `전체 시간표 (${semYear}학년도 ${semLabel})`;
  const btn = document.getElementById('sem-toggle-btn');
  if (btn) btn.textContent = otherLabel;
  const rows = fullTimetableData[fullTTSem] || [];
  if (!rows.length) {
    el.innerHTML = '<div style="font-size:13px;color:#aaa;padding:12px 0;">☁ 구글시트 연동 버튼을 눌러 전체시간표를 불러오세요.<br>구글 시트 [시간표] 탭에서 직접 입력 후 연동합니다.</div>';
    return;
  }
  const DAYS = ['월','화','수','목','금'];
  // col 0=주, 1=기간, 2~31=교시(5일×6교시), 32=비고
  const defaultW = [32, 90, ...Array(30).fill(36), 150];
  const colW = defaultW.map((def, i) => parseInt(localStorage.getItem(`fulltt_c_${i}`) || def));
  // table-layout:fixed는 테이블 width가 auto면 브라우저가 무시하고 자동 레이아웃으로 동작함 — 반드시 width를 컬럼 합계로 명시
  const totalW = colW.reduce((a, b) => a + b, 0);
  let html = `<div class="full-tt-wrap"><table class="full-tt" style="table-layout:fixed;width:${totalW}px;"><colgroup>`;
  colW.forEach(w => html += `<col style="width:${w}px;">`);
  html += '</colgroup><thead>';
  html += `<tr><th rowspan="2">주<span class="syl-col-resizer" onmousedown="startTTColResize(event,0)" onclick="event.stopPropagation()"></span></th>`;
  html += `<th rowspan="2" class="date-cell">기간<span class="syl-col-resizer" onmousedown="startTTColResize(event,1)" onclick="event.stopPropagation()"></span></th>`;
  DAYS.forEach(d => html += `<th colspan="6" class="day-header">${d}</th>`);
  html += `<th rowspan="2" class="day-header note-col-th">비고<span class="syl-col-resizer" onmousedown="startTTColResize(event,32)" onclick="event.stopPropagation()"></span></th></tr><tr>`;
  for (let d=0;d<5;d++) for (let p=0;p<6;p++) {
    const ci = 2 + d*6 + p;
    html += `<th class="period-header">${p+1}<span class="syl-col-resizer" onmousedown="startTTColResize(event,${ci})" onclick="event.stopPropagation()"></span></th>`;
  }
  html += '</tr></thead><tbody>';
  const today = new Date(); today.setHours(0,0,0,0);
  rows.forEach(w => {
    const weekStart = fullTTWeekStartDate(w.period, fullTTSem);
    html += `<tr><td class="week-num">${w.week}</td><td class="date-cell">${w.period||''}</td>`;
    for (let d=0;d<5;d++) for (let p=0;p<6;p++) {
      const cls = w.days && w.days[d] && w.days[d][p] ? w.days[d][p] : '';
      const expected = (myTT[p+1] && myTT[p+1][d]) || '';
      const isClassCode = /^.+\(\d+-\d+\)$/.test(cls);
      const isDiff = isClassCode && cls !== expected;
      let cellDate = null;
      if (weekStart) { cellDate = new Date(weekStart); cellDate.setDate(cellDate.getDate() + d); }
      const isPast = cellDate && cellDate < today;
      const classes = [cls ? 'has-class' : 'empty-cell'];
      if (isPast) classes.push('tt-past');
      const style = isDiff ? ' style="color:#e53935;font-weight:600;"' : '';
      html += `<td class="${classes.join(' ')}"${style}>${cls || '—'}</td>`;
    }
    html += `<td class="note-cell">${w.note||''}</td></tr>`;
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
  // rowspan=2 셀("주"/"기간"/"비고")은 두 줄 높이라 기준으로 쓰면 안 됨 — 1행짜리 day-header로 측정
  const dayHeaderTh = el.querySelector('.full-tt thead .day-header');
  const periodHeaderThs = el.querySelectorAll('.full-tt thead .period-header');
  if (dayHeaderTh && periodHeaderThs.length) {
    const h = dayHeaderTh.getBoundingClientRect().height;
    periodHeaderThs.forEach(th => { th.style.top = h + 'px'; });
  }
}

function fullTTWeekStartDate(period, sem) {
  const m = String(period || '').match(/(\d+)\.\s*(\d+)/);
  if (!m) return null;
  const mo = parseInt(m[1]), day = parseInt(m[2]);
  const yr = (sem === 's2' && mo < 8) ? semYear + 1 : semYear;
  return new Date(yr, mo - 1, day);
}

window.startTTColResize = (e, colIdx) => {
  e.preventDefault();
  e.stopPropagation();
  const table = document.querySelector('#full-timetable .full-tt');
  if (!table) return;
  const col = table.querySelectorAll('col')[colIdx];
  if (!col) return;
  const startX = e.pageX;
  const startW = parseInt(col.style.width) || 36;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  const onMove = ev => {
    col.style.width = Math.max(20, startW + (ev.pageX - startX)) + 'px';
    // 테이블 width도 컬럼 합계로 갱신 — width가 auto가 되면 fixed 레이아웃이 꺼져서 col 폭이 무시됨
    table.style.width = Array.from(table.querySelectorAll('col')).reduce((a, c) => a + (parseInt(c.style.width) || 36), 0) + 'px';
  };
  const onUp = ev => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem(`fulltt_c_${colIdx}`, String(Math.max(20, startW + (ev.pageX - startX))));
    buildFullTimetable(); // 최종 상태를 표 전체 재빌드로 확실히 반영
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
};

window.startNoteColResize = (e, handle) => {
  e.preventDefault();
  e.stopPropagation();
  const th = handle.parentElement;
  const startX = e.pageX;
  const startW = th.offsetWidth;
  document.body.style.cursor = 'col-resize';
  const onMove = ev => { th.style.width = Math.max(60, startW + (ev.pageX - startX)) + 'px'; };
  const onUp = ev => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    localStorage.setItem('fulltt_note_w', String(Math.max(60, startW + (ev.pageX - startX))));
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
};

window.toggleTTSem = () => {
  fullTTSem = fullTTSem === 's1' ? 's2' : 's1';
  buildFullTimetable();
};

window.addClassTT = () => { /* 구글시트 [시간표] 탭에서 학급을 추가하고 "구글시트 연동" 버튼을 누르세요 */ };

window.removeClassTT = async (name) => {
  classTTList = classTTList.filter(c => c.name !== name);
  renderClassTTs();
};


function renderClassTTs() {
  const el = document.getElementById('cls-tt-list');
  if (!el) return;
  if (!classTTList.length) { el.innerHTML = '<div style="font-size:13px;color:#aaa;padding:8px 0;">구글시트에서 학급 시간표를 입력하고 연동하세요.</div>'; return; }
  const grades = {};
  classTTList.forEach(c => { const g = c.name.split('-')[0]; if (!grades[g]) grades[g] = []; grades[g].push(c); });
  el.innerHTML = Object.keys(grades).sort().map(g => `
    <div class="grade-row">
      ${grades[g].map(cls => `
        <div class="cls-wrap">
          <div class="cls-head">
            <div class="cls-name">${cls.name}</div>
          </div>
          <table class="cls-table">
            <thead><tr><th style="width:30px;"></th><th>월</th><th>화</th><th>수</th><th>목</th><th>금</th></tr></thead>
            <tbody>${[0,1,2,3,4,5].map(p => `<tr>
              <td class="p-cell">${(cls.labels && cls.labels[p]) || (p+1)}</td>
              ${[0,1,2,3,4].map(d => {
                const v = cls.tt && cls.tt[p] && cls.tt[p][d] ? cls.tt[p][d] : '';
                const isMine = v && (myTT[p+1] && myTT[p+1][d] === v);
                return `<td class="${isMine?'mine':''}">${v || '—'}</td>`;
              }).join('')}
            </tr>`).join('')}</tbody>
          </table>
        </div>`).join('')}
    </div>`).join('');
}

window.updateClsTT = (name, p, d, val) => {
  const cls = classTTList.find(c => c.name === name);
  if (!cls) return;
  if (!Array.isArray(cls.tt[p])) cls.tt[p] = ['','','','',''];
  cls.tt[p][d] = val;
};

function showToast(msg, type = 'success') {
  // 알림 기능 비활성화 — 사용자 요청으로 모든 토스트/알림 표시 중지
}

window.syncFromGAS = async (btn) => {
  if (!btn) btn = document.querySelector('[onclick^="syncFromGAS"]');
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '불러오는 중...'; }
  try {
    const userId = currentUser.email;
    apiCache.delete('loadAll_' + userId);
    localStorage.removeItem(`userdata_${userId}_ts`);
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'loadAll', userId })
    });
    const d = await res.json();
    if (d.success) {
      applyUserData(d);
      localStorage.setItem(`userdata_${userId}_ts`, String(Date.now()));
      localStorage.setItem(`userdata_${userId}`, JSON.stringify({
        myTT, myTTLabels, classTTList, syllabusData, journals: journalData, timetableEvents,
        semDatesByYear, subjectHoursData, fullTimetable: fullTimetableData, subjectHoursClasses
      }));
      buildMyTT(); renderClassTTs(); buildFullTimetable(); buildSyllabus(); filterJournal(); buildSubjectHoursFromGAS();
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      showToast('구글시트 연동 완료 ✓');
    } else {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      showToast('연동 실패: ' + (d.message || ''), 'error');
    }
  } catch(e) {
    console.error('연동 오류:', e);
    if (btn) { btn.disabled = false; btn.textContent = origText; }
    showToast('연동 오류가 발생했습니다', 'error');
  }
};

window.downloadTTExcel = () => {
  const rows = [['교시', '월', '화', '수', '목', '금']];
  for (let p = 1; p <= 6; p++) rows.push([`${p}교시`, '', '', '', '', '']);
  const csv = '﻿' + rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '시간표_양식.csv'; a.click();
};

window.handleTTUpload = (input) => { input.value = ''; };

window.calcSubjectHours = async (btn) => {
  if (!btn) btn = document.querySelector('[onclick^="calcSubjectHours"]');
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '계산 중...'; }
  try {
    const userId = currentUser.email;
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'loadAll', userId })
    });
    const d = await res.json();
    if (d.success) {
      if (d.subjectHoursData) subjectHoursData = d.subjectHoursData;
      if (d.subjectHoursClasses) subjectHoursClasses = d.subjectHoursClasses;
      localStorage.setItem(`userdata_${userId}_ts`, String(Date.now()));
      buildSubjectHoursFromGAS();
      showToast('시수 계산 완료 ✓');
    } else {
      showToast('시수 계산 실패: ' + (d.message || ''), 'error');
    }
  } catch(e) {
    console.error('시수 계산 오류:', e);
    showToast('시수 계산 중 오류가 발생했습니다', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
};

function buildSubjectHoursFromGAS() {
  const el = document.getElementById('subject-hours-result');
  if (!el) return;
  if (!subjectHoursClasses.length) {
    el.innerHTML = '<div style="font-size:13px;color:#aaa;padding:8px 0;">☁ 구글시트 연동 버튼을 눌러 시수 데이터를 불러오세요.<br>구글 시트 [시간표] 탭 [시수계산표] 구역에서 학급 목록과 주당시수를 입력하세요.</div>';
    return;
  }
  let html = `<table class="tt-hours-table"><thead><tr>
    <th style="text-align:left;">학급</th>
    <th>1학기 기준</th><th>1학기 실제</th>
    <th>2학기 기준</th><th>2학기 실제</th>
    <th>시수체크</th>
  </tr></thead><tbody>`;
  subjectHoursClasses.forEach(cls => {
    const d = subjectHoursData[cls] || {};
    const s1diff = (d.s1actual||0) - (d.s1base||0);
    const s2diff = (d.s2actual||0) - (d.s2base||0);
    const s1style = s1diff !== 0 ? 'color:#e53935;background:#FDECEA;' : '';
    const s2style = s2diff !== 0 ? 'color:#e53935;background:#FDECEA;' : '';
    html += `<tr>
      <td class="row-subject">${cls}</td>
      <td>${d.s1base||0}</td><td style="${s1style}"><b>${d.s1actual||0}</b></td>
      <td>${d.s2base||0}</td><td style="${s2style}"><b>${d.s2actual||0}</b></td>
      <td><b>${d.check||0}</b></td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

window.downloadMyTTTemplate = () => {
  const csv = '\uFEFF교시,월,화,수,목,금\n' + [1,2,3,4,5,6].map(p => `${p}교시,,,,,`).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '내_시간표_양식.csv'; a.click();
};

window.downloadClsTTTemplate = () => {
  const csv = '\uFEFF학급,교시,월,화,수,목,금\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '담당학급_시간표_양식.csv'; a.click();
};

window.handleMyTTUpload = (input) => { input.value = ''; };
window.handleClsTTUpload = (input) => { input.value = ''; };

// ==================== 진도표 ====================
function isDone(r) {
  return r.done === true || r.done === 'true' || r.done === 'TRUE';
}

function sylCell(val, field, r, idx, subjectEsc) {
  const strVal = String(val||'');
  const runs = r._links && r._links[field]; // [{text,url}] 배열 또는 null

  // 줄바꿈 분리 (Google Sheets 셀 내 Alt+Enter)
  const lines = strVal.split('\n').map(l => l.trim()).filter(l => l);

  // 멀티라인: URL 섞인 경우만 기존 div 방식, 순수 텍스트 멀티라인은 textarea
  if (lines.length > 1 || (runs && runs.length > 1)) {
    const hasUrls = (runs && runs.some(rn => rn.url)) || lines.some(l => l.startsWith('http'));
    if (hasUrls) {
      const useRuns = runs && runs.length > 1;
      const items = useRuns ? runs.map(rn => rn.text) : lines;
      return `<div class="syl-multiline">${items.map((line, li) => {
        const run = useRuns ? runs[li] : (runs && runs[li]);
        const url = (run && run.url) || (line.startsWith('http') ? line : '');
        const safeUrl = url ? url.replace(/"/g,'&quot;') : '';
        const safeText = line.replace(/</g,'&lt;').replace(/>/g,'&gt;');
        if (url) return `<div class="syl-cell-line"><a href="${safeUrl}" target="_blank" rel="noopener" class="syl-text-link" onclick="event.stopPropagation()">${safeText}</a></div>`;
        return `<div class="syl-cell-line"><span class="syl-line-text">${safeText}</span></div>`;
      }).join('')}</div>`;
    }
    // URL 없는 멀티라인 → textarea로 편집 가능
    const joined = lines.join('\n');
    const taEsc = joined.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<textarea rows="${Math.min(lines.length, 5)}" class="syl-cell-input" oninput="autoGrowSyl(this)" onchange="this.classList.add('syl-dirty');updateSylField('${subjectEsc}',${idx},'${field}',this.value)">${taEsc}</textarea>`;
  }

  // 단일값: 링크 있으면 보라색 클릭 링크, 없으면 텍스트처럼 보이는 textarea
  const url = (runs && runs[0] && runs[0].url) ||
              (strVal.startsWith('http') ? strVal : '');
  if (url) {
    const safeUrl = url.replace(/"/g,'&quot;');
    const safeText = strVal.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<a href="${safeUrl}" target="_blank" rel="noopener" class="syl-text-link" onclick="event.stopPropagation()">${safeText}</a>`;
  }
  const taEsc = strVal.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<textarea rows="1" class="syl-cell-input" oninput="autoGrowSyl(this)" onchange="this.classList.add('syl-dirty');updateSylField('${subjectEsc}',${idx},'${field}',this.value)">${taEsc}</textarea>`;
}

const CONCEPT_ICONS = [
  { key: '공통',     icon: 'ti-books',   color: '#5F5E5A', bg: '#F1EFE8' },
  { key: '우주',     icon: 'ti-planet',  color: '#534AB7', bg: '#EEEDFE' },
  { key: '몸',       icon: 'ti-man',     color: '#993556', bg: '#FBEAF0' },
  { key: '물질',     icon: 'ti-flask',   color: '#185FA5', bg: '#E6F1FB' },
  { key: '동물',     icon: 'ti-paw',     color: '#3B6D11', bg: '#EAF3DE' },
  { key: '식물',     icon: 'ti-leaf',    color: '#0F6E56', bg: '#E1F5EE' },
  { key: '소리',     icon: 'ti-volume',  color: '#854F0B', bg: '#FAEEDA' },
  { key: '기타생물', icon: 'ti-virus',   color: '#085041', bg: '#E1F5EE' },
  { key: '빛과렌즈', icon: 'ti-bulb',    color: '#BA7517', bg: '#FAEEDA' },
  { key: '에너지효율', icon: 'ti-bolt',  color: '#993C1D', bg: '#FAECE7' },
];

const CONCEPT_ICON_POOL = [
  { icon: 'ti-bolt',        color: '#993C1D', bg: '#FAECE7' },
  { icon: 'ti-droplet',     color: '#0B5394', bg: '#E3EEFA' },
  { icon: 'ti-mountain',    color: '#4B5320', bg: '#EEF2E3' },
  { icon: 'ti-cloud',       color: '#5B7C99', bg: '#EAF1F6' },
  { icon: 'ti-atom',        color: '#7A3E9D', bg: '#F3E8FA' },
  { icon: 'ti-seeding',     color: '#2E7D32', bg: '#E5F3E6' },
  { icon: 'ti-thermometer', color: '#B33939', bg: '#FBEAEA' },
  { icon: 'ti-magnet',      color: '#8E44AD', bg: '#F1E8F7' },
  { icon: 'ti-wind',        color: '#2F7A78', bg: '#E4F2F1' },
  { icon: 'ti-sun',         color: '#B8860B', bg: '#FBF3DD' },
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getConceptStyle(key) {
  const known = CONCEPT_ICONS.find(c => c.key === key);
  if (known) return known;
  const pick = CONCEPT_ICON_POOL[hashStr(key) % CONCEPT_ICON_POOL.length];
  return { key, ...pick };
}

function buildConceptIcons() {
  const bar = document.getElementById('concept-icons-bar');
  if (!bar) return;
  const allKeys = CONCEPT_ICONS.map(c => c.key);
  Object.keys(conceptLinksData).forEach(k => { if (!allKeys.includes(k)) allKeys.push(k); });
  bar.innerHTML = allKeys.map(key => {
    const c = getConceptStyle(key);
    const hasLinks = (conceptLinksData[c.key] || []).length > 0;
    const keyEsc = c.key.replace(/'/g,"\\'");
    return `<div class="concept-icon-btn"${hasLinks ? ` onmouseenter="showConceptOverlay('${keyEsc}',event)" onmouseleave="scheduleHideConceptOverlay()"` : ''}>
      <div class="concept-icon-circle" style="background:${c.bg};border-color:${c.color}40;">
        <i class="ti ${c.icon}" style="color:${c.color};font-size:18px;" aria-hidden="true"></i>
      </div>
      <span class="concept-icon-label">${c.key}</span>
    </div>`;
  }).join('');
}

let _conceptHideTimer = null;

window.showConceptOverlay = (key, ev) => {
  clearTimeout(_conceptHideTimer);
  const links = conceptLinksData[key] || [];
  if (!links.length) return;
  const overlay = document.getElementById('concept-overlay');
  const body = document.getElementById('concept-overlay-body');
  document.getElementById('concept-overlay-title').style.display = 'none';
  body.innerHTML = links.map(lk => {
    const safeUrl = lk.url.replace(/"/g,'&quot;');
    const safeTopic = (lk.topic||lk.url).replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeSubcat = (lk.subcat||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const label = safeSubcat ? `[${safeSubcat}]${safeTopic}` : safeTopic;
    return `<div class="concept-popup-row" onclick="window.open('${safeUrl}','_blank')">${label}</div>`;
  }).join('');
  overlay.style.display = 'flex';

  // 호버한 아이콘 바로 아래에 팝업 위치 (화면 밖으로 넘치지 않게 보정)
  const iconEl = ev && (ev.currentTarget || ev.target);
  if (iconEl && iconEl.getBoundingClientRect) {
    const r = iconEl.getBoundingClientRect();
    const ow = overlay.offsetWidth || 320;
    let left = r.left;
    if (left + ow > window.innerWidth - 8) left = window.innerWidth - ow - 8;
    if (left < 8) left = 8;
    overlay.style.left = left + 'px';
    overlay.style.top = (r.bottom + 4) + 'px';
    overlay.style.transform = 'none';
  }
};

window.scheduleHideConceptOverlay = () => {
  _conceptHideTimer = setTimeout(() => {
    const overlay = document.getElementById('concept-overlay');
    if (overlay) overlay.style.display = 'none';
  }, 200);
};

window.cancelHideConceptOverlay = () => { clearTimeout(_conceptHideTimer); };

window.hideConceptOverlay = () => {
  clearTimeout(_conceptHideTimer);
  const overlay = document.getElementById('concept-overlay');
  if (overlay) overlay.style.display = 'none';
};

window.toggleSylSem = () => {
  sylSem = sylSem === 's1' ? 's2' : 's1';
  buildSyllabus();
};

function buildSyllabus() {
  const subjects = Object.keys(syllabusData);
  const tabBar = document.getElementById('syllabus-tabs');
  const content = document.getElementById('syllabus-content');
  const semBtn = document.getElementById('syl-sem-toggle-btn');
  if (semBtn) semBtn.textContent = sylSem === 's1' ? '2학기 보기' : '1학기 보기';
  tabBar.innerHTML = subjects.map((s, i) =>
    `<button class="sub-tab${i===0?' active':''}" onclick="switchSyllabus('${s.replace(/'/g,"\\'")}',this)">${s}</button>`
  ).join('');
  if (!subjects.length) {
    content.innerHTML = '<div style="font-size:15px;color:#aaa;padding:20px 0;">위의 <b>+ 과목 추가</b> 버튼으로 과목을 등록하거나, CSV 업로드 또는 구글 시트 연동을 이용하세요.</div>';
    return;
  }
  content.innerHTML = subjects.map((s, i) => {
    const sId = s.replace(/ /g,'_').replace(/'/g,'');
    const sAttr = s.replace(/"/g,'&quot;');
    const sEsc = s.replace(/'/g,"\\'");
    const ths = SYL_COLS.map((c, ci) =>
      `<th style="${c.style}position:relative;">${c.label}${ci < SYL_COLS.length-1
        ? `<span class="syl-col-resizer" onmousedown="startSylColResize(event,this,'${sEsc}',${ci})" onclick="event.stopPropagation()"></span>` : ''}</th>`
    ).join('');
    return `<div class="sub-content${i===0?' active':''}" id="syl-${sId}">
      <div class="table-wrap">
      <table class="syl-table" data-subject="${sAttr}">
        <thead><tr>${ths}</tr></thead>
        <tbody>${sylItems(s, sylSem).map((r,idx) => {
          const done = isDone(r);
          const se = s.replace(/'/g,"\\'");
          const linksEsc = (r.links||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
          return `<tr class="${done ? 'syl-done-row' : ''}" onclick="selectSylRow('${se}',${idx},'${linksEsc}')" style="cursor:pointer;">
            <td style="text-align:center;"><input type="checkbox" class="syl-done-check" ${done ? 'checked' : ''} onchange="toggleDone('${se}',${idx},this.checked)" onclick="event.stopPropagation()"></td>
            <td style="text-align:center;" class="syl-seq-cell">
              <span class="syl-seq">${idx+1}</span>
              <button class="syl-link-icon syl-link-empty" onclick="event.stopPropagation();openSylLinkEditor('${se}',${idx})" title="링크 추가/편집">+</button>
            </td>
            <td>${sylCell(r.period,'period',r,idx,se)}</td>
            <td style="text-align:center;">${sylCell(r.ch,'ch',r,idx,se)}</td>
            <td>${r.unitUrl ? `<span class="syl-unit-link" onclick="event.stopPropagation();window.open('${r.unitUrl.replace(/'/g,"\\'").replace(/"/g,'&quot;')}','_blank')">${r.unit||''}</span>` : sylCell(r.unit,'unit',r,idx,se)}</td>
            <td>${r.topicUrl ? `<span class="syl-unit-link" onclick="event.stopPropagation();window.open('${r.topicUrl.replace(/'/g,"\\'").replace(/"/g,'&quot;')}','_blank')">${r.topic||''}</span>` : sylCell(r.topic,'topic',r,idx,se)}</td>
            <td>${sylCell(r.prep,'prep',r,idx,se)}</td>
            <td>${sylCell(r.memo,'memo',r,idx,se)}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
  }).join('');
  applyAllSylColWidths();
  // 진도표 셀 textarea 초기 높이 맞추기
  document.querySelectorAll('#syllabus-content .syl-cell-input').forEach(autoGrowSyl);
}

// 진도표 셀 textarea 자동 높이 조절
window.autoGrowSyl = (el) => {
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight) + 'px';
};

// 진도표 컬럼 너비 — 과목별 localStorage 저장
const SYL_COLS = [
  { label:'완료',   style:'width:44px;text-align:center;' },
  { label:'순서',   style:'width:44px;text-align:center;' },
  { label:'기간',   style:'width:80px;' },
  { label:'차시',   style:'width:52px;text-align:center;' },
  { label:'단원',   style:'width:220px;' },
  { label:'학습주제', style:'width:200px;' },
  { label:'준비물',  style:'width:100px;' },
  { label:'메모',   style:'width:300px;' },
];

function sylColKey(subject){ return 'sylColW_' + subject; }

function applyAllSylColWidths() {
  document.querySelectorAll('.syl-table[data-subject]').forEach(table => {
    const subject = table.dataset.subject;
    let widths = {};
    try { widths = JSON.parse(localStorage.getItem(sylColKey(subject)) || '{}'); } catch(e) {}
    const ths = table.querySelectorAll('thead th');
    ths.forEach((th, i) => { if (widths[i]) th.style.width = widths[i] + 'px'; });
  });
}

window.startSylColResize = (e, handle, subject, colIdx) => {
  e.preventDefault();
  e.stopPropagation();
  const th = handle.parentElement;
  const startX = e.pageX;
  const startW = th.offsetWidth;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  const onMove = ev => {
    const w = Math.max(36, startW + (ev.pageX - startX));
    th.style.width = w + 'px';
  };
  const onUp = ev => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const w = Math.max(36, startW + (ev.pageX - startX));
    let widths = {};
    try { widths = JSON.parse(localStorage.getItem(sylColKey(subject)) || '{}'); } catch(e) {}
    widths[colIdx] = w;
    try { localStorage.setItem(sylColKey(subject), JSON.stringify(widths)); } catch(e) {}
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
};

window.selectSylRow = (subject, idx, linksRaw) => {
  document.querySelectorAll('.syl-table tbody tr').forEach(tr => tr.classList.remove('syl-row-selected'));
  const rows = document.querySelectorAll(`#syl-${subject.replace(/ /g,'_')} tbody tr`);
  if (rows[idx]) rows[idx].classList.add('syl-row-selected');
};

window.openSylRowLink = (linksRaw) => {
  const parts = linksRaw.split('|').map(p => {
    const comma = p.indexOf(',');
    if (comma < 0) return { url: p.trim() };
    return { topic: p.slice(0, comma).trim(), url: p.slice(comma + 1).trim() };
  }).filter(l => l.url);
  if (!parts.length) return;
  if (parts.length === 1) { window.open(parts[0].url, '_blank'); return; }
  parts.forEach(l => window.open(l.url, '_blank'));
};

// 링크 편집 팝업
window.openSylLinkEditor = (subject, idx) => {
  const current = sylSubjectSem(subject)?.[idx]?.links || '';
  const val = prompt(
    `링크 입력 (형식: 주제,URL|주제,URL)\n예) 물의상태변화,https://....|상태변화,https://...`,
    current
  );
  if (val === null) return;
  updateSylField(subject, idx, 'links', val);
  buildSyllabus();
  showLinks(val);
};

function showLinks(linksStr) {
  const hint = document.getElementById('link-area-hint');
  const buttons = document.getElementById('link-buttons');
  if (!hint || !buttons) return;
  if (!linksStr || !linksStr.trim()) {
    buttons.innerHTML = '';
    hint.style.display = 'inline';
    return;
  }
  hint.style.display = 'none';
  const pairs = linksStr.split('|');
  buttons.innerHTML = pairs.map(pair => {
    const commaIdx = pair.indexOf(',');
    if (commaIdx < 0) return '';
    const text = pair.slice(0, commaIdx).trim();
    const url = pair.slice(commaIdx + 1).trim();
    if (!url) return '';
    const safeText = text.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeUrl = url.replace(/"/g,'&quot;');
    return `<button class="link-btn" onclick="window.open('${safeUrl}','_blank','width=1000,height=700')" title="${safeUrl}">${safeText || url}</button>`;
  }).filter(Boolean).join('');
}

window.updateLinkArea = (subject, idx) => {
  const links = sylSubjectSem(subject)?.[idx]?.links || '';
  showLinks(links);
};

window.switchSyllabus = (name, el) => {
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sub-content').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  const el2 = document.getElementById('syl-' + name.replace(/ /g,'_'));
  if (el2) {
    el2.classList.add('active');
    // 숨겨진 탭이었을 때 textarea 높이가 0px로 박제됨 → 보이는 순간 다시 계산(단일행 칸 누락 방지)
    el2.querySelectorAll('.syl-cell-input').forEach(autoGrowSyl);
  }
};

window.toggleDone = async (subject, idx, checked) => {
  const items = sylSubjectSem(subject);
  if (!items?.[idx]) return;
  items[idx].done = checked;
  const activeTab = document.querySelector('.sub-tab.active');
  const activeName = activeTab ? activeTab.textContent.replace(/×$/, '').trim() : null;
  buildSyllabus();
  if (activeName) {
    const tab = [...document.querySelectorAll('.sub-tab')].find(t => t.textContent.replace(/×$/, '').trim() === activeName);
    if (tab) switchSyllabus(activeName, tab);
  }
  if (selectedDate) renderWeek(selectedDate, selectedDow); // 메인 카드 진도 즉시 갱신
  // 완료(A열)만 구글시트에 즉시 반영 — 내용/구조는 안 건드림(안전 경로)
  let synced = false;
  try {
    const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({
      app: 'journal-management', action: 'saveDoneFlag',
      userId: currentUser.email, subject, index: idx, done: checked,
      semester: sylSem === 's1' ? '1학기' : '2학기' }) });
    const d = await res.json();
    synced = !!d.success;
  } catch(e) {}
  // 로컬 캐시 갱신(새로고침해도 유지). 시트 반영 실패 시에만 '저장 필요' 표시.
  try {
    const ck = `userdata_${currentUser.email}`;
    const prev = JSON.parse(localStorage.getItem(ck) || '{}');
    localStorage.setItem(ck, JSON.stringify({ ...prev, syllabusData }));
  } catch(e) {}
  apiCache.delete('loadAll_' + currentUser.email);
  if (!synced) markSylUnsaved();
};


function markSylUnsaved() {}
function clearSylUnsaved() {
  document.querySelectorAll('.syl-cell-input.syl-dirty').forEach(el => el.classList.remove('syl-dirty'));
}

window.saveSyllabus = async () => {
  const subjects = Object.keys(syllabusData);
  try {
    for (const subject of subjects) {
      for (const sem of ['s1', 's2']) {
        const items = sylItems(subject, sem);
        if (!items.length) continue;
        await fetch(GAS_URL, {
          method: 'POST',
          body: JSON.stringify({
            app: 'journal-management',
            action: 'saveSyllabus',
            userId: currentUser.email,
            subject,
            sylData: items,
            semester: sem === 's1' ? '1학기' : '2학기'
          })
        });
      }
    }
    apiCache.delete('loadAll_' + currentUser.email);
    // 로컬 캐시도 갱신 — 새로고침해도 방금 저장한 내용 유지
    try {
      const ck = `userdata_${currentUser.email}`;
      const prev = JSON.parse(localStorage.getItem(ck) || '{}');
      localStorage.setItem(ck, JSON.stringify({ ...prev, syllabusData }));
    } catch(e) {}
    clearSylUnsaved();
    showToast('진도표가 저장되었습니다!');
  } catch(e) {
    showToast('저장 중 오류: ' + e.message, 'error');
  }
};

// ==================== 구글 시트 연동 ====================

window.updateSylField = (subject, idx, field, val) => {
  const items = sylSubjectSem(subject);
  if (items?.[idx]) {
    items[idx][field] = val;
    scheduleSylAutoSave(); // 4번: 변경 즉시 자동저장 예약
  }
};
window.connectSheets = async () => {
  const url = document.getElementById('sheets-url').value.trim();
  const journalTab = document.getElementById('sheets-journal').value.trim();
  const timetableInput = document.getElementById('sheets-timetable').value.trim();
  const syllabusInput = document.getElementById('sheets-syllabus').value.trim();

  if (!url) return;
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return;
  const id = match[1];

  const timetableTabs = timetableInput ? timetableInput.split(',').map(s => s.trim()).filter(Boolean) : [];
  const syllabusTabs = syllabusInput ? syllabusInput.split(',').map(s => s.trim()).filter(Boolean) : [];

  if (!journalTab && !timetableTabs.length && !syllabusTabs.length) return;

  const btn = document.getElementById('sheets-connect-btn');
  btn.textContent = '불러오는 중...'; btn.disabled = true;
  try {
    const result = await loadFromSheets(id, journalTab, timetableTabs, syllabusTabs);
    sheetsUrl = url;
    await saveUserData();
    updateSheetsBtn(true);
    buildMyTT(); renderClassTTs(); buildSyllabus(); buildProgress(); loadJournal();
    closeSheetsModalDirect();
  } catch(e) {
    console.error('불러오기 실패:', e);
  } finally {
    btn.textContent = '불러오기'; btn.disabled = false;
  }
};

function parseCSV(text) {
  const rows = [];
  for (const line of text.trim().split('\n')) {
    const cols = []; let cur = '', inQ = false;
    for (const c of line) {
      if (c === '"') inQ = !inQ;
      else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

async function loadFromSheets(id, names) {
  const base = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=`;
  const result = [];
  for (const name of names) {
    const res = await fetch(base + encodeURIComponent(name));
    if (!res.ok) { result.push(`❌ "${name}" - 시트를 찾을 수 없음`); continue; }
    const text = await res.text();
    if (text.trim().startsWith('<!')) { result.push(`❌ "${name}" - 접근 거부 (공개 설정 확인)`); continue; }
    const rows = parseCSV(text);
    if (!rows.length || !rows[0].length) { result.push(`⚠ "${name}" - 데이터 없음`); continue; }
    const headers = rows[0].map(h => h.toLowerCase());
    if (headers.includes('교시') && (headers.includes('월') || headers.includes('화'))) {
      // 내 시간표
      for (let i = 1; i < rows.length; i++) {
        const p = parseInt(rows[i][0]);
        if (p >= 1 && p <= 5) {
          myTT[p] = [rows[i][1]||'', rows[i][2]||'', rows[i][3]||'', rows[i][4]||'', rows[i][5]||''];
        }
      }
      result.push(`✅ "${name}" → 내 시간표 (${rows.length-1}교시)`);
    } else if (headers.includes('차시') || headers.includes('단원')) {
      // 진도표
      const chIdx = headers.indexOf('차시'), unitIdx = headers.indexOf('단원');
      const topicIdx = headers.indexOf('학습주제'), prepIdx = headers.indexOf('준비물'), statusIdx = headers.indexOf('상태');
      syllabusData[name] = rows.slice(1).filter(r => r[chIdx||0]).map(r => ({
        ch: r[chIdx]||'', unit: r[unitIdx>=0?unitIdx:1]||'', topic: r[topicIdx>=0?topicIdx:2]||'',
        prep: r[prepIdx>=0?prepIdx:3]||'', status: r[statusIdx>=0?statusIdx:4]||'todo'
      }));
      result.push(`✅ "${name}" → 진도표 (${syllabusData[name].length}차시)`);
    } else if (/^\d+-\d+$/.test(name)) {
      // 담당 학급 시간표 (예: 3-1)
      const existing = classTTList.find(c => c.name === name);
      const tt = [0,1,2,3,4].map(p => [0,1,2,3,4].map(d => (rows[p+1] && rows[p+1][d+1]) ? rows[p+1][d+1] : ''));
      if (existing) existing.tt = tt;
      else { classTTList.push({ name, tt }); classTTList.sort((a,b) => a.name.localeCompare(b.name)); }
      result.push(`✅ "${name}" → 담당 학급 시간표`);
    } else {
      result.push(`⚠ "${name}" - 형식 인식 불가 (헤더: ${rows[0].slice(0,3).join(', ')})`);
    }
  }
  return result;
};

window.downloadSheetsTemplate = () => {
  const csv = '\uFEFF시트 구성 안내\n시트1: 내 시간표\n교시,월,화,수,목,금\n1교시,,,,,\n\n시트2~: 학급 시간표\n교시,월,화,수,목,금\n\n진도표 시트: 과목명\n차시,단원,학습주제,준비물,상태\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '구글시트_양식안내.csv'; a.click();
};

// ==================== 사용설명서 ====================
// ==================== 구글 시트 연동 상태 모달 ====================
window.openSheetsModal = () => {
  document.getElementById('sheets-modal').classList.remove('hidden');
  testSheetsConnection();
};
window.closeSheetsModal = (e) => { if (e.target === document.getElementById('sheets-modal')) closeSheetsModalDirect(); };
window.closeSheetsModalDirect = () => document.getElementById('sheets-modal').classList.add('hidden');

window.testSheetsConnection = async () => {
  const box = document.getElementById('sheets-status-box');
  const btn = document.getElementById('sheets-connect-btn');
  box.innerHTML = '<div style="font-size:15px;color:#aaa;text-align:center;">연결 확인 중...</div>';
  btn.disabled = true;
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'loadJournal', userId: currentUser.email })
    });
    const result = await res.json();
    if (result.success) {
      box.innerHTML = `
        <div style="text-align:center;padding:8px 0;">
          <div style="font-size:28px;margin-bottom:8px;">✅</div>
          <div style="font-size:16px;font-weight:500;color:#27500A;">구글 시트 연결됨</div>
          <div style="font-size:13px;color:#aaa;margin-top:6px;">수업일지 ${result.journals?.length || 0}건 확인</div>
        </div>`;
      updateSheetsBtn(true);
    } else {
      throw new Error(result.message);
    }
  } catch(e) {
    box.innerHTML = `
      <div style="text-align:center;padding:8px 0;">
        <div style="font-size:28px;margin-bottom:8px;">❌</div>
        <div style="font-size:16px;font-weight:500;color:#A32D2D;">연결 실패</div>
        <div style="font-size:12px;color:#aaa;margin-top:6px;">${e.message}</div>
      </div>`;
    updateSheetsBtn(false);
  } finally {
    btn.disabled = false;
  }
};

function updateSheetsBtn(connected) {
  const btn = document.getElementById('sheets-btn');
  const icon = document.getElementById('sheets-status-icon');
  const text = document.getElementById('sheets-status-text');
  if (!btn) return;
  if (connected) {
    btn.classList.add('connected');
    icon.textContent = '☁';
    text.textContent = '구글 시트 연결됨 ✓';
  } else {
    btn.classList.remove('connected');
    icon.textContent = '☁';
    text.textContent = '구글 시트 연결 확인';
  }
}

window.openHelp = () => document.getElementById('help-modal').classList.remove('hidden');
window.closeHelp = (e) => { if (e.target === document.getElementById('help-modal')) closeHelpDirect(); };
window.closeHelpDirect = () => document.getElementById('help-modal').classList.add('hidden');

// ==================== 탭 전환 ====================
window.switchTab = (name, el) => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => { c.classList.remove('active'); c.classList.add('hidden'); });
  el.classList.add('active');
  const tc = document.getElementById('tab-' + name);
  tc.classList.remove('hidden');
  tc.classList.add('active');
  if (name === 'journal') loadJournal();
};

function isNonSchoolDate(dateObj) {
  const s1 = getSemDates(semYear, 1), s2 = getSemDates(semYear, 2);
  const inSemester = (dateObj >= s1.start && dateObj <= s1.end) || (dateObj >= s2.start && dateObj <= s2.end);
  return !inSemester; // 학기 범위 밖 = 자동 방학
}

function semesterKeyForDate(dateObj) {
  const s1 = getSemDates(semYear, 1), s2 = getSemDates(semYear, 2);
  if (dateObj >= s1.start && dateObj <= s1.end) return 's1';
  if (dateObj >= s2.start && dateObj <= s2.end) return 's2';
  return 's1';
}

// ==================== 학기 시작/종료일 ====================
window.openSemDateModal = () => {
  renderSemDateInputs();
  document.getElementById('sem-date-modal').classList.remove('hidden');
};
window.closeSemDateModal = (e) => { if (e.target === document.getElementById('sem-date-modal')) closeSemDateModalDirect(); };
window.closeSemDateModalDirect = () => document.getElementById('sem-date-modal').classList.add('hidden');

window.setSemDateField = (half, field, val) => {
  const key = half === 1 ? 's1' : 's2';
  if (!semDatesByYear[semYear]) semDatesByYear[semYear] = {};
  if (!semDatesByYear[semYear][key]) semDatesByYear[semYear][key] = { start: '', end: '' };
  semDatesByYear[semYear][key][field] = val;
  saveVacationAndHours();
  buildFullTimetable();
};

function renderSemDateInputs() {
  const cur = semDatesByYear[semYear] || {};
  const s1 = cur.s1 || {}, s2 = cur.s2 || {};
  const s1El = document.getElementById('sem1-start'), s1EEl = document.getElementById('sem1-end');
  const s2El = document.getElementById('sem2-start'), s2EEl = document.getElementById('sem2-end');
  if (s1El) s1El.value = s1.start || '';
  if (s1EEl) s1EEl.value = s1.end || '';
  if (s2El) s2El.value = s2.start || '';
  if (s2EEl) s2EEl.value = s2.end || '';
}

// ==================== 3번: 과목별 시수 ====================
function buildSubjectHours() {
  const el = document.getElementById('subject-hours-wrap');
  if (!el) return;
  const subjects = Object.keys(syllabusData);
  if (!subjects.length) {
    el.innerHTML = '<div style="font-size:13px;color:#aaa;">진도표 탭에서 과목을 먼저 추가하세요.</div>';
    return;
  }
  el.innerHTML = `<table class="subject-hours-table">
    <thead><tr>
      <th>과목명</th>
      <th>1학기 필요시수</th><th>1학기 현재시수</th>
      <th>2학기 필요시수</th><th>2학기 현재시수</th>
    </tr></thead>
    <tbody>${subjects.map(s => {
      const h = subjectHoursData[s] || { s1req: 0, s2req: 0 };
      const items = syllabusData[s] || [];
      const doneCount = items.filter(r => isDone(r)).length;
      const total = items.length;
      const s1done = Math.min(doneCount, h.s1req || total);
      const s2done = Math.max(0, doneCount - (h.s1req || 0));
      const s1pct = h.s1req ? Math.min(100, Math.round(s1done/h.s1req*100)) : 0;
      const s2pct = h.s2req ? Math.min(100, Math.round(s2done/h.s2req*100)) : 0;
      return `<tr>
        <td><b>${s}</b></td>
        <td><input type="number" min="0" value="${h.s1req||0}" onchange="setSubjectHours('${s.replace(/'/g,"\\'")}','s1req',this.value)" style="width:70px;padding:4px 6px;border:0.5px solid #ddd;border-radius:4px;text-align:center;"></td>
        <td class="sh-cur ${s1pct>=100?'sh-done':''}">${s1done}/${h.s1req||'?'} <small>(${s1pct}%)</small></td>
        <td><input type="number" min="0" value="${h.s2req||0}" onchange="setSubjectHours('${s.replace(/'/g,"\\'")}','s2req',this.value)" style="width:70px;padding:4px 6px;border:0.5px solid #ddd;border-radius:4px;text-align:center;"></td>
        <td class="sh-cur ${s2pct>=100?'sh-done':''}">${s2done}/${h.s2req||'?'} <small>(${s2pct}%)</small></td>
      </tr>`;
    }).join('')}
    </tbody>
  </table>`;
}

window.setSubjectHours = (subject, key, val) => {
  if (!subjectHoursData[subject]) subjectHoursData[subject] = {};
  subjectHoursData[subject][key] = parseInt(val) || 0;
};

window.saveSubjectHoursData = async () => {
  await saveVacationAndHours();
  buildSubjectHours();
  showToast('저장되었습니다!');
};

async function saveVacationAndHours() {
  const cacheKey = `userdata_${currentUser?.email}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    const prev = cached ? JSON.parse(cached) : {};
    localStorage.setItem(cacheKey, JSON.stringify({ ...prev, semDatesByYear, subjectHoursData }));
  } catch(e) {}
}

// ==================== 3번: 연간 시간표 생성 ====================
window.generateAnnualTT = () => {
  const section = document.getElementById('annual-tt-section');
  const resultEl = document.getElementById('annual-tt-result');
  if (!section || !resultEl) return;
  section.style.display = 'block';

  const subjects = Object.keys(syllabusData);
  // 과목별 남은 시수 카운터
  const hoursLeft = {};
  subjects.forEach(s => {
    const h = subjectHoursData[s] || {};
    hoursLeft[s] = { s1: h.s1req || 999, s2: h.s2req || 999 };
  });

  const DAYS = ['월','화','수','목','금'];
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const fmtDisp = d => `${d.getMonth()+1}.${d.getDate()}`;

  let html = '';
  for (const half of [1, 2]) {
    const sem = getSemDates(semYear, half);
    let cur = new Date(sem.start);
    const byMonth = {};
    while (cur <= sem.end) {
      if (cur.getDay() >= 1 && cur.getDay() <= 5) {
        const dateStr = fmt(cur);
        const mKey = `${cur.getFullYear()}년 ${cur.getMonth()+1}월`;
        const dow = cur.getDay() - 1;
        const daySchedule = [];
        for (let p = 1; p <= 5; p++) {
          const cls = myTT[p]?.[dow] || '';
          if (cls) {
            // 해당 학급과 연결된 과목 찾기
            const grade = cls.split('-')[0];
            const matchSub = subjects.find(s => s.includes(grade + '학년'));
            const tag = matchSub ? `${cls}<small style="color:#aaa;">(${matchSub.split(' ')[1]||''})</small>` : cls;
            daySchedule.push(tag);
          }
        }
        if (!byMonth[mKey]) byMonth[mKey] = [];
        const last = byMonth[mKey][byMonth[mKey].length - 1];
        if (!last || last.fri) {
          byMonth[mKey].push({ mon: fmtDisp(cur), days: [{ dow, dateStr, schedule: daySchedule }] });
        } else {
          last.days.push({ dow, dateStr, schedule: daySchedule });
          if (dow === 4) last.fri = fmtDisp(cur);
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    html += `<div class="annual-month-wrap"><div class="full-tt-section-title">${sem.label}</div>`;
    for (const [month, weeks] of Object.entries(byMonth)) {
      html += `<div class="annual-month-title">${month}</div><div class="annual-week-grid">`;
      weeks.forEach((w, wi) => {
        html += `<div class="annual-week-card">
          <div class="annual-week-num">Week ${wi+1} &nbsp;<span style="font-size:11px;font-weight:400;color:#aaa;">${w.mon}~${w.fri||''}</span></div>`;
        w.days.forEach(d => {
          html += `<div class="annual-week-day"><b style="font-size:11px;color:#aaa;">${DAYS[d.dow]}</b> `;
          if (d.schedule.length) {
            html += d.schedule.map(t => `<span class="annual-period-tag">${t}</span>`).join('');
          } else {
            html += '<span style="font-size:11px;color:#ddd;">수업없음</span>';
          }
          html += '</div>';
        });
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
  }
  resultEl.innerHTML = html || '<div style="color:#aaa;padding:12px;">시간표 데이터를 먼저 입력하세요.</div>';
  section.scrollIntoView({ behavior: 'smooth' });
};

// ==================== 시간표 구글시트 새로고침 ====================
window.refreshFromSheets = async () => {
  const btn = document.getElementById('tt-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '불러오는 중...'; }
  try {
    const userId = currentUser.email;
    // 캐시 무효화 후 강제 재로드
    apiCache.delete('loadAll_' + userId);
    localStorage.removeItem(`userdata_${userId}_ts`);
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'loadAll', userId })
    });
    const d = await res.json();
    if (d.success) {
      applyUserData(d);
      localStorage.setItem(`userdata_${userId}_ts`, String(Date.now()));
      localStorage.setItem(`userdata_${userId}`, JSON.stringify({
        myTT, myTTLabels, classTTList, syllabusData, journals: journalData, timetableEvents,
        semDatesByYear, subjectHoursData
      }));
      buildMyTT();
      renderClassTTs();
      buildFullTimetable();
      buildSyllabus();
      filterJournal();
      if (btn) btn.textContent = '완료 ✓';
    } else {
      if (btn) btn.textContent = '실패';
    }
  } catch(e) {
    console.error(e);
    if (btn) btn.textContent = '오류';
  } finally {
    setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '🔄 시트에서 새로고침'; } }, 2000);
  }
};

// ==================== 시간표 시트 양식 초기화 ====================
window.generateFullTT = () => { /* 전체시간표는 구글 시트에서 직접 입력 */ };

window.resetTimetableSheet = async () => {
  const btn = document.querySelector('[onclick="resetTimetableSheet()"]');
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '초기화 중...'; }
  try {
    const userId = currentUser?.email;
    if (!userId) return;
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'setupNewTimetableSheet', userId })
    });
    const d = await res.json();
    if (btn) { btn.textContent = d.success ? '완료 ✓ 시트를 확인하세요' : '오류'; }
  } catch(e) {
    console.error(e);
    if (btn) btn.textContent = '오류';
  } finally {
    setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = origText; } }, 3000);
  }
};

// ==================== 7번: 버전 관리 ====================
const APP_VERSION = 'v94';
window.addEventListener('DOMContentLoaded', () => {
  // 버전 표시
  const vEl = document.getElementById('app-version');
  if (vEl) vEl.textContent = APP_VERSION;

  // 【1번】타이틀 클릭 → 새로고침 (JS 이벤트로 확실히 연결)
  const headerLeft = document.querySelector('.header-left');
  if (headerLeft) {
    headerLeft.style.cursor = 'pointer';
    headerLeft.addEventListener('click', e => {
      if (e.target.tagName === 'SELECT') return; // 학년도 드롭다운은 제외
      location.reload();
    });
  }
});
