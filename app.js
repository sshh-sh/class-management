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
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyDnzHtR5fnj1FHvOKtxA0wF59BNzLNsD6jeZnBWNnj8lenwr0OqniWXqZ4e8s7MY03/exec';

const TIMES = ['09:00~09:40','09:50~10:30','10:40~11:20','11:30~12:10','13:00~13:40'];
const DAY_NAMES = ['일','월','화','수','목','금','토'];

let currentUser = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let selectedDate = null;
let selectedDow = 0;
let myTT = {1:['','','','',''],2:['','','','',''],3:['','','','',''],4:['','','','',''],5:['','','','','']};
let classTTList = [];
let syllabusData = {};
let conceptLinksData = {};
let journalData = [];
let progressData = [];
let sheetsUrl = '';
let semYear = 2026;
let timetableEvents = {};
// 3번: 방학·시수
let vacationPeriods = [];
let subjectHoursData = {};
// 6번: API 응답 캐시
const apiCache = new Map();
const API_CACHE_TTL = 5 * 60 * 1000; // 5분
// 4번: 링크 자동저장 디바운서
let sylAutoSaveTimer = null;

function getSemDates(year, half) {
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
  buildSyllabus();
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
  catch(e) { alert('로그인 실패: ' + e.message); }
};

window.logout = async () => {
  await signOut(auth);
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
};

// ==================== 데이터 로드/저장 ====================
function applyUserData(d) {
  if (d.myTT) myTT = d.myTT;
  if (d.classTTList && d.classTTList.length) classTTList = d.classTTList;
  if (d.syllabusData && Object.keys(d.syllabusData).length) syllabusData = d.syllabusData;
  if (d.journals) journalData = d.journals.sort((a, b) => new Date(a.date) - new Date(b.date));
  if (d.timetableEvents) timetableEvents = d.timetableEvents;
  if (d.vacationPeriods) vacationPeriods = d.vacationPeriods;
  if (d.subjectHoursData) subjectHoursData = d.subjectHoursData;
  if (d.conceptLinks) { conceptLinksData = d.conceptLinks; buildConceptIcons(); }
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
          myTT, classTTList, syllabusData, journals: journalData, timetableEvents,
          vacationPeriods, subjectHoursData, conceptLinks: conceptLinksData
        }));
      }
    } catch(e) {
      console.log('데이터 로드 실패:', e);
    }
  }

  if (!progressData.length) {
    progressData = [
      {n:'3학년 과학', done:0, total:50, color:'#B5D4F4', warn:false},
      {n:'4학년 과학', done:0, total:51, color:'#B5D4F4', warn:false},
      {n:'5학년 과학', done:0, total:50, color:'#B5D4F4', warn:false},
      {n:'6학년 과학', done:0, total:51, color:'#F09595', warn:false},
      {n:'2학년 놀이', done:0, total:50, color:'#C0DD97', warn:false}
    ];
  }
}

async function saveUserData() {
  const userId = currentUser.email;
  const cacheKey = `userdata_${userId}`;
  const tsKey = `${cacheKey}_ts`;
  // 로컬 캐시 즉시 갱신 + 타임스탬프 초기화 (저장 직후엔 GAS 재요청 불필요)
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      myTT, classTTList, syllabusData, journals: journalData, timetableEvents,
      vacationPeriods, subjectHoursData
    }));
    localStorage.setItem(tsKey, String(Date.now()));
  } catch(e) {}
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'saveMyTimetable', userId, ttData: myTT })
    });
    for (const subject in syllabusData) {
      await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ app: 'journal-management', action: 'saveSyllabus', userId, subject, sylData: syllabusData[subject] })
      });
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
        await fetch(GAS_URL, {
          method: 'POST',
          body: JSON.stringify({ app: 'journal-management', action: 'saveSyllabus', userId, subject, sylData: syllabusData[subject] })
        });
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
  openJournalPopup(d, dow);
};

