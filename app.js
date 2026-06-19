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
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxJ5fZqiWQnWdGRw_R3tC0zyh50NPXMUyYiANeRSFZU663rVZ3DjY7LtP4nZOKloslR/exec';

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
let journalData = [];
let progressData = [];
let sheetsUrl = '';
let semYear = 2026;
let timetableEvents = {};

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
  loadJournal();

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
async function loadUserData() {
  const userId = currentUser.email;
  try {
    // 내 시간표 + 담당 학급 시간표 로드
    const ttRes = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'loadAllTimetables', userId })
    });
    const ttData = await ttRes.json();
    if (ttData.success) {
      if (ttData.myTT) myTT = ttData.myTT;
      if (ttData.classTTList && ttData.classTTList.length) classTTList = ttData.classTTList;
    }

    // 진도표 로드
    const syllabuses = ['3학년 과학', '4학년 과학', '5학년 과학', '6학년 과학', '2학년 놀이'];
    for (const subject of syllabuses) {
      const sylRes = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ app: 'journal-management', action: 'loadSyllabus', userId, subject })
      });
      const sylData = await sylRes.json();
      if (sylData.success && sylData.items) {
        syllabusData[subject] = sylData.items.map(item => ({
          ch: item.ch,
          unit: item.unit,
          topic: item.topic,
          prep: item.prep,
          status: 'todo'
        }));
      }
    }
  } catch(e) {
    console.log('데이터 로드 실패:', e);
  }

  // 기본값 설정
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
  try {
    // 내 시간표 저장
    await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ app: 'journal-management', action: 'saveMyTimetable', userId, ttData: myTT })
    });

    // 진도표 저장
    for (const subject in syllabusData) {
      await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ app: 'journal-management', action: 'saveSyllabus', userId, subject, sylData: syllabusData[subject] })
      });
    }
  } catch(e) {
    console.log('데이터 저장 실패:', e);
  }
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
    startD += 5;
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
  for (const subject in syllabusData) {
    const items = syllabusData[subject];
    if (!items) continue;
    const next = items.find(i => i.status === 'next');
    const relevant = next && (next.class === cls || subject.includes(cls.split('-')[0] + '학년'));
    if (relevant) return { unit: next.unit, topic: next.topic, prep: next.prep, cur: items.filter(i => i.status === 'done').length + 1, total: items.length };
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
  renderJournal(journalData);
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
function buildMyTT() {
  const body = document.getElementById('my-tt-body');
  body.innerHTML = [1,2,3,4,5].map(p => `<tr>
    <td class="period-cell">${p}교시<br><span style="font-size:9px;">${TIMES[p-1].split('~')[0]}</span></td>
    ${[0,1,2,3,4].map(d => `<td><input value="${myTT[p][d]||''}" placeholder="—" onchange="myTT[${p}][${d}]=this.value"></td>`).join('')}
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
        classTTList
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
  if (!classTTList.length) { el.innerHTML = '<div style="font-size:12px;color:#aaa;padding:8px 0;">학급 추가 버튼으로 등록하세요</div>'; return; }
  const grades = {};
  classTTList.forEach(c => { const g = c.name.split('-')[0]; if (!grades[g]) grades[g] = []; grades[g].push(c); });
  el.innerHTML = Object.keys(grades).sort().map(g => `
    <div class="grade-row">
      ${grades[g].map(cls => `
        <div class="cls-wrap">
          <div class="cls-head">
            <div class="cls-name">${cls.name}</div>
            <button class="cls-del" onclick="removeClassTT('${cls.name}')">✕</button>
          </div>
          <table class="cls-table">
            <thead><tr><th style="width:18px;"></th><th>월</th><th>화</th><th>수</th><th>목</th><th>금</th></tr></thead>
            <tbody>${[0,1,2,3,4].map(p => `<tr>
              <td class="p-cell">${p+1}</td>
              ${[0,1,2,3,4].map(d => {
                const v = cls.tt && cls.tt[p] && cls.tt[p][d] ? cls.tt[p][d] : '';
                const isMine = v && (myTT[p+1] && myTT[p+1][d] === v);
                return `<td class="${isMine?'mine':''}">${v||'—'}</td>`;
              }).join('')}
            </tr>`).join('')}</tbody>
          </table>
        </div>`).join('')}
    </div>`).join('');
}

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
function buildSyllabus() {
  const subjects = Object.keys(syllabusData);
  const tabBar = document.getElementById('syllabus-tabs');
  const content = document.getElementById('syllabus-content');
  tabBar.innerHTML = subjects.map((s, i) =>
    `<button class="sub-tab${i===0?' active':''}" onclick="switchSyllabus('${s.replace(/'/g,"\\'")}',this)">${s}</button>`
  ).join('') + `<button class="sub-tab" onclick="addSyllabusSubject()" style="color:#534AB7;border-color:#AFA9EC;">+ 과목 추가</button>`;
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
      <table class="syl-table">
        <thead><tr><th style="width:44px;">차시</th><th>단원</th><th>학습주제</th><th>준비물</th><th style="width:80px;">상태</th></tr></thead>
        <tbody>${(syllabusData[s]||[]).map((r,idx) => `
          <tr>
            <td style="text-align:center;"><input value="${r.ch}" style="width:40px;text-align:center;border:none;font-size:inherit;background:transparent;" onchange="updateSylField('${s.replace(/'/g,"\\'")}',${idx},'ch',this.value)"></td>
            <td><input value="${r.unit}" style="width:100%;border:none;font-size:inherit;background:transparent;" onchange="updateSylField('${s.replace(/'/g,"\\'")}',${idx},'unit',this.value)"></td>
            <td><input value="${r.topic}" style="width:100%;border:none;font-size:inherit;background:transparent;" onchange="updateSylField('${s.replace(/'/g,"\\'")}',${idx},'topic',this.value)"></td>
            <td><input value="${r.prep}" style="width:100%;border:none;font-size:inherit;background:transparent;" onchange="updateSylField('${s.replace(/'/g,"\\'")}',${idx},'prep',this.value)"></td>
            <td style="text-align:center;"><span class="status-badge status-${r.status}" onclick="toggleStatus('${s.replace(/'/g,"\\'")}',${idx})">${r.status==='done'?'완료':r.status==='next'?'다음수업':'예정'}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <button class="btn-xs" style="margin-top:8px;" onclick="addSyllabusRow('${s.replace(/'/g,"\\'")}')">+ 행 추가</button>
    </div>`;
  }).join('');
}

