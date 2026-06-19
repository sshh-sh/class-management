/**
 * 통합 Google Apps Script 백엔드
 * - 모둠뽑기: doPost  { action:'save'|'load', classId, data }
 * - 관피타:   doGet   ?action=get&key=...  /  ?action=set&key=...&value=...
 *
 * [수정사항] writeKaoSheet에서 시트 전체를 지우던 것을 A~J열까지만 지우도록 변경
 *           → L열 이후 메모 영역은 더 이상 삭제되지 않음
 */

function migrateKaoData() {
  const existingData = {"members":["김차현","김효경","소형준","오유선","이광빈","이연희","장아름","최송희"],"attendance":{"2026-06-03":{"최송희":"","장아름":""},"2026-06-27":{"최송희":"o","장아름":"o","김차현":"o","이연희":"o","김효경":"o","오유선":"o"},"2026-06-17":{"장아름":"o","김차현":"o","이연희":"o","최송희":"o","김효경":"o"},"2026-06-24":{"장아름":"o","김차현":"o","이연희":"o","최송희":"o","김효경":"o"},"2026-07-01":{"장아름":"o","이연희":"o"},"2026-07-08":{"이연희":"o"},"2026-07-15":{"이연희":"o","최송희":"o"},"2026-07-22":{"이연희":"o"},"2026-06-10":{"최송희":"o","장아름":"o","김차현":"o","이연희":"o","소형준":"o","김효경":"o","오유선":"x","이광빈":"o"},"2026-06-20":{"이연희":"o","최송희":"o","김효경":"o","오유선":"o"}},"events":[{"date":"2026-05-31","title":"태안풍천교회","content":"..."},{"date":"2026-06-10","title":"보바스병원","content":"..."},{"date":"2026-06-20","title":"시네마리허설","content":"1시~5시?"},{"date":"2026-06-27","title":"시네마","content":"..."},{"date":"2026-07-15","title":"장안초초청연주","content":"저녁7시~?"}],"dates":["2026-06-10","2026-06-17","2026-06-20","2026-06-24","2026-06-27","2026-07-01","2026-07-08","2026-07-15","2026-07-22","2026-07-29"],"deleted":["2026-06-03"],"labels":{"2026-06-10":"보바스","2026-06-20":"시네마리허설","2026-06-27":"시네마콘서트","2026-07-15":"장안초"}};
  writeKaoSheet(existingData);
  Logger.log('마이그레이션 완료!');
}

const SHEET_NAME   = '모둠뽑기';
const SHEET_DETAIL = '모둠뽑기_보기';
const KAO_SHEET    = '오케';
const KAO_MAX_COL  = 10; // A~J열까지만 KAO 앱이 사용 (K열 이후는 사용자 메모 영역, 절대 건드리지 않음)