function renderWeek(d, dow) {
  const dayName = DAY_NAMES[new Date(currentYear, currentMonth, d).getDay()];
  document.getElementById('week-title').textContent = `${currentMonth + 1}월 ${d}일 (${dayName})`;
  const slots = [];
  for (let p = 1; p <= 5; p++) {
    const cls = myTT[p] && myTT[p][dow - 1] ? myTT[p][dow - 1] : null;
    if (cls) slots.push({ p, cls });
  }
  const wc = document.getElementById('week-content');
  if (!slots.length) { wc.innerHTML = '<div class="no-lesson">수업이 없습니다</div>'; return; }
  wc.innerHTML = slots.map(s => {
    const syl = getSyllabusCurrent(s.cls);
    return `<div class="lesson-item">
      <div class="lesson-left">
        <div class="lesson-period">${s.p}교시</div>
        <div class="lesson-time">${TIMES[s.p-1].replace('~','~<br>')}</div>
      </div>
      <div class="lesson-right">
        <div class="lesson-class">${s.cls}</div>
        <div class="lesson-detail">${syl ? syl.unit + ' ' + syl.topic + ' (' + syl.cur + '/' + syl.total + ')' : '진도표 미등록'}</div>
        <div class="lesson-prep">${syl ? '준비물: ' + syl.prep : ''}</div>
      </div>
    </div>`;
  }).join('');
}

function getSyllabusCurrent(cls) {
  const grade = cls.split('-')[0];
  for (const subject in syllabusData) {
    if (!subject.includes(grade + '학년')) continue;
    const items = syllabusData[subject];
    if (!items || !items.length) continue;
    const next = items.find(i => !isDone(i));
    if (!next) continue;
    const doneCount = items.filter(i => isDone(i)).length;
    return { unit: next.unit, topic: next.topic, prep: next.prep, cur: doneCount + 1, total: items.length };
  }
  return null;
}

// ==================== 시수 현황 ====================
function buildProgress() {
  const card = document.getElementById('prog-card');
  if (!progressData.length) { card.innerHTML = '<div class="no-lesson">설정에서 시수를 입력하세요</div>'; return; }
  card.innerHTML = progressData.map(p => {
    const pct = Math.round(p.done / p.total * 100);
    return `<div class="prog-row">
      <div class="prog-name">${p.n}</div>
      <div class="prog-track">
        <div class="prog-fill" style="width:${pct}%;background:${p.color};">
          <div class="prog-runner"><img src="images/hwanayong.jpg" alt="화나용"></div>
        </div>
      </div>
      <div class="prog-info">
        <div class="prog-num">${p.done}/${p.total}h</div>
        ${p.warn || pct > 80 ? '<div class="prog-warn">시수주의</div>' : ''}
      </div>
    </div>`;
  }).join('');
}