window.switchSyllabus = (name, el) => {
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sub-content').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  const el2 = document.getElementById('syl-' + name.replace(/ /g,'_'));
  if (el2) el2.classList.add('active');
};

window.toggleStatus = async (subject, idx) => {
  const item = syllabusData[subject][idx];
  const statuses = ['todo','next','done'];
  const cur = statuses.indexOf(item.status);
  item.status = statuses[(cur + 1) % 3];
  await saveUserData();
  buildSyllabus();
};

window.handleSylUpload = (input, subject) => { if (input.files[0]) alert(`"${input.files[0].name}" 업로드 기능은 준비 중입니다.`); };

window.downloadSylTemplate = () => {
  const csv = '﻿과목,차시,단원,학습주제,준비물,상태\n3학년 과학,1,1. 생물과 환경,먹이 사슬과 먹이 그물,교과서,todo\n3학년 과학,2,1. 생물과 환경,생태계 평형,교과서,todo\n';
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
      const [subject, ch, unit, topic, prep, status] = cols;
      if (!syllabusData[subject]) syllabusData[subject] = [];
      syllabusData[subject].push({ch:ch||'', unit:unit||'', topic:topic||'', prep:prep||'', status:status||'todo'});
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
  syllabusData[subject].push({ ch: String(ch), unit: '', topic: '', prep: '', status: 'todo' });
  await saveUserData();
  buildSyllabus();
  setTimeout(() => {
    const rows = document.querySelectorAll(`#syl-${subject.replace(/ /g,'_')} tbody tr`);
    const lastRow = rows[rows.length - 1];
    if (lastRow) lastRow.querySelector('input')?.focus();
  }, 100);
};

window.updateSylField = (subject, idx, field, val) => {
  if (syllabusData[subject]?.[idx]) syllabusData[subject][idx][field] = val;
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