function doPost(e) {
  try {
    const data    = JSON.parse(e.postData.contents);
    const action  = data.action;
    const app     = data.app;
    let result;

    // 일해용! 전담 (journal-management)
    if (app === 'journal-management') {
      const userId = data.userId;

      if (action === 'loadAll') {
        result = loadAll(userId);
      } else if (action === 'loadJournal') {
        result = loadJournal(userId);
      } else if (action === 'saveJournal') {
        result = saveJournal(userId, data.journalData);
      } else if (action === 'loadMyTimetable') {
        result = loadMyTimetable(userId);
      } else if (action === 'saveMyTimetable') {
        result = saveMyTimetable(userId, data.ttData);
      } else if (action === 'loadAllTimetables') {
        result = loadAllTimetables(userId);
      } else if (action === 'saveTimetables') {
        result = saveTimetables(userId, data.myTT, data.classTTList);
      } else if (action === 'loadSyllabus') {
        result = loadSyllabus(userId, data.subject);
      } else if (action === 'saveSyllabus') {
        result = saveSyllabus(userId, data.subject, data.sylData);
      } else {
        result = {success: false, message: '알 수 없는 액션'};
      }
    }
    // KAO 관피타
    else if (app === 'kao' && action === 'set') {
      if (data.key === 'kao-state') {
        try { writeKaoSheet(JSON.parse(data.value)); } catch(e) {}
      }
      result = {ok: true};
    }
    // 모둠뽑기
    else if (action === 'save') result = saveRecord(data.classId, data.data);
    else if (action === 'load') result = loadRecords(data.classId);
    else result = {success: false, message: '알 수 없는 액션'};

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({success: false, message: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  const action = e.parameter && e.parameter.action;
  const key    = e.parameter && e.parameter.key;
  const value  = e.parameter && e.parameter.value;
  if (action === 'get') {
    const val = kaoGet(key);
    return ContentService.createTextOutput(JSON.stringify({ok: val !== null, value: val})).setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'set') {
    if (key === 'kao-state') {
      try { writeKaoSheet(JSON.parse(value)); } catch(e) {}
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({status:'ok', message:'통합 GAS 작동 중'})).setMimeType(ContentService.MimeType.JSON);
}

function kaoGet(key) {
  const sheet = getOrCreateKaoSheet();
  const rows = sheet.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === key) return rows[i][1];
  }
  return null;
}

function writeKaoSheet(state) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = getOrCreateKaoSheet();

  const members = state.members || [];
  const dates   = (state.dates  || []).sort();
  const att     = state.attendance || {};
  const labels  = state.labels || {};

  // ⚠️ 시트 전체가 아니라 A~J열(KAO_MAX_COL)까지만 지움 → L열 이후 메모는 보존됨
  const lastRow = Math.max(sheet.getMaxRows(), dates.length + 3);
  const clearRange = sheet.getRange(1, 1, lastRow, KAO_MAX_COL);
  clearRange.clearContent();
  clearRange.clearFormat();

  // 1행: JSON 백업 — 숨김
  sheet.getRange(1, 1, 1, 2).setValues([['kao-state', JSON.stringify(state)]]);
  sheet.setRowHeight(1, 3);
  sheet.getRange(1, 1, 1, 2).setFontColor('#ffffff');

  // 2행: 헤더 — A:날짜, B:행사, C~:멤버
  const header = ['날짜', '행사', ...members];
  sheet.getRange(2, 1, 1, header.length).setValues([header]);
  sheet.getRange(2, 1, 1, header.length).setFontWeight('bold').setBackground('#1D9E75').setFontColor('white');
  sheet.setFrozenRows(2);

  if (!dates.length) return;

  // 날짜별 행: A=날짜, B=행사명(없으면 빈칸), C~=출석
  const rows = dates.map(d => {
    const dayAtt = att[d] || {};
    return [d, labels[d] || '', ...members.map(m => {
      const v = dayAtt[m];
      return v === 'o' ? '참여' : v === 'x' ? '불참' : '-';
    })];
  });

  sheet.getRange(3, 1, rows.length, header.length).setValues(rows);

  // A열 날짜 왼쪽 정렬
  sheet.getRange(2, 1, rows.length + 1, 1).setHorizontalAlignment('left');

  // C열부터 참여/불참 색상
  for (let r = 0; r < rows.length; r++) {
    for (let c = 2; c < header.length; c++) {
      const val  = rows[r][c];
      const cell = sheet.getRange(r + 3, c + 1);
      if (val === '참여')      cell.setBackground('#E1F5EE').setFontColor('#0F6E56');
      else if (val === '불참') cell.setBackground('#FCEBEB').setFontColor('#A32D2D');
      else                     cell.setBackground('#ffffff').setFontColor('#aaaaaa');
    }
  }

  // ⚠️ autoResizeColumns(1, header.length)는 A~header.length열 너비만 조정하므로 L열 이후엔 영향 없음
  sheet.autoResizeColumns(1, header.length);
  sheet.setColumnWidth(2, 80);
  for (let c = 3; c <= header.length; c++) sheet.setColumnWidth(c, 70);
}

function getOrCreateKaoSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(KAO_SHEET);
  if (!sheet) sheet = ss.insertSheet(KAO_SHEET);
  return sheet;
}

function saveRecord(classId, record) {
  const sheet = getOrCreateSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === classId && data[i][1] === record.year && data[i][2] === record.month) {
      sheet.getRange(i+1,1,1,5).setValues([[classId, record.year, record.month, record.date, JSON.stringify(record.groups)]]);
      saveDetailSheet(classId, record);
      return {success: true, message: '기존 기록 업데이트 완료'};
    }
  }
  sheet.appendRow([classId, record.year, record.month, record.date, JSON.stringify(record.groups)]);
  saveDetailSheet(classId, record);
  return {success: true, message: '저장 완료'};
}