// ==================== 수업일지 팝업 ====================
function openJournalPopup(d, dow) {
  const dayName = DAY_NAMES[new Date(currentYear, currentMonth, d).getDay()];
  document.getElementById('journal-popup-title').textContent = `${currentMonth+1}월 ${d}일 (${dayName}) 수업일지`;
  document.getElementById('jp-period').value = '';
  document.getElementById('jp-class').value = '';
  document.getElementById('jp-name').value = '';
  document.getElementById('jp-content').value = '';
  document.getElementById('journal-popup').classList.remove('hidden');
}

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
  if (!period || !name || !content) { alert('교시, 학생 이름, 지도내용을 모두 입력해 주세요.'); return; }
  const dateStr = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(selectedDate).padStart(2,'0')}`;

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
      loadJournal();
      alert('저장되었습니다!');
    } else {
      alert('저장 실패: ' + result.message);
    }
  } catch(e) {
    alert('저장 중 오류: ' + e.message);
  }
};

// ==================== 수업일지 탭 ====================
let showOldJournals = false;

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
    }
  } catch(e) {
    console.log('수업일지 로드 실패:', e);
    journalData = [];
  }
  filterJournal();
  updateJournalFilter();
}

function updateJournalFilter() {
  const sel = document.getElementById('jl-filter-class');
  const classes = [...new Set(journalData.map(j => fmtClass(j.class)).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">전체 학급</option>' + classes.map(c => `<option>${c}</option>`).join('');
}

window.toggleOldJournals = () => {
  showOldJournals = !showOldJournals;
  const btn = document.getElementById('toggle-old-btn');
  btn.textContent = showOldJournals ? '이전 학년도 숨기기' : '이전 학년도 보기';
  filterJournal();
};

window.filterJournal = () => {
  const cls = document.getElementById('jl-filter-class').value;
  const name = document.getElementById('jl-filter-name').value.trim();
  const month = document.getElementById('jl-filter-month').value;
  let filtered = journalData;
  if (!showOldJournals) {
    const startDate = `${semYear}-03-01`;
    const endDate = `${semYear + 1}-03-01`;
    filtered = filtered.filter(j => j.date && j.date >= startDate && j.date < endDate);
  }
  // 이름·내용 모두 빈 행 제외
  filtered = filtered.filter(j => (j.name && j.name.trim()) || (j.content && j.content.trim()));
  if (cls) filtered = filtered.filter(j => fmtClass(j.class) === cls);
  if (name) filtered = filtered.filter(j => j.name && j.name.includes(name));
  if (month) filtered = filtered.filter(j => j.date && j.date.startsWith(month));
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
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;color:#aaa;">기록이 없습니다</td></tr>'; return; }
  tbody.innerHTML = data.map((j, idx) => `
    <tr>
      <td style="text-align:center;color:#aaa;font-size:12px;">${idx + 1}</td>
      <td>${fmtJournalDate(j.date)}</td>
      <td>${j.period || ''}</td>
      <td>${fmtClass(j.class)}</td>
      <td>${j.name || ''}</td>
      <td>${j.content || ''}</td>
    </tr>`).join('');
}

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
  body.innerHTML = [1,2,3,4,5].map(p => `<tr>
    <td class="period-cell">${p}교시<br><span style="font-size:9px;">${TIMES[p-1].split('~')[0]}</span></td>
    ${[0,1,2,3,4].map(d => {
      const v = myTT[p]?.[d] || '';
      return `<td class="tt-read-cell${v ? '' : ' empty'}">${v || '—'}</td>`;
    }).join('')}
  </tr>`).join('');
}

window.saveMyTT = async () => {
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({
        app: 'journal-management',
        action: 'saveTimetables',
        userId: currentUser.email,
        myTT,
        classTTList,
        events: timetableEvents,
        semYear
      })
    });
    const result = await res.json();
    if (result.success) {
      alert('시간표가 저장되었습니다!');
      renderWeek(selectedDate || new Date().getDate(), selectedDow || new Date().getDay());
      buildFullTimetable();
    } else {
      alert('저장 실패: ' + result.message);
    }
  } catch(e) {
    alert('저장 중 오류: ' + e.message);
  }
};

function buildFullTimetable() {
  const el = document.getElementById('full-timetable');
  if (!el) return;
  const titleEl = document.getElementById('full-tt-title');
  if (titleEl) titleEl.textContent = `전체 시간표 (${semYear}학년도)`;
  el.innerHTML = `<div class="full-tt-split">${buildOneSemTable(semYear,1)}${buildOneSemTable(semYear,2)}</div>`;
  el.querySelectorAll('.event-cell-input').forEach(input => {
    input.addEventListener('change', async e => {
      timetableEvents[e.target.dataset.key] = e.target.value;
      await saveUserData();
    });
  });
}

function buildOneSemTable(year, half) {
  const sem = getSemDates(year, half);
  const start = new Date(sem.start);
  const dow = start.getDay();
  if (dow === 0) start.setDate(start.getDate() + 1);
  else if (dow > 1) start.setDate(start.getDate() - (dow - 1));
  const weeks = [];
  let cur = new Date(start), wn = 1;
  while (cur <= sem.end) {
    const mon = new Date(cur), fri = new Date(cur);
    fri.setDate(fri.getDate() + 4);
    weeks.push({ num: wn++, mon, fri });
    cur.setDate(cur.getDate() + 7);
  }
  const fmt = d => `${d.getMonth()+1}.${d.getDate()}`;
  const DAYS = ['월','화','수','목','금'];
  let html = `<div><div class="full-tt-section-title">${sem.label}</div><div class="full-tt-wrap"><table class="full-tt"><thead>`;
  html += '<tr><th rowspan="2">주</th><th rowspan="2" class="date-cell">기간</th>';
  DAYS.forEach(d => html += `<th colspan="5" class="day-header">${d}</th>`);
  html += '<th rowspan="2" class="day-header">행사</th></tr><tr>';
  DAYS.forEach(() => { for (let p=1;p<=5;p++) html += `<th class="period-header">${p}</th>`; });
  html += '</tr></thead><tbody>';
  weeks.forEach(w => {
    html += `<tr><td class="week-num">${w.num}</td><td class="date-cell">${fmt(w.mon)}~${fmt(w.fri)}</td>`;
    for (let d=0;d<5;d++) for (let p=1;p<=5;p++) {
      const cls = myTT[p]&&myTT[p][d] ? myTT[p][d] : '';
      html += cls ? `<td class="has-class">${cls}</td>` : `<td class="empty-cell">—</td>`;
    }
    const evKey = `${year}-${half}-${w.num}`;
    const evVal = (timetableEvents[evKey]||'').replace(/"/g,'&quot;');
    html += `<td><input class="event-cell-input" data-key="${evKey}" value="${evVal}" placeholder="행사"></td></tr>`;
  });
  html += '</tbody></table></div></div>';
  return html;
}

window.addClassTT = async () => {
  const cls = prompt('학급을 입력하세요 (예: 4-2)');
  if (!cls || !cls.trim()) return;
  const c = cls.trim();
  if (classTTList.find(x => x.name === c)) { alert('이미 추가된 학급입니다.'); return; }
  classTTList.push({ name: c, tt: [[],[],[],[],[]] });
  classTTList.sort((a,b) => a.name.localeCompare(b.name));
  await saveUserData();
  renderClassTTs();
};

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
            <thead><tr><th style="width:18px;"></th><th>월</th><th>화</th><th>수</th><th>목</th><th>금</th></tr></thead>
            <tbody>${[0,1,2,3,4].map(p => `<tr>
              <td class="p-cell">${p+1}</td>
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

