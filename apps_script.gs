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
        result = saveTimetables(userId, data.myTT, data.classTTList, data.events);
      } else if (action === 'loadSyllabus') {
        result = loadSyllabus(userId, data.subject);
      } else if (action === 'saveSyllabus') {
        result = saveSyllabus(userId, data.subject, data.sylData);
      } else if (action === 'extractImages') {
        result = extractAndSaveImages();
      } else if (action === 'setupTimetableSheet') {
        const ss2 = jm_getSpreadsheet();
        const ts = ss2.getSheetByName('시간표') || ss2.insertSheet('시간표');
        setupTimetableTemplate(ts);
        result = { success: true, message: '시간표 양식이 초기화되었습니다.' };
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

// ─── 시간표 탭 고정 행 위치 (절대 변경 금지) ───
// Row 1: 타이틀 / Row 2: 안내 / Row 3: 빈칸
// Row 4: ① 기본시간표 섹션 / Row 5: 컬럼헤더
// Rows 6-11: 내시간표 (1교시~6교시)
// Row 12: 빈칸
// Row 13: ② 방학 섹션 / Row 14: 컬럼헤더
// Rows 15-24: 방학 (10 슬롯)
// Row 25: 빈칸
// Row 26: ③ 행사 섹션 / Row 27: 컬럼헤더
// Rows 28-37: 행사 (10 슬롯)
// Row 38: 빈칸
// Row 39: ④ 필요시수 섹션 / Row 40: 컬럼헤더
// Rows 41-50: 필요시수 (10 슬롯)
// Row 51: 빈칸
// Row 52: ⑤ 담당학급 섹션 / Row 53: 컬럼헤더
// Row 54+: 담당학급 data (가변)

function jm_timetableSheet() {
  const ss = jm_getSpreadsheet();
  let s = ss.getSheetByName('시간표');
  if (!s) {
    s = ss.insertSheet('시간표');
    setupTimetableTemplate(s);
  } else {
    // A1이 '타이틀'이 아니면 새 템플릿 미적용 → 초기화
    const a1 = String(s.getRange(1, 1).getValue() || '').trim();
    if (a1 !== '타이틀') setupTimetableTemplate(s);
  }
  return s;
}

function setupTimetableTemplate(s) {
  s.clear();

  // A열=타입마커(숨김), B~G=사용자 표시 영역
  const rows = [
    // ① 기본 메타 (rows 1-3)
    ['타이틀', '📅 일해용! 전담 — 시간표 시스템', '', '', '', '', ''],
    ['안내', '💡 노란색 칸에 직접 입력 | 시트 수정 후 웹에서 [🔄 시트에서 새로고침] 클릭', '', '', '', '', ''],
    ['빈칸', '', '', '', '', '', ''],
    // ① 기본시간표 (rows 4-11)
    ['섹션', '① 기본시간표 (1주 패턴) — 요일별 교시 칸에 과목/학급 입력 (예: 과학, 3-1)', '', '', '', '', ''],
    ['컬럼헤더', '교시', '월', '화', '수', '목', '금'],
    ['내시간표', '1교시', '', '', '', '', ''],
    ['내시간표', '2교시', '', '', '', '', ''],
    ['내시간표', '3교시', '', '', '', '', ''],
    ['내시간표', '4교시', '', '', '', '', ''],
    ['내시간표', '5교시', '', '', '', '', ''],
    ['내시간표', '6교시', '', '', '', '', ''],
    ['빈칸', '', '', '', '', '', ''],
    // ② 방학 기간 (rows 13-25)
    ['섹션', '② 방학 기간 — 수업이 없는 기간 입력 (날짜 형식: 2026-07-21)', '', '', '', '', ''],
    ['컬럼헤더', '시작일', '종료일', '방학명', '', '', ''],
    ['방학', '2026-07-21', '2026-08-23', '여름방학', '', '', ''],
    ['방학', '2026-12-26', '2027-01-19', '겨울방학', '', '', ''],
    ['방학', '', '', '', '', '', ''],
    ['방학', '', '', '', '', '', ''],
    ['방학', '', '', '', '', '', ''],
    ['방학', '', '', '', '', '', ''],
    ['방학', '', '', '', '', '', ''],
    ['방학', '', '', '', '', '', ''],
    ['방학', '', '', '', '', '', ''],
    ['방학', '', '', '', '', '', ''],
    ['빈칸', '', '', '', '', '', ''],
    // ③ 행사일 (rows 26-38)
    ['섹션', '③ 행사일 (수업 없는 날) — 날짜 형식: 2026-05-05', '', '', '', '', ''],
    ['컬럼헤더', '날짜', '행사명', '비고', '', '', ''],
    ['행사', '', '', '', '', '', ''],
    ['행사', '', '', '', '', '', ''],
    ['행사', '', '', '', '', '', ''],
    ['행사', '', '', '', '', '', ''],
    ['행사', '', '', '', '', '', ''],
    ['행사', '', '', '', '', '', ''],
    ['행사', '', '', '', '', '', ''],
    ['행사', '', '', '', '', '', ''],
    ['행사', '', '', '', '', '', ''],
    ['행사', '', '', '', '', '', ''],
    ['빈칸', '', '', '', '', '', ''],
    // ④ 과목별 필요시수 (rows 39-51)
    ['섹션', '④ 과목별 필요시수 — 1학기/2학기 각각 필요한 수업 시수를 숫자로 입력', '', '', '', '', ''],
    ['컬럼헤더', '학년/과목', '1학기 필요시수', '2학기 필요시수', '', '', ''],
    ['필요시수', '2학년 즐거운생활', 40, 40, '', '', ''],
    ['필요시수', '3학년 과학', 40, 40, '', '', ''],
    ['필요시수', '4학년 과학', 51, 51, '', '', ''],
    ['필요시수', '5학년 과학', 51, 51, '', '', ''],
    ['필요시수', '6학년 과학', 51, 51, '', '', ''],
    ['필요시수', '', '', '', '', '', ''],
    ['필요시수', '', '', '', '', '', ''],
    ['필요시수', '', '', '', '', '', ''],
    ['필요시수', '', '', '', '', '', ''],
    ['필요시수', '', '', '', '', '', ''],
    ['빈칸', '', '', '', '', '', ''],
    // ⑤ 담당학급 시간표 (rows 52-53 고정 헤더, 54+는 가변)
    ['섹션', '⑤ 담당학급 시간표 (웹사이트에서 자동 저장 — 직접 수정도 가능)', '', '', '', '', ''],
    ['컬럼헤더', '교시', '월', '화', '수', '목', '금'],
  ];

  s.getRange(1, 1, rows.length, 7).setValues(rows);

  // ── 스타일 적용 ──
  const COLORS = { purple: '#534AB7', light: '#E8F0FE', lightPurple: '#F0EFFE',
                   yellow: '#FFFDE7', green: '#E8F5E9' };

  // Row 1: 타이틀
  s.getRange(1, 2, 1, 6).merge()
    .setBackground(COLORS.purple).setFontColor('#fff').setFontSize(13)
    .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');
  s.setRowHeight(1, 38);

  // Row 2: 안내
  s.getRange(2, 2, 1, 6).merge()
    .setBackground('#FFF9C4').setFontColor('#666').setFontSize(10)
    .setHorizontalAlignment('center');
  s.setRowHeight(2, 22);

  // Row 3: 빈칸
  s.getRange(3, 1, 1, 7).setBackground('#e8e8e8');
  s.setRowHeight(3, 8);

  // 섹션 헤더 행들: 4, 13, 26, 39, 52
  [4, 13, 26, 39, 52].forEach(r => {
    s.getRange(r, 2, 1, 6).merge()
      .setBackground(COLORS.light).setFontColor('#1A56BD')
      .setFontWeight('bold').setFontSize(11);
    s.setRowHeight(r, 28);
  });

  // 컬럼헤더 행들: 5, 14, 27, 40, 53
  [5, 14, 27, 40, 53].forEach(r => {
    s.getRange(r, 2, 1, 6)
      .setBackground(COLORS.lightPurple).setFontColor(COLORS.purple)
      .setFontWeight('bold').setHorizontalAlignment('center');
    s.setRowHeight(r, 24);
  });

  // 빈칸 구분선 행들: 12, 25, 38, 51
  [12, 25, 38, 51].forEach(r => {
    s.getRange(r, 1, 1, 7).setBackground('#e8e8e8');
    s.setRowHeight(r, 8);
  });

  // ① 기본시간표 데이터: rows 6-11 (교시 레이블=B열, 입력칸=C~G열)
  for (let r = 6; r <= 11; r++) {
    s.getRange(r, 2).setBackground('#f5f5f5').setFontWeight('bold').setFontColor('#555')
      .setHorizontalAlignment('center');
    s.getRange(r, 3, 1, 5).setBackground(COLORS.yellow).setHorizontalAlignment('center');
    s.setRowHeight(r, 26);
  }

  // ② 방학: rows 15-24 (B~D열 노란색)
  s.getRange(15, 2, 10, 3).setBackground(COLORS.yellow);
  for (let r = 15; r <= 24; r++) s.setRowHeight(r, 22);

  // ③ 행사: rows 28-37 (B~D열 노란색)
  s.getRange(28, 2, 10, 3).setBackground(COLORS.yellow);
  for (let r = 28; r <= 37; r++) s.setRowHeight(r, 22);

  // ④ 필요시수: rows 41-50
  // 5개 기본과목(B열=회색라벨, C~D열=노란색), 5개 빈칸(B~D열=노란색)
  for (let r = 41; r <= 45; r++) {
    s.getRange(r, 2).setBackground('#f5f5f5').setFontWeight('bold').setFontColor('#444');
    s.getRange(r, 3, 1, 2).setBackground(COLORS.yellow).setHorizontalAlignment('center');
    s.setRowHeight(r, 22);
  }
  s.getRange(46, 2, 5, 3).setBackground(COLORS.yellow);
  for (let r = 46; r <= 50; r++) s.setRowHeight(r, 22);

  // ⑤ 담당학급 섹션 헤더 배경은 초록색으로 구분
  s.getRange(52, 2, 1, 6).merge()
    .setBackground(COLORS.green).setFontColor('#2E7D32')
    .setFontWeight('bold').setFontSize(11);
  s.getRange(53, 2, 1, 6)
    .setBackground('#F1F8E9').setFontColor('#2E7D32')
    .setFontWeight('bold').setHorizontalAlignment('center');

  // 열 너비 설정
  s.setColumnWidth(1, 20);   // A: 숨김 타입마커
  s.setColumnWidth(2, 140);  // B: 교시/시작일/학년과목
  s.setColumnWidth(3, 110);  // C: 월/종료일/1학기
  s.setColumnWidth(4, 110);  // D: 화/방학명/2학기
  s.setColumnWidth(5, 110);  // E: 수
  s.setColumnWidth(6, 110);  // F: 목
  s.setColumnWidth(7, 110);  // G: 금

  // A열(타입마커) 숨기기
  s.hideColumns(1);
  // 타이틀+안내 고정
  s.setFrozenRows(2);
}

function jm_syllabusSheet() {
  const ss = jm_getSpreadsheet();
  let s = ss.getSheetByName('진도표');
  if (!s) {
    s = ss.insertSheet('진도표');
    s.getRange(1,1,1,8).setValues([['과목','기간','단원명','차시','학습주제','준비물','상태','링크']]);
    s.getRange(1,1,1,8).setFontWeight('bold').setBackground('#FBBC04').setFontColor('white');
    s.setFrozenRows(1);
    s.setColumnWidth(8, 300);
    return s;
  }
  // 기존 시트에 링크 컬럼 없으면 추가 (하위 호환)
  const headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(String);
  if (!headers.includes('링크')) {
    const nextCol = s.getLastColumn() + 1;
    s.getRange(1, nextCol).setValue('링크').setFontWeight('bold').setBackground('#FBBC04').setFontColor('white');
    s.setColumnWidth(nextCol, 300);
  }
  return s;
}

// ---------- 전체 데이터 한번에 ----------
function loadAll(userId) {
  const ttResult = loadAllTimetables(userId);
  const sylSheet = jm_syllabusSheet();
  const sylRows = sylSheet.getDataRange().getValues();
  const headers = sylRows[0] ? sylRows[0].map(String) : [];
  const linkColIdx = headers.indexOf('링크');
  const syllabusData = {};
  for (let i = 1; i < sylRows.length; i++) {
    const subject = String(sylRows[i][0]||'').trim();
    if (!subject) continue;
    if (!syllabusData[subject]) syllabusData[subject] = [];
    syllabusData[subject].push({
      period: sylRows[i][1]||'', unit: String(sylRows[i][2]||''), ch: String(sylRows[i][3]||''),
      topic: String(sylRows[i][4]||''), prep: String(sylRows[i][5]||''),
      status: String(sylRows[i][6]||'todo'),
      links: linkColIdx >= 0 ? String(sylRows[i][linkColIdx]||'') : ''
    });
  }
  const journalResult = loadJournal(userId);
  return {
    success: true,
    myTT: ttResult.myTT,
    classTTList: ttResult.classTTList,
    timetableEvents: ttResult.timetableEvents,
    vacationPeriods: ttResult.vacationPeriods,
    subjectHoursData: ttResult.subjectHoursData,
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
  return loadAllTimetables(userId);
}

function saveMyTimetable(userId, ttData) {
  return saveTimetables(userId, ttData, null, null);
}

function loadAllTimetables(userId) {
  const s = jm_timetableSheet();
  const lastRow = s.getLastRow();
  const readLen = Math.max(lastRow, 53);
  const allData = s.getRange(1, 1, readLen, 7).getValues();

  const myTT = {};
  const classTTMap = {};
  const timetableEvents = {};
  const vacationPeriods = [];
  const subjectHoursData = {};

  for (let i = 0; i < allData.length; i++) {
    const type = String(allData[i][0] || '').trim();
    if (!type || type === '타이틀' || type === '안내' || type === '빈칸' ||
        type === '섹션' || type === '컬럼헤더') continue;

    if (type === '내시간표') {
      const label = String(allData[i][1] || '').trim();
      const m = label.match(/^(\d+)/);
      if (m) {
        const p = parseInt(m[1]);
        myTT[p] = [
          String(allData[i][2]||''), String(allData[i][3]||''),
          String(allData[i][4]||''), String(allData[i][5]||''), String(allData[i][6]||'')
        ];
      }

    } else if (type === '방학') {
      const rawS = allData[i][1], rawE = allData[i][2];
      if (!rawS || !rawE) continue;
      const toStr = v => v instanceof Date
        ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : String(v).trim();
      const s1 = toStr(rawS), e1 = toStr(rawE);
      if (/\d{4}-\d{2}-\d{2}/.test(s1) && /\d{4}-\d{2}-\d{2}/.test(e1)) {
        vacationPeriods.push({ start: s1, end: e1, label: String(allData[i][3]||'방학').trim() });
      }

    } else if (type === '행사') {
      const rawD = allData[i][1], evName = String(allData[i][2]||'').trim();
      if (!rawD || !evName) continue;
      const toStr = v => v instanceof Date
        ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : String(v).trim();
      const d = toStr(rawD);
      if (/\d{4}-\d{2}-\d{2}/.test(d)) timetableEvents[d] = evName;

    } else if (type === '필요시수') {
      const subject = String(allData[i][1]||'').trim();
      if (!subject) continue;
      subjectHoursData[subject] = {
        s1req: parseInt(allData[i][2]) || 0,
        s2req: parseInt(allData[i][3]) || 0
      };

    } else if (type === '담당학급') {
      const key = String(allData[i][1]||'').trim();
      const m = key.match(/^(.+)-(\d+)교시$/);
      if (!m) continue;
      const cls = m[1], p = parseInt(m[2]) - 1;
      if (!classTTMap[cls]) classTTMap[cls] = Array.from({length:6}, () => ['','','','','']);
      if (p >= 0 && p < 6) {
        classTTMap[cls][p] = [
          String(allData[i][2]||''), String(allData[i][3]||''),
          String(allData[i][4]||''), String(allData[i][5]||''), String(allData[i][6]||'')
        ];
      }
    }
  }

  const classTTList = Object.keys(classTTMap).sort().map(name => ({ name, tt: classTTMap[name] }));
  return { success:true, myTT, classTTList, timetableEvents, vacationPeriods, subjectHoursData };
}

function saveTimetables(userId, myTT, classTTList, events) {
  const s = jm_timetableSheet();

  // ① 기본시간표: rows 6-11의 C~G열만 업데이트 (A=타입마커, B=교시레이블 보존)
  if (myTT) {
    for (let p = 1; p <= 6; p++) {
      const tt = myTT[p] || myTT[String(p)];
      if (!tt) continue;
      s.getRange(5 + p, 3, 1, 5)
        .setValues([[tt[0]||'', tt[1]||'', tt[2]||'', tt[3]||'', tt[4]||'']]);
    }
  }

  // ⑤ 담당학급: row 54부터 기존 행 모두 삭제 후 재삽입
  const currLast = s.getLastRow();
  if (currLast >= 54) s.getRange(54, 1, currLast - 53, 7).clearContent().clearFormat();

  if (classTTList && classTTList.length) {
    const rows = [], styles = [];
    for (const cls of classTTList) {
      rows.push(['담당학급헤더', '[ ' + cls.name + ' ]', '월', '화', '수', '목', '금']);
      styles.push('h');
      for (let p = 0; p < 6; p++) {
        const tt = Array.isArray(cls.tt) ? (cls.tt[p] || ['','','','','']) : ['','','','',''];
        rows.push(['담당학급', `${cls.name}-${p+1}교시`, tt[0]||'', tt[1]||'', tt[2]||'', tt[3]||'', tt[4]||'']);
        styles.push('d');
      }
      rows.push(['', '', '', '', '', '', '']); styles.push('b');
    }
    s.getRange(54, 1, rows.length, 7).setValues(rows);
    for (let i = 0; i < styles.length; i++) {
      const r = s.getRange(54 + i, 1, 1, 7);
      if (styles[i] === 'h') r.setBackground('#F0EFFE').setFontWeight('bold').setFontColor('#534AB7');
      else if (styles[i] === 'd') {
        r.setBackground('#fff').setFontColor('#222').setFontStyle('normal').setFontWeight('normal');
        s.getRange(54 + i, 2).setFontWeight('bold').setFontColor('#666');
      } else r.setBackground('#f0f0f0');
    }
  }

  s.hideColumns(1);
  return { success: true };
}

// ---------- 진도표 ----------
function loadSyllabus(userId, subject) {
  const s = jm_syllabusSheet();
  const data = s.getDataRange().getValues();
  const headers = data[0] ? data[0].map(String) : [];
  const linkColIdx = headers.indexOf('링크');
  const items = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] !== subject) continue;
    items.push({
      period:data[i][1], unit:data[i][2], ch:data[i][3], topic:data[i][4], prep:data[i][5],
      status:data[i][6]||'todo',
      links: linkColIdx >= 0 ? String(data[i][linkColIdx]||'') : ''
    });
  }
  return {success:true, items};
}