function saveDetailSheet(classId, record) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_DETAIL);
  const maxGroups = 6;
  const resultHeaders = ['반', '년도', '월', '1모둠', '2모둠', '3모둠', '4모둠', '5모둠', '6모둠'];
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_DETAIL);
    sheet.getRange(1,1,1,9).setValues([resultHeaders]);
    sheet.getRange(1,1,1,9).setFontWeight('bold').setBackground('#534AB7').setFontColor('white');
    sheet.setFrozenRows(1);
    for (let i = 4; i <= 9; i++) sheet.setColumnWidth(i, 180);
  }
  const className = record.className || classId;
  const existing = sheet.getDataRange().getValues();
  const toDelete = [];
  for (let i = existing.length-1; i >= 1; i--) {
    if (existing[i][0] === className && existing[i][1] === record.year && existing[i][2] === record.month) {
      toDelete.push(i+1);
    }
  }
  toDelete.forEach(row => sheet.deleteRow(row));
  const row = [className, record.year, record.month];
  for (let i = 0; i < maxGroups; i++) {
    const group = record.groups[i];
    row.push(group ? group.students.join(', ') : '');
  }
  sheet.appendRow(row);
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow,1,1,9).setBackground(lastRow%2===0 ? '#f0effe' : '#ffffff');
  if (record.leaders && record.leaders.length > 0) {
    updateLeaderCount(sheet, record.leaders, className);
  }
}

function updateLeaderCount(sheet, leaders, className) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const gradeMatch    = className.match(/(\d+)학년/);
  const classNumMatch = className.match(/(\d+)반/);
  if (!gradeMatch || !classNumMatch) return;
  const grade  = gradeMatch[1];
  const marker = grade + '-' + classNumMatch[1];
  const gradeColMap = {
    '3': {classCol:10, nameCol:12, countCol:13},
    '4': {classCol:14, nameCol:16, countCol:17},
    '5': {classCol:18, nameCol:20, countCol:21},
    '6': {classCol:22, nameCol:24, countCol:25}
  };
  const cols = gradeColMap[grade];
  if (!cols) return;
  const classValues = sheet.getRange(2, cols.classCol, lastRow-1, 1).getValues();
  const nameValues  = sheet.getRange(2, cols.nameCol,  lastRow-1, 1).getValues();
  const countValues = sheet.getRange(2, cols.countCol, lastRow-1, 1).getValues();
  let startIdx = -1, endIdx = classValues.length - 1;
  for (let i = 0; i < classValues.length; i++) {
    const val = String(classValues[i][0]).trim();
    if (val === marker) { startIdx = i; }
    else if (startIdx >= 0 && i > startIdx && val !== '') { endIdx = i-1; break; }
  }
  if (startIdx === -1) return;
  leaders.forEach(leaderName => {
    for (let i = startIdx; i <= endIdx; i++) {
      if (String(nameValues[i][0]).trim() === String(leaderName).trim()) {
        countValues[i][0] = (Number(countValues[i][0]) || 0) + 1;
      }
    }
  });
  sheet.getRange(2, cols.countCol, lastRow-1, 1).setValues(countValues);
}

function loadRecords(classId) {
  const sheet   = getOrCreateSheet();
  const data    = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === classId) {
      try {
        records.push({year:data[i][1], month:data[i][2], date:data[i][3], groups:JSON.parse(data[i][4])});
      } catch(e) {}
    }
  }
  return {success: true, records};
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1,1,1,5).setValues([['반 ID','년도','월','날짜','모둠 데이터(JSON)']]);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,5).setFontWeight('bold').setBackground('#534AB7').setFontColor('white');
    sheet.setColumnWidth(5, 400);
  }
  return sheet;
}

// ==================== 일해용! 전담 ====================
// 구글 시트 탭 3개: 수업일지 / 시간표 / 진도표
const JM_SPREADSHEET_ID = '15guvRV5h9kD1iTyoIjDbPaBDDe0OaiqNeV15ILx_3_E';

function jm_getSpreadsheet() {
  return SpreadsheetApp.openById(JM_SPREADSHEET_ID);
}

function jm_journalSheet() {
  const ss = jm_getSpreadsheet();
  let s = ss.getSheetByName('수업일지');
  if (!s) {
    s = ss.insertSheet('수업일지');
    s.getRange(1,1,1,6).setValues([['순번','날짜','교시','학급','학생명','지도내용']]);
    s.getRange(1,1,1,6).setFontWeight('bold').setBackground('#4285F4').setFontColor('white');
    s.setFrozenRows(1);
    s.setColumnWidth(6, 400);
  }
  return s;
}