window.syncFromGAS = async () => {
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
        myTT, classTTList, syllabusData, journals: journalData, timetableEvents,
        vacationPeriods, subjectHoursData
      }));
      buildMyTT(); renderClassTTs(); buildFullTimetable(); buildSyllabus(); filterJournal();
      alert('구글 시트에서 최신 데이터를 불러왔습니다!');
    } else {
      alert('불러오기 실패: ' + (d.message || '오류'));
    }
  } catch(e) {
    alert('연동 오류: ' + e.message);
  }
};

window.downloadTTExcel = () => {
  const rows = [['교시', '월', '화', '수', '목', '금']];
  for (let p = 1; p <= 6; p++) rows.push([`${p}교시`, '', '', '', '', '']);
  const csv = '﻿' + rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '시간표_양식.csv'; a.click();
};

window.handleTTUpload = (input) => {
  if (input.files[0]) alert(`"${input.files[0].name}" 업로드 기능은 준비 중입니다.`);
  input.value = '';
};

window.calcSubjectHours = async () => {
  const el = document.getElementById('subject-hours-result');
  if (!el) return;
  const weekly = {};
  for (let p = 1; p <= 5; p++) {
    for (let d = 0; d < 5; d++) {
      const cls = (myTT[p]?.[d] || '').trim();
      if (cls) weekly[cls] = (weekly[cls] || 0) + 1;
    }
  }
  if (!Object.keys(weekly).length) {
    el.innerHTML = '<div style="font-size:13px;color:#aaa;padding:8px 0;">내 시간표에 학급 정보가 없습니다. 구글시트에서 시간표를 입력하고 연동하세요.</div>';
    return;
  }
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  function countWeeks(year, half) {
    const sem = getSemDates(year, half);
    let count = 0;
    const cur = new Date(sem.start);
    const dow = cur.getDay();
    if (dow !== 1) cur.setDate(cur.getDate() + (dow === 0 ? 1 : 8 - dow));
    while (fmt(cur) <= fmt(sem.end)) {
      let active = false;
      for (let i = 0; i < 5; i++) {
        const day = new Date(cur); day.setDate(day.getDate() + i);
        const ds = fmt(day);
        if (ds >= fmt(sem.start) && ds <= fmt(sem.end) && !isVacationDate(ds)) { active = true; break; }
      }
      if (active) count++;
      cur.setDate(cur.getDate() + 7);
    }
    return count;
  }
  const w1 = countWeeks(semYear, 1);
  const w2 = countWeeks(semYear, 2);
  const rows = Object.entries(weekly).sort(([a],[b]) => a.localeCompare(b));
  let html = `<table class="tt-hours-table"><thead><tr>
    <th style="text-align:left;">학급</th><th>주당</th>
    <th>1학기 예상 (${w1}주)</th><th>2학기 예상 (${w2}주)</th><th>연간</th>
  </tr></thead><tbody>`;
  rows.forEach(([cls, pw]) => {
    const s1 = pw * w1, s2 = pw * w2;
    html += `<tr><td class="row-subject">${cls}</td><td>${pw}</td><td>${s1}</td><td>${s2}</td><td>${s1+s2}</td></tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'calcTimetable', userId: currentUser.email, semYear })
    });
  } catch(e) {}
};

window.downloadMyTTTemplate = () => {
  const csv = '\uFEFF교시,월,화,수,목,금\n' + [1,2,3,4,5].map(p => `${p}교시,,,,,`).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '내_시간표_양식.csv'; a.click();
};

window.downloadClsTTTemplate = () => {
  const csv = '\uFEFF학급,교시,월,화,수,목,금\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '담당학급_시간표_양식.csv'; a.click();
};

window.handleMyTTUpload = (input) => { if (input.files[0]) alert(`"${input.files[0].name}" 업로드 기능은 준비 중입니다.`); };
window.handleClsTTUpload = (input) => { if (input.files[0]) alert(`"${input.files[0].name}" 업로드 기능은 준비 중입니다.`); };

// ==================== 진도표 ====================
function isDone(r) {
  return r.done === true || r.done === 'true' || r.done === 'TRUE';
}

function sylCell(val, field, r, idx, subjectEsc) {
  const strVal = String(val||'');
  const runs = r._links && r._links[field]; // [{text,url}] 배열 또는 null

  // 줄바꿈 분리 (Google Sheets 셀 내 Alt+Enter)
  const lines = strVal.split('\n').map(l => l.trim()).filter(l => l);

  if (lines.length > 1 || (runs && runs.length > 1)) {
    // runs가 여러 개면 runs 기준, 아니면 lines 기준
    const useRuns = runs && runs.length > 1;
    const items = useRuns ? runs.map(rn => rn.text) : lines;
    return `<div class="syl-multiline">${items.map((line, li) => {
      const run = useRuns ? runs[li] : (runs && runs[li]);
      const url = (run && run.url) || (line.startsWith('http') ? line : '');
      const linkBtn = url ? `<a href="${url.replace(/"/g,'&quot;')}" target="_blank" rel="noopener" class="syl-link-btn" title="링크 열기">🔗</a>` : '';
      return `<div class="syl-cell-line"><span class="syl-line-text">${line.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>${linkBtn}</div>`;
    }).join('')}</div>`;
  }

  const esc = strVal.replace(/"/g,'&quot;');
  const url = (runs && runs[0] && runs[0].url) ||
              (field === 'memo' && strVal.startsWith('http') ? strVal : '');
  const inp = `<input value="${esc}" style="width:100%;border:none;font-size:inherit;background:transparent;" onchange="updateSylField('${subjectEsc}',${idx},'${field}',this.value)">`;
  if (!url) return inp;
  return `<div class="syl-cell-link">${inp}<a href="${url.replace(/"/g,'&quot;')}" target="_blank" rel="noopener" class="syl-link-btn" title="링크 열기">🔗</a></div>`;
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

function buildConceptIcons() {
  const bar = document.getElementById('concept-icons-bar');
  if (!bar) return;
  bar.innerHTML = CONCEPT_ICONS.map(c => {
    const links = conceptLinksData[c.key] || [];
    const popupRows = links.map(lk => {
      const safeUrl = lk.url.replace(/"/g,'&quot;');
      const safeTopic = (lk.topic||lk.url).replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const safeSubcat = (lk.subcat||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return `<div class="concept-popup-row" onclick="window.open('${safeUrl}','_blank')">
        ${safeSubcat ? `<span class="concept-popup-tag">${safeSubcat}</span>` : ''}
        <span class="concept-popup-topic">${safeTopic}</span>
      </div>`;
    }).join('');
    const hasLinks = links.length > 0;
    return `<div class="concept-icon-btn">
      <div class="concept-icon-circle" style="background:${c.bg};border-color:${c.color}40;">
        <i class="ti ${c.icon}" style="color:${c.color};font-size:18px;" aria-hidden="true"></i>
      </div>
      <span class="concept-icon-label">${c.key}</span>
      ${hasLinks ? `<div class="concept-popup">${popupRows}</div>` : ''}
    </div>`;
  }).join('');
}

function buildSyllabus() {
  const subjects = Object.keys(syllabusData);
  const tabBar = document.getElementById('syllabus-tabs');
  const content = document.getElementById('syllabus-content');
  tabBar.innerHTML = subjects.map((s, i) =>
    `<button class="sub-tab${i===0?' active':''}" onclick="switchSyllabus('${s.replace(/'/g,"\\'")}',this)">${s}</button>`
  ).join('');
  if (!subjects.length) {
    content.innerHTML = '<div style="font-size:15px;color:#aaa;padding:20px 0;">위의 <b>+ 과목 추가</b> 버튼으로 과목을 등록하거나, CSV 업로드 또는 구글 시트 연동을 이용하세요.</div>';
    return;
  }
  content.innerHTML = subjects.map((s, i) => {
    const sId = s.replace(/ /g,'_').replace(/'/g,'');
    return `<div class="sub-content${i===0?' active':''}" id="syl-${sId}">
      <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:8px;">
        <button class="btn-xs" onclick="deleteSyllabusSubject('${s.replace(/'/g,"\\'")}')">🗑 과목 삭제</button>
      </div>
      <div class="table-wrap">
      <table class="syl-table">
        <thead><tr>
          <th style="width:44px;text-align:center;">완료</th>
          <th style="width:44px;text-align:center;">순서</th>
          <th style="width:80px;">기간</th>
          <th style="width:52px;text-align:center;">차시</th>
          <th style="width:22%;">단원</th>
          <th style="width:20%;">학습주제</th>
          <th style="width:10%;">준비물</th>
          <th>메모</th>
        </tr></thead>
        <tbody>${(syllabusData[s]||[]).map((r,idx) => {
          const done = isDone(r);
          const se = s.replace(/'/g,"\\'");
          const hasLinks = !!(r.links && r.links.trim());
          const linksEsc = (r.links||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
          return `<tr class="${done ? 'syl-done-row' : ''}" onclick="selectSylRow('${se}',${idx},'${linksEsc}')" style="cursor:pointer;">
            <td style="text-align:center;"><input type="checkbox" class="syl-done-check" ${done ? 'checked' : ''} onchange="toggleDone('${se}',${idx},this.checked)" onclick="event.stopPropagation()"></td>
            <td style="text-align:center;" class="syl-seq-cell">
              <span class="syl-seq">${idx+1}</span>
              ${hasLinks ? `<button class="syl-link-icon" onclick="event.stopPropagation();openSylLinkEditor('${se}',${idx})" title="링크 편집">🔗</button>` : `<button class="syl-link-icon syl-link-empty" onclick="event.stopPropagation();openSylLinkEditor('${se}',${idx})" title="링크 추가">+</button>`}
            </td>
            <td>${sylCell(r.period,'period',r,idx,se)}</td>
            <td style="text-align:center;">${sylCell(r.ch,'ch',r,idx,se)}</td>
            <td>${sylCell(r.unit,'unit',r,idx,se)}</td>
            <td>${sylCell(r.topic,'topic',r,idx,se)}</td>
            <td>${sylCell(r.prep,'prep',r,idx,se)}</td>
            <td>${sylCell(r.memo,'memo',r,idx,se)}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
      </div>
      <button class="btn-xs" style="margin-top:8px;" onclick="addSyllabusRow('${s.replace(/'/g,"\\'")}')">+ 행 추가</button>
    </div>`;
  }).join('');
}

window.selectSylRow = (subject, idx, linksRaw) => {
  document.querySelectorAll('.syl-table tbody tr').forEach(tr => tr.classList.remove('syl-row-selected'));
  const rows = document.querySelectorAll(`#syl-${subject.replace(/ /g,'_')} tbody tr`);
  if (rows[idx]) rows[idx].classList.add('syl-row-selected');
};

// 링크 편집 팝업
window.openSylLinkEditor = (subject, idx) => {
  const current = syllabusData[subject]?.[idx]?.links || '';
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
  const links = syllabusData[subject]?.[idx]?.links || '';
  showLinks(links);
};

window.switchSyllabus = (name, el) => {
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sub-content').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  const el2 = document.getElementById('syl-' + name.replace(/ /g,'_'));
  if (el2) el2.classList.add('active');
};

window.toggleDone = async (subject, idx, checked) => {
  if (syllabusData[subject]?.[idx]) {
    syllabusData[subject][idx].done = checked;
    await saveUserData();
    buildSyllabus();
  }
};

window.handleSylUpload = (input, subject) => { if (input.files[0]) alert(`"${input.files[0].name}" 업로드 기능은 준비 중입니다.`); };

window.downloadSylTemplate = () => {
  const csv = '﻿과목,차시,단원,학습주제,준비물,메모,완료\n3학년 과학,1,1. 생물과 환경,먹이 사슬과 먹이 그물,교과서,,\n3학년 과학,2,1. 생물과 환경,생태계 평형,교과서,,\n';
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '진도표_양식.csv'; a.click();
};

window.handleSylGlobalUpload = (input) => {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const lines = e.target.result.split('\n').slice(1);
    syllabusData = {};
    lines.forEach(row => {
      const cols = row.split(',').map(c => c.trim().replace(/^"|"$/g,''));
      if (cols.length < 4 || !cols[0]) return;
      const [subject, ch, unit, topic, prep, memo, doneVal] = cols;
      if (!syllabusData[subject]) syllabusData[subject] = [];
      syllabusData[subject].push({ch:ch||'', unit:unit||'', topic:topic||'', prep:prep||'', memo:memo||'', done:doneVal==='완료'||doneVal==='TRUE'||doneVal==='true'});
    });
    await saveUserData();
    buildSyllabus();
    alert('업로드 완료!');
  };
  reader.readAsText(file, 'UTF-8');
  input.value = '';
};

window.saveSyllabus = async () => {
  const subjects = Object.keys(syllabusData);
  try {
    for (const subject of subjects) {
      await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
          app: 'journal-management',
          action: 'saveSyllabus',
          userId: currentUser.email,
          subject,
          sylData: syllabusData[subject]
        })
      });
    }
    alert('진도표가 저장되었습니다!');
  } catch(e) {
    alert('저장 중 오류: ' + e.message);
  }
};