function saveSyllabus(userId, subject, sylData) {
  const s = jm_syllabusSheet();
  const data = s.getDataRange().getValues();
  const headers = data[0] ? data[0].map(String) : [];
  const linkColIdx = headers.indexOf('링크');
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === subject) s.deleteRow(i + 1);
  }
  sylData.forEach(item => {
    const row = [subject, item.period||'', item.unit||'', item.ch||'', item.topic||'', item.prep||'', item.status||'todo', item.links||''];
    // 컬럼 수가 부족하면 링크까지 포함해서 저장
    if (linkColIdx < 0) {
      // 헤더에 링크 컬럼 없을 경우 8컬럼으로 저장
      s.appendRow(row);
    } else {
      // 링크 위치가 7번째가 아닌 경우 맞춤 저장
      const rowData = [subject, item.period||'', item.unit||'', item.ch||'', item.topic||'', item.prep||'', item.status||'todo'];
      while (rowData.length < linkColIdx) rowData.push('');
      rowData[linkColIdx] = item.links||'';
      s.appendRow(rowData);
    }
  });
  return {success:true};
}

// ==================== 2번: 이미지 자동 추출 ====================
function extractAndSaveImages() {
  const ss = jm_getSpreadsheet();
  const parentFolder = DriveApp.getFileById(ss.getId()).getParents().next();
  let imageCount = 0;
  const log = [];

  const sheets = ss.getSheets();
  for (const sheet of sheets) {
    const sheetName = sheet.getName();

    // 방법 1: =IMAGE() 수식에서 URL 추출
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow > 0 && lastCol > 0) {
      try {
        const formulas = sheet.getRange(1, 1, lastRow, lastCol).getFormulas();
        for (let r = 0; r < formulas.length; r++) {
          for (let c = 0; c < formulas[r].length; c++) {
            const f = formulas[r][c];
            if (!f || !f.toUpperCase().includes('IMAGE')) continue;
            const match = f.match(/IMAGE\(["']([^"']+)["']/i);
            if (!match) continue;
            const url = match[1];
            imageCount++;
            const fileName = 'image_' + String(imageCount).padStart(3, '0') + '.jpg';
            try {
              const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
              if (response.getResponseCode() === 200) {
                parentFolder.createFile(response.getBlob().setName(fileName));
                sheet.getRange(r + 1, c + 2).setValue(fileName);
                log.push('✅ [' + sheetName + '] ' + (r+1) + '행 ' + (c+1) + '열 → ' + fileName);
              }
            } catch(e) {
              log.push('❌ [' + sheetName + '] URL 다운로드 실패: ' + e.message);
            }
          }
        }
      } catch(e) {
        log.push('⚠ [' + sheetName + '] 수식 읽기 오류: ' + e.message);
      }
    }

    // 방법 2: 시트에 직접 삽입된 이미지 (OverGridImage)
    try {
      const images = sheet.getImages();
      for (const img of images) {
        imageCount++;
        const cell = img.getAnchorCell();
        const fileName = 'image_' + String(imageCount).padStart(3, '0') + '.png';
        try {
          const blob = img.getImageObject().getAs('image/png').setName(fileName);
          parentFolder.createFile(blob);
          sheet.getRange(cell.getRow(), cell.getColumn() + 1).setValue(fileName);
          log.push('✅ [' + sheetName + '] 삽입 이미지 → ' + fileName + ' (' + cell.getA1Notation() + ' 옆에 저장)');
        } catch(e) {
          log.push('⚠ [' + sheetName + '] 삽입 이미지 추출 실패: ' + e.message);
        }
      }
    } catch(e) {
      log.push('⚠ [' + sheetName + '] getImages 오류: ' + e.message);
    }
  }

  return {
    success: true,
    count: imageCount,
    message: imageCount + '개 이미지 처리 완료',
    log: log
  };
}