function jm_timetableSheet() {
  const ss = jm_getSpreadsheet();
  let s = ss.getSheetByName('시간표');
  if (!s) {
    s = ss.insertSheet('시간표');
    s.getRange(1,1,1,7).setValues([['구분','교시/학급','월','화','수','목','금']]);
    s.getRange(1,1,1,7).setFontWeight('bold').setBackground('#34A853').setFontColor('white');
    s.setFrozenRows(1);
  }
  return s;
}

function jm_syllabusSheet() {
  const ss = jm_getSpreadsheet();
  let s = ss.getSheetByName('진도표');
  if (!s) {
    s = ss.insertSheet('진도표');
    s.getRange(1,1,1,7).setValues([['과목','기간','단원명','차시','학습주제','준비물','상태']]);
    s.getRange(1,1,1,7).setFontWeight('bold').setBackground('#FBBC04').setFontColor('white');
    s.setFrozenRows(1);
  }
  return s;
}

// ---------- 전체 데이터 한번에 ----------
function loadAll(userId) {
  const ttResult = loadAllTimetables(userId);
  const sylSheet = jm_syllabusSheet();
  const sylRows = sylSheet.getDataRange().getValues();
  const syllabusData = {};
  for (let i = 1; i < sylRows.length; i++) {
    const subject = String(sylRows[i][0]||'').trim();
    if (!subject) continue;
    if (!syllabusData[subject]) syllabusData[subject] = [];
    syllabusData[subject].push({
      period: sylRows[i][1]||'', unit: String(sylRows[i][2]||''), ch: String(sylRows[i][3]||''),
      topic: String(sylRows[i][4]||''), prep: String(sylRows[i][5]||''), status: String(sylRows[i][6]||'todo')
    });
  }
  const journalResult = loadJournal(userId);
  return {
    success: true,
    myTT: ttResult.myTT,
    classTTList: ttResult.classTTList,
    syllabusData,
    journals: journalResult.journals
  };
}

// ---------- 수업일지 ----------
// 기존 시트 구조: A=순번, B=날짜, C=시간/교시, D=학급, E=대상(학생/담임교사), F=학생명, G=지도내용
function loadJournal(userId) {
  const s = jm_journalSheet();
  const data = s.getDataRange().getValues();
  const journals = [];
  const headers = data[0] || [];
  const has대상 = String(headers[4]).includes('대상');
  for (let i = 1; i < data.length; i++) {
    if (!data[i][1]) continue;
    // Date 객체와 문자열 모두 YYYY-MM-DD 형식으로 통일
    const raw = data[i][1];
    const dateStr = (raw instanceof Date)
      ? Utilities.formatDate(raw, 'Asia/Seoul', 'yyyy-MM-dd')
      : String(raw);
    // 학급 컬럼: Sheets가 "2-3" 같은 값을 날짜로 자동변환하는 경우 복원
    const rawCls = data[i][3];
    const clsStr = (rawCls instanceof Date)
      ? `${rawCls.getMonth() + 1}-${rawCls.getDate()}`
      : String(rawCls || '');
    if (has대상) {
      journals.push({ seq:data[i][0], date:dateStr, period:data[i][2], class:clsStr, target:data[i][4], name:data[i][5], content:data[i][6] });
    } else {
      journals.push({ seq:data[i][0], date:dateStr, period:data[i][2], class:clsStr, name:data[i][4], content:data[i][5] });
    }
  }
  return {success:true, journals};
}

function saveJournal(userId, j) {
  const s = jm_journalSheet();
  const headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  const has대상 = String(headers[4]).includes('대상');
  const seq = s.getLastRow();
  if (has대상) {
    s.appendRow([seq, j.date, j.period, j.class, j.target||'학생', j.name, j.content]);
  } else {
    s.appendRow([seq, j.date, j.period, j.class, j.name, j.content]);
  }
  return {success:true};
}

// ---------- 시간표 ----------
function loadMyTimetable(userId) {
  const s = jm_timetableSheet();
  const data = s.getDataRange().getValues();
  const myTT = {1:['','','','',''],2:['','','','',''],3:['','','','',''],4:['','','','',''],5:['','','','','']};

  for (let i = 1; i < data.length; i++) {
    const type = String(data[i][0]).trim();
    const key  = String(data[i][1]).trim();
    const row  = [String(data[i][2]||''), String(data[i][3]||''), String(data[i][4]||''), String(data[i][5]||''), String(data[i][6]||'')];
    // '내시간표' 또는 구분 비어있는 사용자 직접입력 형식 (예: "1교시", "2교시")
    if (type === '내시간표' || type === '') {
      const pMatch = key.match(/^(\d+)/);
      if (pMatch) {
        const p = parseInt(pMatch[1]);
        if (p >= 1 && p <= 5) myTT[p] = row;
      }
    }
  }
  return {success: true, timetable: myTT};
}