// ==================== 구글 시트 연동 ====================
window.addSyllabusSubject = async () => {
  const name = prompt('과목명을 입력하세요\n예: 3학년 과학, 4학년 과학, 5학년 놀이');
  if (!name || !name.trim()) return;
  const n = name.trim();
  if (syllabusData[n]) { alert('이미 있는 과목입니다.'); return; }
  syllabusData[n] = [];
  await saveUserData();
  buildSyllabus();
  // 새 과목 탭 활성화
  const tabs = document.querySelectorAll('.sub-tab');
  tabs.forEach(t => { if (t.textContent === n) t.click(); });
};

window.deleteSyllabusSubject = async (subject) => {
  if (!confirm(`"${subject}" 진도표를 삭제할까요?`)) return;
  delete syllabusData[subject];
  await saveUserData();
  buildSyllabus();
};

window.addSyllabusRow = async (subject) => {
  const ch = (syllabusData[subject]?.length || 0) + 1;
  syllabusData[subject].push({ ch: String(ch), unit: '', topic: '', prep: '', memo: '', done: false });
  await saveUserData();
  buildSyllabus();
  setTimeout(() => {
    const rows = document.querySelectorAll(`#syl-${subject.replace(/ /g,'_')} tbody tr`);
    const lastRow = rows[rows.length - 1];
    if (lastRow) lastRow.querySelector('input')?.focus();
  }, 100);
};

