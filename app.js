import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, getDocs, query, where, orderBy, deleteDoc } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

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
const db = getFirestore(app);

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
    return { label: `${year}학년도 2학기`, start: new Date(year, 8, 1), end: new Date(year + 1, 1, 14) };
  }
}

function buildSemSelect() {
  const sel = document.getElementById('sem-select');
  if (!sel) return;
  const opts = [];
  for (let y = 2024; y <= 2030; y++) {
    opts.push(`<option value="${y}">${y}학년도</option>`);
  }
  sel.innerHTML = opts.join('');
  sel.value = String(semYear);
}

window.changeSemester = (val) => {
  semYear = Number(val);
  currentYear = semYear;
  currentMonth = new Date().getMonth();
  saveUserData();
  buildCalendar();
  buildFullTimetable();
};

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
  const uid = currentUser.uid;
  const snap = await getDoc(doc(db, 'users', uid));
  if (snap.exists()) {
    const d = snap.data();
    if (d.myTT) myTT = d.myTT;
    if (d.classTTList) classTTList = d.classTTList;
    if (d.syllabusData) syllabusData = d.syllabusData;
    if (d.progressData) progressData = d.progressData;
    if (d.sheetsUrl) { sheetsUrl = d.sheetsUrl; updateSheetsBtn(true); }
    if (d.semYear) semYear = d.semYear;
    if (d.timetableEvents) timetableEvents = d.timetableEvents;
  } else {
    progressData = [
      {n:'3학년 과학', done:0, total:50, color:'#B5D4F4', warn:false},
      {n:'4학년 과학', done:0, total:51, color:'#B5D4F4', warn:false},
      {n:'5학년 과학', done:0, total:50, color:'#B5D4F4', warn:false},
      {n:'6학년 과학', done:0, total:51, color:'#F09595', warn:false},
      {n:'2학년 놀이', done:0, total:50, color:'#C0DD97', warn:false}
    ];
    await saveUserData();
  }
}

