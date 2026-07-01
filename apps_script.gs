/**
 * 통합 Google Apps Script 백엔드
 * - 모둠뽑기: doPost  { action:'save'|'load', classId, data }
 * - 관피타:   doGet   ?action=get&key=...  /  ?action=set&key=...&value=...
 *
 * [수정사항] writeKaoSheet에서 시트 전체를 지우던 것을 A~J열까지만 지우도록 변경
 *           → L열 이후 메모 영역은 더 이상 삭제되지 않음
 * GAS v82: setupTimetableTemplate/loadAllTimetables_legacy 구양식 코드 삭제
 * GAS v81: jm_syllabusSheet 헤더/마이그레이션을 A=완료,B=과목 순서로 수정
 *          (saveSyllabus/loadAll과 컬럼 순서 불일치 → 구글시트연동 결과 이상 버그 수정)
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
      } else if (action === 'deleteJournal') {
        result = deleteJournal(userId, data.rowNum);
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
      } else if (action === 'setupTimetableSheet') {
        const ss2 = jm_getSpreadsheet();
        const ts = ss2.getSheetByName('시간표') || ss2.insertSheet('시간표');
        setupTimetableTemplate(ts);
        result = { success: true, message: '시간표 양식이 초기화되었습니다.' };
      } else if (action === 'calcTimetable') {
        result = calcTimetable(userId, data.semYear);
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
    setupNewTimetableSheet();
    s = ss.getSheetByName('시간표');
  }
  return s;
}

function jm_syllabusSheet() {
  const ss = jm_getSpreadsheet();
  let s = ss.getSheetByName('진도표');
  // 정규 컬럼: A=완료, B=과목, C=순서, D=기간, E=차시, F=단원, G=학습주제, H=준비물, I=메모
  // (saveSyllabus/loadAll/loadSyllabus 모두 이 순서 기준)
  const CORRECT_HEADERS = ['완료','과목','순서','기간','차시','단원','학습주제','준비물','메모'];

  if (!s) {
    s = ss.insertSheet('진도표');
    s.getRange(1,1,1,9).setValues([CORRECT_HEADERS]);
    s.getRange(1,1,1,9).setFontWeight('bold').setBackground('#FBBC04').setFontColor('white');
    s.setFrozenRows(1);
    s.setColumnWidths(1, 9, 110);
    s.setColumnWidth(9, 250);
    return s;
  }

  // A1이 '완료'가 아니면 마이그레이션
  const lastCol = Math.max(s.getLastColumn(), 9);
  const headers = s.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (headers[0] !== '완료') {
    const lastRow = s.getLastRow();
    const oldData = lastRow > 1 ? s.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
    let newData;

    if (headers[1] === '수업완료') {
      // 버그 양식: A=과목명, B=완료상태, C=순서, D=기간, E=단원명, F=차시, G=학습주제, H=준비물, I=메모
      const subjectSeq = {};
      newData = oldData.filter(r => r[0]).map(r => {
        const subj = String(r[0]);
        subjectSeq[subj] = (subjectSeq[subj] || 0) + 1;
        return [
          String(r[1]||'').trim() || '할일',  // A=완료 (old B=수업완료)
          subj,                                 // B=과목 (old A=과목명)
          subjectSeq[subj],                    // C=순서
          String(r[3]||''),                    // D=기간
          String(r[5]||''),                    // E=차시 (old F=차시)
          String(r[4]||''),                    // F=단원 (old E=단원명)
          String(r[6]||''),                    // G=학습주제
          String(r[7]||''),                    // H=준비물
          String(r[8]||'')                     // I=메모
        ];
      });
    } else {
      newData = [];
    }

    s.clearContents();
    s.getRange(1,1,1,9).setValues([CORRECT_HEADERS]);
    if (newData.length) s.getRange(2,1,newData.length,9).setValues(newData);
    s.getRange(1,1,1,9).setFontWeight('bold').setBackground('#FBBC04').setFontColor('white');
    s.setFrozenRows(1);
    s.setColumnWidths(1, 9, 110);
    s.setColumnWidth(9, 250);
  }

  // 개념링크 헤더 (K~N, 11~14열): 없으면 추가 — 기존 데이터 행 건드리지 않음
  if (!String(s.getRange(1, 11).getValue()).trim()) {
    s.getRange(1, 11, 1, 4).setValues([['카테고리', '소카테고리', '주제', 'URL']]);
    s.getRange(1, 11, 1, 4).setFontWeight('bold').setBackground('#34A853').setFontColor('white');
    s.setColumnWidth(11, 90);   // K: 카테고리
    s.setColumnWidth(12, 90);   // L: 소카테고리
    s.setColumnWidth(13, 160);  // M: 주제
    s.setColumnWidth(14, 320);  // N: URL
  }
  return s;
}

// ---------- 전체 데이터 한번에 ----------
function loadAll(userId) {
  const ttResult = loadAllTimetables(userId);
  const sylSheet = jm_syllabusSheet();
  const sylRows = sylSheet.getDataRange().getValues();
  const lastDataRow = sylSheet.getLastRow();
  const syllabusData = {};
  for (let i = 1; i < sylRows.length; i++) {
    const subject = String(sylRows[i][1]||'').trim();
    if (!subject) continue;
    if (!syllabusData[subject]) syllabusData[subject] = [];
    // 신형 컬럼: [완료체크(0), 과목(1), 순서(2), 기간(3), 차시(4), 단원(5), 학습주제(6), 준비물(7), 메모(8)]
    const unitUrl = sylSheet.getRange(i + 1, 6).getRichTextValue().getLinkUrl() || '';
    syllabusData[subject].push({
      done: String(sylRows[i][0]||'').trim() === '완료',
      period: String(sylRows[i][3]||''),
      ch: String(sylRows[i][4]||''),
      unit: String(sylRows[i][5]||''),
      unitUrl,
      topic: String(sylRows[i][6]||''),
      prep: String(sylRows[i][7]||''),
      memo: String(sylRows[i][8]||'')
    });
  }
  const journalResult = loadJournal(userId);
  const conceptResult = loadConceptLinks();
  return {
    success: true,
    myTT: ttResult.myTT,
    classTTList: ttResult.classTTList,
    timetableEvents: ttResult.timetableEvents,
    vacationPeriods: ttResult.vacationPeriods,
    subjectHoursData: ttResult.subjectHoursData,
    fullTimetable: ttResult.fullTimetable || {s1:[],s2:[]},
    subjectHoursClasses: ttResult.subjectHoursClasses || [],
    syllabusData,
    journals: journalResult.journals,
    conceptLinks: conceptResult.data
  };
}

// ---------- 개념링크 ----------
// 진도표 시트 K~N열(10~13): 카테고리(K), 소카테고리(L), 주제(M), URL(N)
// 병합 셀로 인한 빈칸은 위 행 값 상속
function loadConceptLinks() {
  const sheet = jm_syllabusSheet();
  const rows = sheet.getDataRange().getValues();
  const data = {};
  let lastCat = '', lastSubcat = '';
  for (let i = 1; i < rows.length; i++) {
    const cat    = String(rows[i][10]||'').trim() || lastCat;
    const subcat = String(rows[i][11]||'').trim() || lastSubcat;
    const topic  = String(rows[i][12]||'').trim();
    const url    = String(rows[i][13]||'').trim();
    if (cat) lastCat = cat;
    if (subcat) lastSubcat = subcat;
    if (!cat || !url) continue;
    if (!data[cat]) data[cat] = [];
    data[cat].push({ subcat, topic, url });
  }
  return { data };
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
    const rowNum = i + 1; // 시트 실제 행 번호 (1-indexed, 1행은 헤더)
    if (has대상) {
      journals.push({ rowNum, seq:data[i][0], date:dateStr, period:data[i][2], class:clsStr, target:data[i][4], name:data[i][5], content:data[i][6] });
    } else {
      journals.push({ rowNum, seq:data[i][0], date:dateStr, period:data[i][2], class:clsStr, name:data[i][4], content:data[i][5] });
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

function deleteJournal(userId, rowNum) {
  const s = jm_journalSheet();
  if (!rowNum || rowNum < 2) return {success: false, message: '잘못된 행 번호'};
  s.deleteRow(rowNum);
  return {success: true};
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
  if (lastRow < 1) return { success:true, myTT:{}, classTTList:[], timetableEvents:{}, vacationPeriods:[], subjectHoursData:{}, fullTimetable:{s1:[],s2:[]}, subjectHoursClasses:[] };
  return loadAllTimetables_new(s, lastRow);
}

function loadAllTimetables_new(s, lastRow) {
  // 신 양식: 4구역 (내시간표, 학급시간표, 전체시간표, 시수계산표)
  const totalCols = 34;
  const allData = s.getRange(1, 1, lastRow, totalCols).getValues();

  const myTT = {};
  const classTTMap = {};
  const fullTimetable = { s1: [], s2: [] };
  const subjectHoursData = {};
  let subjectHoursClasses = [];
  let currentSection = '';
  let currentSemKey = 's1';
  let currentClassKey = '';

  for (let i = 0; i < allData.length; i++) {
    const raw0 = allData[i][0];
    let type = raw0 instanceof Date
      ? (raw0.getMonth()+1) + '-' + raw0.getDate()
      : String(raw0 || '').trim();
    if (!type) continue;

    if (type === '[내시간표]') { currentSection = 'mytt'; continue; }
    if (type === '[학급시간표]') { currentSection = 'classtt'; continue; }
    if (type.startsWith('[전체시간표]')) {
      currentSection = 'fulltt';
      currentSemKey = type.includes('2학기') ? 's2' : 's1';
      continue;
    }
    if (type === '[시수계산표]') { currentSection = 'hours'; continue; }

    if (currentSection === 'mytt') {
      if (type !== '내시간표') continue;
      const m = String(allData[i][1]||'').trim().match(/^(\d+)/);
      if (!m) continue;
      myTT[parseInt(m[1])] = [2,3,4,5,6].map(c => String(allData[i][c]||'').trim());
    }
    else if (currentSection === 'classtt') {
      if (type === '[학급]') {
        const raw = allData[i][1];
        currentClassKey = raw instanceof Date
          ? (raw.getMonth()+1) + '-' + raw.getDate()
          : String(raw||'').trim();
      } else if (type === '학급행' && currentClassKey) {
        const m = String(allData[i][1]||'').trim().match(/^(\d+)/);
        if (!m) continue;
        const p = parseInt(m[1]) - 1;
        if (!classTTMap[currentClassKey]) classTTMap[currentClassKey] = Array.from({length:6},()=>['','','','','']);
        if (p >= 0 && p < 6) classTTMap[currentClassKey][p] = [2,3,4,5,6].map(c => String(allData[i][c]||'').trim());
      }
    }
    else if (currentSection === 'fulltt') {
      if (type === '전체헤더' || type === '전체헤더2') continue;
      const weekNum = parseInt(type);
      if (isNaN(weekNum) || weekNum < 1) continue;
      const period = String(allData[i][2]||'').trim();
      const days = [];
      for (let d = 0; d < 5; d++) {
        const periods = [];
        for (let p = 0; p < 6; p++) periods.push(String(allData[i][3+d*6+p]||'').trim());
        days.push(periods);
      }
      fullTimetable[currentSemKey].push({ week: weekNum, period, days, note: String(allData[i][33]||'').trim() });
    }
    else if (currentSection === 'hours') {
      if (type === '시수학급') {
        // A=마커, B=행레이블, C열~=학급명
        subjectHoursClasses = allData[i].slice(2).map(v =>
          v instanceof Date ? (v.getMonth()+1)+'-'+v.getDate() : String(v||'').trim()
        ).filter(v => v && v !== '시수체크');
      } else if (type === '시수주당1') {
        subjectHoursClasses.forEach((cls, ci) => {
          if (!subjectHoursData[cls]) subjectHoursData[cls] = {};
          subjectHoursData[cls].s1weekly = parseInt(allData[i][ci+2]) || 0;
        });
      } else if (type === '시수주당2') {
        subjectHoursClasses.forEach((cls, ci) => {
          if (!subjectHoursData[cls]) subjectHoursData[cls] = {};
          subjectHoursData[cls].s2weekly = parseInt(allData[i][ci+2]) || 0;
        });
      }
    }
  }

  // 실제수업 계산
  subjectHoursClasses.forEach(cls => {
    if (!subjectHoursData[cls]) subjectHoursData[cls] = {};
    const d = subjectHoursData[cls];
    let s1count = 0, s2count = 0;
    fullTimetable.s1.forEach(w => { if (w.days.some(day => day.some(p => p === cls))) s1count++; });
    fullTimetable.s2.forEach(w => { if (w.days.some(day => day.some(p => p === cls))) s2count++; });
    d.s1actual = s1count; d.s2actual = s2count;
    d.s1total17 = (d.s1weekly||0)*17; d.s2total17 = (d.s2weekly||0)*17;
  });

  // 실제수업 시트에 write-back
  if (subjectHoursClasses.length) {
    for (let i = 0; i < allData.length; i++) {
      const t = String(allData[i][0]||'').trim();
      if (t === '시수실제1' || t === '시수실제2') {
        const actKey = t === '시수실제1' ? 's1actual' : 's2actual';
        subjectHoursClasses.forEach((cls, ci) => {
          const val = (subjectHoursData[cls] && subjectHoursData[cls][actKey]) || 0;
          s.getRange(i+1, ci+3).setValue(val);
        });
      }
    }
  }

  const classTTList = Object.keys(classTTMap).sort()
    .filter(n => classTTMap[n].some(p => p.some(v => v !== '')))
    .map(n => ({ name: n, tt: classTTMap[n] }));
  return { success:true, myTT, classTTList, timetableEvents:{}, vacationPeriods:[],
           subjectHoursData, fullTimetable, subjectHoursClasses };
}

// ==================== 시간표 시트 4구역 신양식 생성 ====================
function setupNewTimetableSheet() {
  const ss = jm_getSpreadsheet();
  let s = ss.getSheetByName('시간표');
  if (s) ss.deleteSheet(s);
  s = ss.insertSheet('시간표');
  const BLUE = '#185FA5', BLUE_L = '#E6F1FB', YELLOW = '#FAEEDA', GRAY = '#F5F5F5';
  const yr = new Date().getFullYear();
  let row = 1;
  const DAYS = ['월','화','수','목','금'];

  // ── 구역1: 내 시간표 ──
  s.getRange(row,1,1,7).setValues([['[내시간표]','교시','월','화','수','목','금']]);
  s.getRange(row,1,1,7).setBackground(BLUE).setFontColor('#fff').setFontWeight('bold');
  row++;
  for (var p=1;p<=6;p++) {
    s.getRange(row,1,1,7).setValues([['내시간표',p+'교시','','','','','']]);
    s.getRange(row,3,1,5).setBackground(YELLOW);
    row++;
  }
  row += 2;

  // ── 구역2: 학급시간표 ──
  s.getRange(row,1,1,7).merge().setValue('[학급시간표] [학급] 행의 B열에 학급명 입력, 노란칸에 시간표 입력');
  s.getRange(row,1,1,7).setBackground(BLUE).setFontColor('#fff').setFontWeight('bold');
  row++;
  ['3-1','4-1'].forEach(function(cls) {
    s.getRange(row,1,1,7).setValues([['[학급]',cls,'월','화','수','목','금']]);
    s.getRange(row,1,1,7).setBackground(BLUE_L).setFontColor(BLUE).setFontWeight('bold');
    row++;
    for (var p2=1;p2<=6;p2++) {
      s.getRange(row,1,1,7).setValues([['학급행',p2+'교시','','','','','']]);
      s.getRange(row,3,1,5).setBackground(YELLOW);
      row++;
    }
    row++;
  });
  row++;

  // ── 구역3: 전체시간표 (1학기) ──
  var h1 = ['전체헤더','주','기간'];
  DAYS.forEach(function(d){h1.push(d);for(var i=0;i<5;i++)h1.push('');});
  h1.push('비고');
  var h2 = ['전체헤더2','',''];
  for(var d2=0;d2<5;d2++) for(var p3=1;p3<=6;p3++) h2.push(String(p3));
  h2.push('');

  function writeSem(semLabel) {
    s.getRange(row,1,1,34).merge().setValue('[전체시간표] '+semLabel);
    s.getRange(row,1,1,34).setBackground(BLUE).setFontColor('#fff').setFontWeight('bold');
    row++;
    s.getRange(row,1,1,34).setValues([h1]);
    for(var d=0;d<5;d++) s.getRange(row,4+d*6,1,6).merge();
    s.getRange(row,1,1,34).setBackground(BLUE_L).setFontColor(BLUE).setFontWeight('bold').setHorizontalAlignment('center');
    row++;
    s.getRange(row,1,1,34).setValues([h2]);
    s.getRange(row,1,1,34).setBackground(BLUE_L).setFontColor(BLUE).setHorizontalAlignment('center');
    row++;
    for(var w=1;w<=20;w++) {
      var rd = [String(w), w, ''].concat(Array(30).fill('')).concat(['']);
      s.getRange(row,1,1,34).setValues([rd]);
      s.getRange(row,3,1,31).setBackground(YELLOW);
      row++;
    }
    row += 3;
  }
  writeSem(yr+'학년도 1학기');
  writeSem(yr+'학년도 2학기');

  // ── 구역4: 시수계산표 ──
  // 구조: A=마커, B=행레이블, C~N=학급12개(노란칸), O=시수체크(합계)
  var NC = 12; // 학급 최대 개수
  var CL = function(n) { return String.fromCharCode(64+n); }; // 열번호→문자 (1=A, 3=C...)

  s.getRange(row,1,1,NC+3).merge().setValue('[시수계산표] C열~에 학급명 입력, 노란칸에 주당시수 입력');
  s.getRange(row,1,1,NC+3).setBackground(BLUE).setFontColor('#fff').setFontWeight('bold');
  row++;

  // 학급명 행 (C열~N열 노란칸 직접 입력)
  var hdr = ['시수학급','학급명']; for(var i=0;i<NC;i++) hdr.push(''); hdr.push('시수체크');
  s.getRange(row,1,1,NC+3).setValues([hdr]);
  s.getRange(row,3,1,NC).setBackground(YELLOW);
  s.getRange(row,NC+3).setValue('시수체크').setBackground(GRAY).setFontWeight('bold').setHorizontalAlignment('center');
  s.getRange(row,1,1,NC+3).setFontWeight('bold');
  var r_cls = row; row++;

  // 1학기 주당 (노란칸)
  s.getRange(row,1).setValue('시수주당1'); s.getRange(row,2).setValue('주당(1학기)');
  s.getRange(row,3,1,NC).setBackground(YELLOW);
  s.getRange(row,NC+3).setFormula('=SUM('+CL(3)+row+':'+CL(NC+2)+row+')');
  var r_w1 = row; row++;

  // 1학기 17주 (자동: 주당×17)
  s.getRange(row,1).setValue('시수17주1'); s.getRange(row,2).setValue('1학기 17주');
  for(var c=3;c<=NC+2;c++) s.getRange(row,c).setFormula('='+CL(c)+r_w1+'*17');
  s.getRange(row,NC+3).setFormula('=SUM('+CL(3)+row+':'+CL(NC+2)+row+')');
  s.getRange(row,1,1,NC+3).setBackground(GRAY);
  var r_a1 = row; row++;

  // 1학기 실제수업 (자동: 전체시간표 카운트, GAS가 채움)
  s.getRange(row,1).setValue('시수실제1'); s.getRange(row,2).setValue('실제수업');
  s.getRange(row,NC+3).setFormula('=SUM('+CL(3)+row+':'+CL(NC+2)+row+')');
  s.getRange(row,1,1,NC+3).setBackground(GRAY);
  var r_r1 = row; row++;

  // 2학기 주당 (노란칸)
  s.getRange(row,1).setValue('시수주당2'); s.getRange(row,2).setValue('주당(2학기)');
  s.getRange(row,3,1,NC).setBackground(YELLOW);
  s.getRange(row,NC+3).setFormula('=SUM('+CL(3)+row+':'+CL(NC+2)+row+')');
  var r_w2 = row; row++;

  // 2학기 17주 (자동)
  s.getRange(row,1).setValue('시수17주2'); s.getRange(row,2).setValue('2학기 17주');
  for(var c2=3;c2<=NC+2;c2++) s.getRange(row,c2).setFormula('='+CL(c2)+r_w2+'*17');
  s.getRange(row,NC+3).setFormula('=SUM('+CL(3)+row+':'+CL(NC+2)+row+')');
  s.getRange(row,1,1,NC+3).setBackground(GRAY);
  var r_a2 = row; row++;

  // 2학기 실제수업 (자동, GAS가 채움)
  s.getRange(row,1).setValue('시수실제2'); s.getRange(row,2).setValue('실제수업');
  s.getRange(row,NC+3).setFormula('=SUM('+CL(3)+row+':'+CL(NC+2)+row+')');
  s.getRange(row,1,1,NC+3).setBackground(GRAY);

  // 열 너비
  s.setColumnWidth(1, 90);   // A 마커(숨김)
  s.setColumnWidth(2, 80);   // B 행레이블
  for(var ci=3;ci<=NC+2;ci++) s.setColumnWidth(ci, 55); // 학급열
  s.setColumnWidth(NC+3, 70); // 시수체크
  s.hideColumns(1);

  SpreadsheetApp.getActiveSpreadsheet().toast('시간표 탭이 4구역 신양식으로 생성되었습니다!', '✅', 5);
  return { success: true };
}

function saveTimetables(userId, myTT, classTTList, events) {
  const s = jm_timetableSheet();

  // ① 기본시간표: rows 6-11의 C~G열만 업데이트 (A=타입마커, B=교시레이블 보존)
  if (myTT) {
    for (let p = 1; p <= 6; p++) {
      const tt = myTT[p] || myTT[String(p)];
      if (!tt) continue;
      s.getRange(5 + p, 3, 1, 5).setNumberFormat('@')
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
        s.getRange(54 + i, 3, 1, 5).setNumberFormat('@');
      } else r.setBackground('#f0f0f0');
    }
  }

  // ③ 행사: rows 28-37 — 사이트 입력 행사를 시트에 반영
  if (events && Object.keys(events).length) {
    const evEntries = Object.entries(events)
      .filter(([k, v]) => v && /^\d{4}-\d{2}-\d{2}$/.test(k))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, 10);
    const evData = [];
    for (let i = 0; i < 10; i++) {
      evData.push(i < evEntries.length ? [evEntries[i][0], evEntries[i][1], ''] : ['', '', '']);
    }
    s.getRange(28, 2, 10, 3).setValues(evData);
    s.getRange(28, 2, 10, 3).setBackground('#FFFDE7');
    for (let r = 28; r <= 37; r++) s.setRowHeight(r, 22);
  }

  s.hideColumns(1);
  return { success: true };
}

// ---------- 시수계산 ----------
function calcTimetable(userId, semYear) {
  const s = jm_timetableSheet();
  const allData = s.getRange(1, 1, s.getLastRow(), 7).getValues();

  // 내시간표 읽기
  const myTTLocal = {};
  for (let i = 0; i < allData.length; i++) {
    if (String(allData[i][0]).trim() === '내시간표') {
      const m = String(allData[i][1]).trim().match(/^(\d+)/);
      if (m) myTTLocal[parseInt(m[1])] = [allData[i][2],allData[i][3],allData[i][4],allData[i][5],allData[i][6]].map(v => String(v||'').trim());
    }
  }

  // 방학 읽기
  const vacations = [];
  const toDateStr = v => v instanceof Date ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : String(v).trim();
  for (let i = 0; i < allData.length; i++) {
    if (String(allData[i][0]).trim() === '방학') {
      const s1 = toDateStr(allData[i][1]), e1 = toDateStr(allData[i][2]);
      if (/\d{4}-\d{2}-\d{2}/.test(s1) && /\d{4}-\d{2}-\d{2}/.test(e1))
        vacations.push({ start: s1, end: e1 });
    }
  }

  function isVac(ds) { return vacations.some(v => ds >= v.start && ds <= v.end); }
  function fmtDate(d) { return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'); }
  function semDates(yr, half) {
    return half === 1
      ? { start: new Date(yr, 2, 2), end: new Date(yr, 6, 18) }
      : { start: new Date(yr, 8, 1), end: new Date(yr + 1, 0, 8) };
  }
  function countWeeks(yr, half) {
    const sem = semDates(yr, half);
    let count = 0;
    const cur = new Date(sem.start);
    const dow = cur.getDay();
    if (dow !== 1) cur.setDate(cur.getDate() + (dow === 0 ? 1 : 8 - dow));
    while (fmtDate(cur) <= fmtDate(sem.end)) {
      let active = false;
      for (let i = 0; i < 5 && !active; i++) {
        const day = new Date(cur.getTime() + i * 86400000);
        const ds = fmtDate(day);
        if (ds >= fmtDate(sem.start) && ds <= fmtDate(sem.end) && !isVac(ds)) active = true;
      }
      if (active) count++;
      cur.setDate(cur.getDate() + 7);
    }
    return count;
  }

  const yr = semYear || (new Date().getMonth() >= 2 ? new Date().getFullYear() : new Date().getFullYear() - 1);
  const w1 = countWeeks(yr, 1), w2 = countWeeks(yr, 2);

  // 학급별 주당시수 집계
  const weekly = {};
  Object.values(myTTLocal).forEach(days => {
    days.forEach(cls => { if (cls) weekly[cls] = (weekly[cls] || 0) + 1; });
  });

  // 시수계산표 rows 41-50 업데이트
  s.getRange(41, 1, 10, 7).clearContent();
  const classes = Object.keys(weekly).sort();
  const resultRows = classes.slice(0, 10).map(cls => {
    const pw = weekly[cls];
    return ['시수결과', cls, pw, pw * w1, pw * w2, pw * (w1 + w2), yr + '학년도'];
  });
  if (resultRows.length) s.getRange(41, 1, resultRows.length, 7).setValues(resultRows);
  s.getRange(41, 2, 10, 6).setBackground('#F8F9FF').setHorizontalAlignment('center');
  s.getRange(41, 2).setFontColor('#333').setFontStyle('normal');

  return { success: true, weeks: { s1: w1, s2: w2 }, weekly };
}

// ---------- 진도표 ----------
function loadSyllabus(userId, subject) {
  const s = jm_syllabusSheet();
  const data = s.getDataRange().getValues();
  const items = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]||'').trim() !== subject) continue;
    // 신형: [완료체크(0), 과목(1), 순서(2), 기간(3), 차시(4), 단원(5), 학습주제(6), 준비물(7), 메모(8)]
    const unitUrl = s.getRange(i + 1, 6).getRichTextValue().getLinkUrl() || '';
    items.push({
      done: String(data[i][0]||'').trim() === '완료',
      period: String(data[i][3]||''),
      ch: String(data[i][4]||''),
      unit: String(data[i][5]||''),
      unitUrl,
      topic: String(data[i][6]||''),
      prep: String(data[i][7]||''),
      memo: String(data[i][8]||'')
    });
  }
  return {success:true, items};
}

function saveSyllabus(userId, subject, sylData) {
  const s = jm_syllabusSheet();
  const data = s.getDataRange().getValues();

  // 과목+순서로 기존 행 위치 맵 생성 (순서 C열=index 2)
  const rowMap = {}; // 순서번호 → sheet row번호(1-based)
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]||'').trim() !== subject) continue;
    const ord = String(data[i][2]||'').trim();
    if (ord) rowMap[ord] = i + 1;
  }

  sylData.forEach((item, idx) => {
    const ord = String(idx + 1);
    const values = [
      item.done ? '완료' : '할일',
      subject,
      idx + 1,
      item.period || '',
      item.ch || '',
      item.unit || '',
      item.topic || '',
      item.prep || '',
      item.memo || ''
    ];

    if (rowMap[ord]) {
      // 기존 행 A~I열만 덮어쓰기 (J열 이후 K~N 보존)
      s.getRange(rowMap[ord], 1, 1, 9).setValues([values]);
      // F열(단원) 하이퍼링크 복원
      if (item.unitUrl) {
        const rtv = SpreadsheetApp.newRichTextValue()
          .setText(item.unit || '')
          .setLinkUrl(item.unitUrl)
          .build();
        s.getRange(rowMap[ord], 6).setRichTextValue(rtv);
      }
    }
    // 시트에 없는 행이면 추가 (신규)
    else {
      s.appendRow(values);
    }
  });

  return {success:true};
}