window.updateSylField = (subject, idx, field, val) => {
  if (syllabusData[subject]?.[idx]) {
    syllabusData[subject][idx][field] = val;
    scheduleSylAutoSave(); // 4번: 변경 즉시 자동저장 예약
  }
};
window.connectSheets = async () => {
  const url = document.getElementById('sheets-url').value.trim();
  const journalTab = document.getElementById('sheets-journal').value.trim();
  const timetableInput = document.getElementById('sheets-timetable').value.trim();
  const syllabusInput = document.getElementById('sheets-syllabus').value.trim();

  if (!url) { alert('구글 시트 URL을 입력하세요.'); return; }
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) { alert('올바른 구글 시트 URL이 아닙니다.'); return; }
  const id = match[1];

  const timetableTabs = timetableInput ? timetableInput.split(',').map(s => s.trim()).filter(Boolean) : [];
  const syllabusTabs = syllabusInput ? syllabusInput.split(',').map(s => s.trim()).filter(Boolean) : [];

  if (!journalTab && !timetableTabs.length && !syllabusTabs.length) {
    alert('최소 하나의 탭 이름을 입력하세요.');
    return;
  }

  const btn = document.getElementById('sheets-connect-btn');
  btn.textContent = '불러오는 중...'; btn.disabled = true;
  try {
    const result = await loadFromSheets(id, journalTab, timetableTabs, syllabusTabs);
    sheetsUrl = url;
    await saveUserData();
    updateSheetsBtn(true);
    buildMyTT(); renderClassTTs(); buildSyllabus(); buildProgress(); loadJournal();
    closeSheetsModalDirect();
    alert(`불러오기 완료!\n${result.join('\n')}`);
  } catch(e) {
    alert('불러오기 실패: ' + e.message + '\n\n시트가 "링크가 있는 모든 사용자" 공개로 설정되어 있는지 확인하세요.');
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
};