async function saveUserData() {
  const uid = currentUser.uid;
  await setDoc(doc(db, 'users', uid), { myTT, classTTList, syllabusData, progressData, sheetsUrl, semYear, timetableEvents }, { merge: true });
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

window.closeJournalPopup = (e) => {
  if (e.target === document.getElementById('journal-popup')) closeJournalPopupDirect();
};
window.closeJournalPopupDirect = () => document.getElementById('journal-popup').classList.add('hidden');

window.autoFillClass = () => {
  const p = document.getElementById('jp-period').value;
  if (!p) { document.getElementById('jp-class').value = ''; return; }
  const pNum = parseInt(p);
  const v = myTT[pNum] && myTT[pNum][selectedDow - 1] ? myTT[pNum][selectedDow - 1] : '';
  document.getElementById('jp-class').value = v || '(수업 없음)';
};

window.saveJournal = async () => {
  const period = document.getElementById('jp-period').value;
  const cls = document.getElementById('jp-class').value;
  const name = document.getElementById('jp-name').value.trim();
  const content = document.getElementById('jp-content').value.trim();
  if (!period || !name || !content) { alert('교시, 학생 이름, 지도내용을 모두 입력해 주세요.'); return; }
  const dateStr = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(selectedDate).padStart(2,'0')}`;
  await addDoc(collection(db, 'users', currentUser.uid, 'journals'), {
    date: dateStr, period, class: cls, name, content, createdAt: new Date()
  });
  closeJournalPopupDirect();
  loadJournal();
  alert('저장되었습니다!');
};

// ==================== 수업일지 탭 ====================
async function loadJournal() {
  const snap = await getDocs(query(collection(db, 'users', currentUser.uid, 'journals'), orderBy('date','desc')));
  journalData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderJournal(journalData);
  updateJournalFilter();
}

function updateJournalFilter() {
  const sel = document.getElementById('jl-filter-class');
  const classes = [...new Set(journalData.map(j => j.class).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">전체 학급</option>' + classes.map(c => `<option>${c}</option>`).join('');
}

window.filterJournal = () => {
  const cls = document.getElementById('jl-filter-class').value;
  const name = document.getElementById('jl-filter-name').value.trim();
  const month = document.getElementById('jl-filter-month').value;
  let filtered = journalData;
  if (cls) filtered = filtered.filter(j => j.class === cls);
  if (name) filtered = filtered.filter(j => j.name && j.name.includes(name));
  if (month) filtered = filtered.filter(j => j.date && j.date.startsWith(month));
  renderJournal(filtered);
};

function renderJournal(data) {
  const tbody = document.getElementById('journal-body');
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;color:#aaa;">기록이 없습니다</td></tr>'; return; }
  tbody.innerHTML = data.map(j => `
    <tr>
      <td><span class="check-cell done"></span></td>
      <td>${j.date ? j.date.slice(5).replace('-','/') : ''}</td>
      <td>${j.period || ''}</td>
      <td>${j.class || ''}</td>
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
  await saveUserData();
  alert('시간표가 저장되었습니다!');
  renderWeek(selectedDate || new Date().getDate(), selectedDow || new Date().getDay());
  buildFullTimetable();
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
  await saveUserData();
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
  if (!subjects.length) {
    tabBar.innerHTML = '';
    content.innerHTML = '<div style="font-size:12px;color:#aaa;padding:12px 0;">구글 시트 연동 또는 엑셀 업로드로 진도표를 등록하세요.</div>';
    return;
  }
  tabBar.innerHTML = subjects.map((s, i) => `<button class="sub-tab${i===0?' active':''}" onclick="switchSyllabus('${s}',this)">${s}</button>`).join('');
  content.innerHTML = subjects.map((s, i) => `
    <div class="sub-content${i===0?' active':''}" id="syl-${s.replace(/ /g,'_')}">
      <table class="syl-table">
        <thead><tr><th style="width:30px;">차시</th><th>단원</th><th>학습주제</th><th>준비물</th><th style="width:64px;">상태</th></tr></thead>
        <tbody>${syllabusData[s].map((r,idx) => `
          <tr>
            <td style="text-align:center;">${r.ch}</td>
            <td>${r.unit}</td>
            <td>${r.topic}</td>
            <td>${r.prep}</td>
            <td><span class="status-badge status-${r.status}" onclick="toggleStatus('${s}',${idx})">${r.status==='done'?'완료':r.status==='next'?'다음수업':'예정'}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="upload-box" onclick="document.getElementById('syl-upload-${i}').click()">
        ↑ 진도표 업로드 (Excel/CSV)
        <input type="file" id="syl-upload-${i}" accept=".xlsx,.csv" style="display:none" onchange="handleSylUpload(this,'${s}')">
      </div>
    </div>`).join('');
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
  await saveUserData();
  alert('진도표가 저장되었습니다!');
};

// ==================== 구글 시트 연동 ====================
window.openSheetsModal = () => {
  document.getElementById('sheets-url').value = sheetsUrl;
  document.getElementById('sheets-modal').classList.remove('hidden');
};
window.closeSheetsModal = (e) => { if (e.target === document.getElementById('sheets-modal')) closeSheetsModalDirect(); };
window.closeSheetsModalDirect = () => document.getElementById('sheets-modal').classList.add('hidden');

window.connectSheets = async () => {
  const url = document.getElementById('sheets-url').value.trim();
  if (!url) { alert('구글 시트 URL을 입력하세요.'); return; }
  sheetsUrl = url;
  await saveUserData();
  updateSheetsBtn(true);
  closeSheetsModalDirect();
  alert('연결 설정이 저장되었습니다!\n(실제 데이터 연동은 구글 시트 공유 설정 후 사용 가능합니다)');
};

function updateSheetsBtn(connected) {
  const btn = document.getElementById('sheets-btn');
  const icon = document.getElementById('sheets-status-icon');
  const text = document.getElementById('sheets-status-text');
  if (connected) { btn.classList.add('connected'); icon.textContent = '☁'; text.textContent = '구글 시트 연결됨 ✓'; }
  else { btn.classList.remove('connected'); icon.textContent = '☁'; text.textContent = '구글 시트 연결'; }
}

window.downloadSheetsTemplate = () => {
  const csv = '\uFEFF시트 구성 안내\n시트1: 내 시간표\n교시,월,화,수,목,금\n1교시,,,,,\n\n시트2~: 학급 시간표\n교시,월,화,수,목,금\n\n진도표 시트: 과목명\n차시,단원,학습주제,준비물,상태\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '구글시트_양식안내.csv'; a.click();
};

// ==================== 사용설명서 ====================
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