function saveMyTimetable(userId, ttData) {
  const s = jm_timetableSheet();
  const lastRow = s.getLastRow();
  if (lastRow > 1) {
    const data = s.getRange(2, 1, lastRow - 1, 7).getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      const type = String(data[i][0]).trim();
      const key  = String(data[i][1]).trim();
      if (type === '내시간표' || (type === '' && /^\d+/.test(key))) {
        s.deleteRow(i + 2);
      }
    }
  }
  for (let p = 1; p <= 5; p++) {
    const tt = ttData[p] || ttData[String(p)] || ['','','','',''];
    s.appendRow(['내시간표', p, tt[0]||'', tt[1]||'', tt[2]||'', tt[3]||'', tt[4]||'']);
  }
  return {success: true};
}

function loadAllTimetables(userId) {
  const s = jm_timetableSheet();
  const data = s.getDataRange().getValues();
  const myTT = {1:['','','','',''],2:['','','','',''],3:['','','','',''],4:['','','','',''],5:['','','','','']};
  const classTTMap = {};

  for (let i = 1; i < data.length; i++) {
    const type = String(data[i][0]).trim();
    const key  = String(data[i][1]).trim();
    const row  = [String(data[i][2]||''), String(data[i][3]||''), String(data[i][4]||''), String(data[i][5]||''), String(data[i][6]||'')];
    if (type === '내시간표') {
      const p = parseInt(key);
      if (p >= 1 && p <= 5) myTT[p] = row;
    } else if (type === '담당학급') {
      // key 형태: '4-2-3교시'
      const match = key.match(/^(.+)-(\d+)교시$/);
      if (match) {
        const clsName = match[1];
        const p = parseInt(match[2]) - 1; // 0-indexed
        if (!classTTMap[clsName]) classTTMap[clsName] = [['','','','',''],['','','','',''],['','','','',''],['','','','',''],['','','','','']];
        if (p >= 0 && p < 5) classTTMap[clsName][p] = row;
      }
    }
  }
  const classTTList = Object.keys(classTTMap).sort().map(name => ({ name, tt: classTTMap[name] }));
  return {success:true, myTT, classTTList};
}

function saveTimetables(userId, myTT, classTTList) {
  const s = jm_timetableSheet();
  const lastRow = s.getLastRow();
  if (lastRow > 1) s.getRange(2, 1, lastRow - 1, 7).clearContent();

  const rows = [];
  for (let p = 1; p <= 5; p++) {
    const tt = myTT[p] || myTT[String(p)] || ['','','','',''];
    rows.push(['내시간표', p, tt[0]||'', tt[1]||'', tt[2]||'', tt[3]||'', tt[4]||'']);
  }
  for (const cls of (classTTList||[])) {
    for (let p = 0; p < 5; p++) {
      const tt = Array.isArray(cls.tt) ? (cls.tt[p] || ['','','','','']) : ['','','','',''];
      rows.push(['담당학급', `${cls.name}-${p+1}교시`, tt[0]||'', tt[1]||'', tt[2]||'', tt[3]||'', tt[4]||'']);
    }
  }
  if (rows.length) s.getRange(2, 1, rows.length, 7).setValues(rows);
  return {success:true};
}

// ---------- 진도표 ----------
function loadSyllabus(userId, subject) {
  const s = jm_syllabusSheet();
  const data = s.getDataRange().getValues();
  const items = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] !== subject) continue;
    items.push({ period:data[i][1], unit:data[i][2], ch:data[i][3], topic:data[i][4], prep:data[i][5], status:data[i][6]||'todo' });
  }
  return {success:true, items};
}

function saveSyllabus(userId, subject, sylData) {
  const s = jm_syllabusSheet();
  // 해당 과목 행만 삭제
  const data = s.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === subject) s.deleteRow(i + 1);
  }
  // 새로 추가
  sylData.forEach(item => {
    s.appendRow([subject, item.period||'', item.unit||'', item.ch||'', item.topic||'', item.prep||'', item.status||'todo']);
  });
  return {success:true};
}