// ==================== 3번: 방학 기간 ====================
window.addVacation = () => {
  vacationPeriods.push({ label: '방학', start: '', end: '' });
  renderVacations();
};

window.removeVacation = (idx) => {
  vacationPeriods.splice(idx, 1);
  renderVacations();
  buildFullTimetable();
  saveVacationAndHours();
};

// 방학 필드 업데이트 - ES모듈 전역변수 문제 해결
window.setVacField = (idx, field, val) => {
  if (vacationPeriods[idx]) vacationPeriods[idx][field] = val;
  if (field === 'start' || field === 'end') buildFullTimetable();
  saveVacationAndHours();
};

function renderVacations() {
  const el = document.getElementById('vacation-list');
  if (!el) return;
  if (!vacationPeriods.length) {
    el.innerHTML = '<div class="vacation-empty">방학 기간이 없습니다. + 방학 추가 버튼으로 입력하세요.</div>';
    return;
  }
  el.innerHTML = vacationPeriods.map((v, i) => `
    <div class="vacation-row">
      <input type="text" class="vacation-input-label" value="${v.label||''}" placeholder="방학 이름 (예: 여름방학)"
        onchange="setVacField(${i},'label',this.value)">
      <input type="date" class="vacation-input-date" value="${v.start||''}"
        onchange="setVacField(${i},'start',this.value)">
      <span style="font-size:13px;color:#aaa;">~</span>
      <input type="date" class="vacation-input-date" value="${v.end||''}"
        onchange="setVacField(${i},'end',this.value)">
      <button class="btn-xs" onclick="removeVacation(${i})" style="color:#E24B4A;border-color:#E24B4A;">삭제</button>
    </div>`).join('');
}

function isVacationDate(dateStr) {
  return vacationPeriods.some(v => v.start && v.end && dateStr >= v.start && dateStr <= v.end);
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
  alert('저장되었습니다!');
};

async function saveVacationAndHours() {
  const cacheKey = `userdata_${currentUser?.email}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    const prev = cached ? JSON.parse(cached) : {};
    localStorage.setItem(cacheKey, JSON.stringify({ ...prev, vacationPeriods, subjectHoursData }));
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
        if (!isVacationDate(dateStr)) {
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
        }
        if (!byMonth[mKey]) byMonth[mKey] = [];
        const last = byMonth[mKey][byMonth[mKey].length - 1];
        if (!last || last.fri) {
          byMonth[mKey].push({ mon: fmtDisp(cur), days: [{ dow, dateStr, schedule: daySchedule, vacation: isVacationDate(dateStr) }] });
        } else {
          last.days.push({ dow, dateStr, schedule: daySchedule, vacation: isVacationDate(dateStr) });
          if (dow === 4) last.fri = fmtDisp(cur);
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    html += `<div class="annual-month-wrap"><div class="full-tt-section-title">${sem.label}</div>`;
    for (const [month, weeks] of Object.entries(byMonth)) {
      html += `<div class="annual-month-title">${month}</div><div class="annual-week-grid">`;
      weeks.forEach((w, wi) => {
        const hasVac = w.days.some(d => d.vacation);
        html += `<div class="annual-week-card">
          <div class="annual-week-num">Week ${wi+1} &nbsp;<span style="font-size:11px;font-weight:400;color:#aaa;">${w.mon}~${w.fri||''}</span></div>`;
        if (hasVac) html += `<div class="annual-week-vacation">🏖 방학 포함</div>`;
        w.days.forEach(d => {
          if (d.vacation) return;
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
        myTT, classTTList, syllabusData, journals: journalData, timetableEvents,
        vacationPeriods, subjectHoursData
      }));
      buildMyTT();
      renderClassTTs();
      buildFullTimetable();
      buildSyllabus();
      filterJournal();
      alert('구글 시트에서 최신 데이터를 불러왔습니다!');
    } else {
      alert('불러오기 실패: ' + (d.message || '오류'));
    }
  } catch(e) {
    alert('불러오기 오류: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 시트에서 새로고침'; }
  }
};

// ==================== 시간표 시트 양식 초기화 ====================
window.generateFullTT = async () => {
  if (!confirm(`구글 시트 시간표 탭 J열부터 ${semYear}학년도 전체시간표를 생성합니다.\nJ열 이후 기존 내용은 덮어씁니다. 계속하시겠습니까?`)) return;
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'generateFullTimetable', semYear })
    });
    const d = await res.json();
    if (d.success) alert('✅ 전체시간표 생성 완료!\n구글 시트 > 시간표 탭 J열을 확인하세요.');
    else alert('오류: ' + (d.error || d.message || '알 수 없는 오류'));
  } catch(e) {
    alert('오류: ' + e.message);
  }
};

window.resetTimetableSheet = async () => {
  if (!confirm('구글 시트의 시간표 탭을 새 양식으로 초기화합니다.\n기존에 입력한 방학/행사/필요시수 데이터가 초기화됩니다.\n계속하시겠습니까?')) return;
  try {
    const userId = currentUser?.email;
    if (!userId) { alert('로그인이 필요합니다.'); return; }
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'setupTimetableSheet', userId })
    });
    const d = await res.json();
    if (d.success) {
      alert('시간표 양식이 초기화되었습니다!\n구글 시트 > 시간표 탭을 열어 확인하세요.');
    } else {
      alert('초기화 실패: ' + (d.message || '오류'));
    }
  } catch(e) {
    alert('오류: ' + e.message);
  }
};

// ==================== 7번: 버전 관리 ====================
const APP_VERSION = 'v4.0';
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
