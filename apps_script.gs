/**
 * 통합 Google Apps Script 백엔드
 * - 모둠뽑기: doPost  { action:'save'|'load', classId, data }
 * - 관피타:   doGet   ?action=get&key=...  /  ?action=set&key=...&value=...
 *
 * [수정사항] writeKaoSheet에서 시트 전체를 지우던 것을 A~J열까지만 지우도록 변경
 *           → L열 이후 메모 영역은 더 이상 삭제되지 않음
 */

// 구글 시트 열릴 때 커스텀 메뉴 추가
// 시트 내 '전체시간표 생성' 체크박스(시간표 탭 I1) → 체크하면 자동 생성 후 해제
// (커스텀 메뉴 제거: onOpen 없앰)
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== '시간표') return;
    if (e.range.getRow() !== 1 || e.range.getColumn() !== 9) return; // I1 체크박스
    if (e.range.getValue() === true) {
      generateFullTimetable(null);
      e.range.setValue(false);
      SpreadsheetApp.getActiveSpreadsheet().toast('전체시간표 생성 완료 (J열~)', '✅', 5);
    }
  } catch(err) {}
}

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
      } else if (action === 'calcTimetable') {
        result = calcTimetable(userId, data.semYear);
      } else if (action === 'generateFullTimetable') {
        result = generateFullTimetable(data.semYear);
      } else if (action === 'saveSubjectHours') {
        result = saveSubjectHours(userId, data.hours);
      } else if (action === 'saveFullTTCell') {
        result = saveFullTTCell(data.row, data.col, data.value);
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
    return s;
  }
  const a1 = String(s.getRange(1, 1).getValue() || '').trim();
  const title = String(s.getRange(1, 2).getValue() || '');
  if (a1 !== '타이틀') {
    setupTimetableTemplate(s);
  } else if (title.indexOf('v5') < 0) {
    // 구버전(v4 등): 기본시간표 중복·옛 레이아웃 → 데이터 보존하며 깨끗한 v5로 1회 재생성
    const pre = jm_readTTForRebuild(s);
    // 기본시간표(레이아웃 민감 데이터)를 읽어낸 경우에만 재생성 → 못 읽으면 시트 손대지 않음(데이터 보호)
    const hasMyTT = Object.keys(pre.myTT).some(p => (pre.myTT[p]||[]).some(v => String(v).trim()));
    if (hasMyTT) {
      setupTimetableTemplate(s);   // 깨끗한 v5 양식(기본시간표 1개)
      jm_writeBackTT(s, pre);      // 기존 데이터 복원
      generateFullTimetable(null); // 전체시간표 재생성
    }
  }
  return s;
}

// 재생성용 직접 파서(재귀 방지: jm_timetableSheet 호출 안 함). 중복 대비 '채워진 행 우선'.
function jm_readTTForRebuild(s) {
  const lastRow = Math.max(s.getLastRow(), 1);
  const data = s.getRange(1, 1, lastRow, 7).getValues();
  const myTT = {}, classTTMap = {}, classOrder = [], vacationPeriods = [], timetableEvents = {}, subjectHours = {};
  let curClass = '';
  const toStr = v => v instanceof Date ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : String(v).trim();
  for (let i = 0; i < data.length; i++) {
    const type = String(data[i][0]||'').trim();
    if (type === '시수' || type === '필요시수') {
      const cls = String(data[i][1]||'').trim();
      if (cls) subjectHours[cls] = { s1req: parseInt(data[i][2])||0, s2req: parseInt(type==='시수'?data[i][4]:data[i][3])||0 };
    } else if (type === '내시간표') {
      const m = String(data[i][1]||'').trim().match(/^(\d+)/);
      if (m) {
        const p = parseInt(m[1]);
        const row = [String(data[i][2]||''),String(data[i][3]||''),String(data[i][4]||''),String(data[i][5]||''),String(data[i][6]||'')];
        if (row.some(v => v.trim()) || !myTT[p]) myTT[p] = row;
      }
    } else if (type === '방학') {
      const st = toStr(data[i][1]), en = toStr(data[i][2]);
      if (/\d{4}-\d{2}-\d{2}/.test(st) && /\d{4}-\d{2}-\d{2}/.test(en))
        vacationPeriods.push({ start: st, end: en, label: String(data[i][3]||'방학').trim() });
    } else if (type === '행사') {
      const d = toStr(data[i][1]), nm = String(data[i][2]||'').trim();
      if (/\d{4}-\d{2}-\d{2}/.test(d) && nm) timetableEvents[d] = nm;
    } else if (type === '담당학급헤더') {
      const raw = String(data[i][1]||'').trim();
      const mm = raw.match(/\[\s*(.+?)\s*\]/);
      curClass = mm ? mm[1].trim() : raw;
    } else if (type === '담당학급') {
      const label = String(data[i][1]||'').trim();
      let cls, p;
      const legacy = label.match(/^(.+)-(\d+)교시$/);
      if (legacy) { cls = legacy[1]; p = parseInt(legacy[2])-1; curClass = cls; }
      else { const pm = label.match(/^(\d+)교시$/); if (!pm) continue; cls = curClass; p = parseInt(pm[1])-1; }
      if (!cls) continue;
      if (!classTTMap[cls]) { classTTMap[cls] = Array.from({length:6},()=>['','','','','']); classOrder.push(cls); }
      if (p>=0 && p<6) {
        const row = [String(data[i][2]||''),String(data[i][3]||''),String(data[i][4]||''),String(data[i][5]||''),String(data[i][6]||'')];
        if (row.some(v=>v.trim()) || !classTTMap[cls][p].some(v=>v)) classTTMap[cls][p] = row;
      }
    }
  }
  const classTTList = classOrder
    .filter(n => !/^학급\d+$/.test(n) || classTTMap[n].some(per=>per.some(v=>v!=='')))
    .map(n => ({ name: n, tt: classTTMap[n] }));
  return { myTT, classTTList, vacationPeriods, timetableEvents, subjectHours };
}

// 재생성 후 데이터를 깨끗한 v5 양식 위치에 복원
function jm_writeBackTT(s, pre) {
  for (let p = 1; p <= 6; p++) {
    const tt = pre.myTT[p];
    if (!tt) continue;
    s.getRange(5+p, 3, 1, 5).setNumberFormat('@').setValues([[tt[0]||'',tt[1]||'',tt[2]||'',tt[3]||'',tt[4]||'']]);
  }
  const vac = pre.vacationPeriods || [];
  const vacRows = [];
  for (let i=0;i<10;i++) vacRows.push(i<vac.length ? [vac[i].start||'', vac[i].end||'', vac[i].label||''] : ['','','']);
  s.getRange(15, 2, 10, 3).setValues(vacRows);
  const ev = pre.timetableEvents || {};
  const evEntries = Object.keys(ev).sort().map(k => [k, ev[k], '']);
  const evRows = [];
  for (let i=0;i<10;i++) evRows.push(i<evEntries.length ? evEntries[i] : ['','','']);
  s.getRange(28, 2, 10, 3).setValues(evRows);
  // ④ 시수 기준값 복원 (rows 41-50): C=1학기기준, E=2학기기준
  const sh = pre.subjectHours || {};
  const shKeys = Object.keys(sh).slice(0, 10);
  for (let i = 0; i < shKeys.length; i++) {
    const k = shKeys[i];
    s.getRange(41+i, 1, 1, 5).setValues([['시수', k, sh[k].s1req||0, '', sh[k].s2req||0]]);
  }
  const list = pre.classTTList || [];
  if (list.length) {
    const rows = [];
    for (const cls of list) {
      rows.push(['담당학급헤더', '[ '+cls.name+' ]', '월','화','수','목','금']);
      for (let p=0;p<6;p++){ const tt=cls.tt[p]||['','','','','']; rows.push(['담당학급', (p+1)+'교시', tt[0]||'',tt[1]||'',tt[2]||'',tt[3]||'',tt[4]||'']); }
      rows.push(['','','','','','','']);
    }
    s.getRange(54, 1, rows.length, 7).setValues(rows);
  }
}

function setupTimetableTemplate(s) {
  s.clear();

  // A열=타입마커(숨김), B~G=사용자 표시 영역
  const rows = [
    // 메타 (rows 1-3)
    ['타이틀', '📅 일해용! 전담 — 시간표 시스템 v5', '', '', '', '', ''],
    ['안내', '💡 노란색 칸에 직접 입력 | 수정 후 사이트에서 [☁ 구글시트 연동] 클릭', '', '', '', '', ''],
    ['빈칸', '', '', '', '', '', ''],
    // ① 기본시간표 (rows 4-12)
    ['섹션', '① 기본시간표 (1주 패턴) — 요일별 교시 칸에 담당학급 입력 (예: 3-1)', '', '', '', '', ''],
    ['컬럼헤더', '교시', '월', '화', '수', '목', '금'],
    ['내시간표', '1교시', '', '', '', '', ''],
    ['내시간표', '2교시', '', '', '', '', ''],
    ['내시간표', '3교시', '', '', '', '', ''],
    ['내시간표', '4교시', '', '', '', '', ''],
    ['내시간표', '5교시', '', '', '', '', ''],
    ['내시간표', '6교시', '', '', '', '', ''],
    ['빈칸', '', '', '', '', '', ''],
    // ② 방학 기간 (rows 13-25)
    ['섹션', '② 방학 기간 — 수업 없는 기간 입력 (날짜 형식: 2026-07-21)', '', '', '', '', ''],
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
    // ④ 시수계산표 (rows 39-51) — 노란칸(기준) 입력, 실제는 사이트/자동 계산. 사이트와 양방향 동기화
    ['섹션', '④ 시수계산표 — 노란칸(기준시수) 입력 · 실제는 전체시간표 기준 자동(불일치 시 빨강)', '', '', '', '', ''],
    ['컬럼헤더', '학급', '1학기 기준', '1학기 실제', '2학기 기준', '2학기 실제', '연간'],
    ['시수', '', '', '', '', '', ''],
    ['시수', '', '', '', '', '', ''],
    ['시수', '', '', '', '', '', ''],
    ['시수', '', '', '', '', '', ''],
    ['시수', '', '', '', '', '', ''],
    ['시수', '', '', '', '', '', ''],
    ['시수', '', '', '', '', '', ''],
    ['시수', '', '', '', '', '', ''],
    ['시수', '', '', '', '', '', ''],
    ['시수', '', '', '', '', '', ''],
    ['빈칸', '', '', '', '', '', ''],
    // ⑤ 담당학급 시간표 (rows 52-53 고정 헤더, 54+는 15개 슬롯)
    ['섹션', '⑤ 담당학급 시간표 — 학급명을 [ ] 안에 입력 · 시간표는 노란 칸에 입력', '', '', '', '', ''],
    ['컬럼헤더', '교시', '월', '화', '수', '목', '금'],
  ];

  // 15개 담당학급 슬롯 추가 (rows 54+)
  for (let i = 1; i <= 15; i++) {
    rows.push(['담당학급헤더', '[ 학급' + i + ' ]', '월', '화', '수', '목', '금']);
    for (let p = 1; p <= 6; p++) {
      rows.push(['담당학급', p + '교시', '', '', '', '', '']);
    }
    rows.push(['빈칸', '', '', '', '', '', '']);
  }

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

  // ① 기본시간표 데이터: rows 6-11
  for (let r = 6; r <= 11; r++) {
    s.getRange(r, 2).setBackground('#f5f5f5').setFontWeight('bold').setFontColor('#555')
      .setHorizontalAlignment('center');
    s.getRange(r, 3, 1, 5).setBackground(COLORS.yellow).setHorizontalAlignment('center')
      .setNumberFormat('@');
    s.setRowHeight(r, 26);
  }

  // ② 방학: rows 15-24
  s.getRange(15, 2, 10, 3).setBackground(COLORS.yellow);
  for (let r = 15; r <= 24; r++) s.setRowHeight(r, 22);

  // ③ 행사: rows 28-37
  s.getRange(28, 2, 10, 3).setBackground(COLORS.yellow);
  for (let r = 28; r <= 37; r++) s.setRowHeight(r, 22);

  // ④ 시수계산표: rows 41-50. 학급(B)·실제(D,F)·연간(G)=연한 배경, 기준(C,E)=노랑 입력
  s.getRange(41, 2, 10, 6).setBackground('#F8F9FF').setFontColor('#555').setHorizontalAlignment('center');
  s.getRange(41, 3, 10, 1).setBackground('#FFFDE7'); // C: 1학기 기준(입력)
  s.getRange(41, 5, 10, 1).setBackground('#FFFDE7'); // E: 2학기 기준(입력)
  for (let r = 41; r <= 50; r++) s.setRowHeight(r, 22);

  // ⑤ 담당학급 섹션 헤더 (초록색)
  s.getRange(52, 2, 1, 6).merge()
    .setBackground(COLORS.green).setFontColor('#2E7D32')
    .setFontWeight('bold').setFontSize(11);
  s.getRange(53, 2, 1, 6)
    .setBackground('#F1F8E9').setFontColor('#2E7D32')
    .setFontWeight('bold').setHorizontalAlignment('center');

  // ⑤ 담당학급 15개 슬롯 스타일: rows 54+
  for (let i = 0; i < 15; i++) {
    const base = 54 + i * 8;
    // 헤더행
    s.getRange(base, 2).setBackground(COLORS.green).setFontColor('#2E7D32').setFontWeight('bold');
    s.getRange(base, 3, 1, 5).setBackground(COLORS.green).setFontColor('#2E7D32')
      .setFontWeight('bold').setHorizontalAlignment('center');
    s.setRowHeight(base, 24);
    // 교시행 × 6
    for (let p = 0; p < 6; p++) {
      const r = base + 1 + p;
      s.getRange(r, 2).setBackground('#f5f5f5').setFontWeight('bold').setFontColor('#666')
        .setHorizontalAlignment('center');
      s.getRange(r, 3, 1, 5).setBackground(COLORS.yellow).setHorizontalAlignment('center')
        .setNumberFormat('@');
      s.setRowHeight(r, 24);
    }
    // 구분 빈칸행
    s.getRange(base + 7, 1, 1, 7).setBackground('#e8e8e8');
    s.setRowHeight(base + 7, 6);
  }

  // 열 너비 설정
  s.setColumnWidth(1, 20);   // A: 숨김 타입마커
  s.setColumnWidth(2, 120);  // B
  s.setColumnWidth(3, 110);  // C
  s.setColumnWidth(4, 110);  // D
  s.setColumnWidth(5, 110);  // E
  s.setColumnWidth(6, 110);  // F
  s.setColumnWidth(7, 110);  // G

  s.hideColumns(1);
  s.setFrozenRows(0); // 행 고정 전부 해제

  // 전체시간표 생성 버튼 (체크박스): H1 라벨 + I1 체크박스
  s.getRange(1, 8).setValue('전체시간표 생성 ▶')
    .setFontWeight('bold').setFontColor('#534AB7').setHorizontalAlignment('right').setVerticalAlignment('middle');
  s.getRange(1, 9).insertCheckboxes().setValue(false);
  s.getRange(2, 8).setValue('☑ 체크하면 오른쪽 J열에 생성').setFontColor('#888').setFontSize(9);
  s.setColumnWidth(8, 150);
  s.setColumnWidth(9, 40);
}

// 진도표 14열 구조: 수업완료(A)|과목(B)|순서(C)|기간(D)|차시(E)|단원(F)|학습주제(G)|준비물(H)|메모(I)|(빈J)|카테고리(K)|소카테고리(L)|주제(M)|URL(N)
function jm_syllabusSheet() {
  const ss = jm_getSpreadsheet();
  let s = ss.getSheetByName('진도표');
  if (!s) {
    s = ss.insertSheet('진도표');
    s.getRange(1,1,1,14).setValues([['수업완료','과목','순서','기간','차시','단원','학습주제','준비물','메모','','카테고리','소카테고리','주제','URL']]);
    s.getRange(1,1,1,9).setFontWeight('bold').setBackground('#FBBC04').setFontColor('white');
    s.getRange(1,11,1,4).setFontWeight('bold').setBackground('#34A853').setFontColor('white');
    s.setFrozenRows(1);
    s.getRange('B:B').setNumberFormat('@');
    s.getRange('C:C').setNumberFormat('@');
    s.getRange('D:D').setNumberFormat('@');
    s.getRange('E:E').setNumberFormat('@');
    return s;
  }
  // 개념링크 헤더(K~N) 없으면 추가 — 기존 데이터 행은 절대 건드리지 않음(파괴적 마이그레이션 제거)
  if (!String(s.getRange(1, 11).getValue()).trim()) {
    s.getRange(1, 11, 1, 4).setValues([['카테고리', '소카테고리', '주제', 'URL']]);
    s.getRange(1, 11, 1, 4).setFontWeight('bold').setBackground('#34A853').setFontColor('white');
    s.setColumnWidth(11, 90); s.setColumnWidth(12, 90); s.setColumnWidth(13, 160); s.setColumnWidth(14, 320);
  }
  return s;
}

// done 값 판별: 체크박스(boolean) / 'TRUE' / '완료' 모두 인식
function jm_sylDone(dv) {
  return dv === true || String(dv).toUpperCase() === 'TRUE' || String(dv).trim() === '완료';
}

// 형식 감지. new14: 수업완료(A)|과목(B)|순서(C)|기간(D)...
function jm_getSylFormatType(header) {
  if (String(header[0]||'').trim().includes('완료') && String(header[1]||'').trim().includes('과목')) return 'new14';
  if (String(header[1]||'').includes('기간') && String(header[2]||'').includes('차시')) return 'new8';
  if (String(header[6]||'').includes('상태')) return 'old';
  return 'trans';
}

function jm_isOldSylFormat(header) {
  return jm_getSylFormatType(header) !== 'new14';
}

// 셀의 링크를 [{text, url}] 배열로 반환 (멀티링크 지원)
function jm_getCellRuns(value, formula, richText) {
  if (formula) {
    const m = String(formula).match(/HYPERLINK\s*\(\s*"([^"]+)"\s*,\s*"([^"]*)"/i);
    if (m) return [{text: m[2] || String(value||''), url: m[1]}];
    const m2 = String(formula).match(/HYPERLINK\s*\(\s*"([^"]+)"/i);
    if (m2) return [{text: String(value||''), url: m2[1]}];
  }
  if (!richText) return null;
  try {
    const runs = richText.getRuns();
    if (runs && runs.length > 0) {
      const result = [];
      let hasUrl = false;
      for (let i = 0; i < runs.length; i++) {
        const text = (runs[i].getText ? runs[i].getText() : '').replace(/[\n\r]/g,'').trim();
        if (!text) continue;
        const url = runs[i].getLinkUrl() || '';
        if (url) hasUrl = true;
        result.push({text, url});
      }
      if (result.length > 0 && hasUrl) return result;
    }
  } catch(e) {}
  try {
    const url = richText.getLinkUrl();
    if (url) return [{text: String(value||'').replace(/[\n\r]/g,' ').trim(), url}];
  } catch(e) {}
  return null;
}

// Google Sheets Date 자동변환 대응: Date면 "월-일" 복원
function jm_parseSheetVal(v) {
  if (!v && v !== 0) return '';
  // "1/12" 등 슬래시 입력이 구글시트에서 날짜로 자동변환된 경우 → "M/D" 슬래시로 복구(표시만, 시트 데이터 미변경)
  if (v instanceof Date) return (v.getMonth()+1) + '/' + v.getDate();
  return String(v);
}

function jm_parseSylRow(row, isOld, headerArr) {
  const fmt = headerArr ? jm_getSylFormatType(headerArr) : (isOld ? 'old' : 'new14');
  if (fmt === 'new14') {
    return { done: jm_sylDone(row[0]), period: jm_parseSheetVal(row[3]), ch: jm_parseSheetVal(row[4]), unit: jm_parseSheetVal(row[5]), topic: jm_parseSheetVal(row[6]), prep: jm_parseSheetVal(row[7]), memo: jm_parseSheetVal(row[8]) };
  } else if (fmt === 'new8') {
    return { period: jm_parseSheetVal(row[1]), ch: jm_parseSheetVal(row[2]), unit: jm_parseSheetVal(row[3]), topic: jm_parseSheetVal(row[4]), prep: jm_parseSheetVal(row[5]), memo: jm_parseSheetVal(row[6]), done: jm_sylDone(row[7]) };
  } else if (fmt === 'old') {
    return { period: jm_parseSheetVal(row[1]), ch: jm_parseSheetVal(row[3]), unit: jm_parseSheetVal(row[2]), topic: jm_parseSheetVal(row[4]), prep: jm_parseSheetVal(row[5]), memo: '', done: String(row[6]||'')==='done' };
  } else {
    return { period: '', ch: jm_parseSheetVal(row[1]), unit: jm_parseSheetVal(row[2]), topic: jm_parseSheetVal(row[3]), prep: jm_parseSheetVal(row[4]), memo: jm_parseSheetVal(row[5]), done: jm_sylDone(row[6]) };
  }
}

// 구형식(old/trans/new8) → new14 전면 변환
function jm_migrateSylToNewFormat(s) {
  const lr = s.getLastRow();
  const header = s.getRange(1, 1, 1, Math.max(s.getLastColumn(), 7)).getValues()[0];
  const fmt = jm_getSylFormatType(header);
  if (fmt === 'new14') return;
  const NH = ['수업완료','과목','순서','기간','차시','단원','학습주제','준비물','메모','','카테고리','소카테고리','주제','URL'];
  if (lr < 2) {
    s.getRange(1,1,1,14).setValues([NH]);
    s.getRange(1,1,1,9).setFontWeight('bold').setBackground('#FBBC04').setFontColor('white');
    s.getRange(1,11,1,4).setFontWeight('bold').setBackground('#34A853').setFontColor('white');
    return;
  }
  const numCols = s.getLastColumn();
  const data = s.getRange(2, 1, lr-1, numCols).getValues();
  const newData = [];
  const subjectCounters = {};
  for (let i = 0; i < data.length; i++) {
    const subject = String(data[i][0]||'').trim();
    if (!subject) continue;
    if (!subjectCounters[subject]) subjectCounters[subject] = 0;
    subjectCounters[subject]++;
    let done, period, ch, unit, topic, prep, memo;
    if (fmt === 'old') {
      done = String(data[i][6]||'')==='done'; period = jm_parseSheetVal(data[i][1]); ch = jm_parseSheetVal(data[i][3]); unit = jm_parseSheetVal(data[i][2]); topic = jm_parseSheetVal(data[i][4]); prep = jm_parseSheetVal(data[i][5]); memo = '';
    } else if (fmt === 'trans') {
      done = jm_sylDone(data[i][6]); period = ''; ch = jm_parseSheetVal(data[i][1]); unit = jm_parseSheetVal(data[i][2]); topic = jm_parseSheetVal(data[i][3]); prep = jm_parseSheetVal(data[i][4]); memo = jm_parseSheetVal(data[i][5]);
    } else { // new8
      done = jm_sylDone(data[i][7]); period = jm_parseSheetVal(data[i][1]); ch = jm_parseSheetVal(data[i][2]); unit = jm_parseSheetVal(data[i][3]); topic = jm_parseSheetVal(data[i][4]); prep = jm_parseSheetVal(data[i][5]); memo = jm_parseSheetVal(data[i][6]);
    }
    newData.push([done, subject, subjectCounters[subject], period, ch, unit, topic, prep, memo, '', '', '', '', '']);
  }
  s.getRange(2, 1, lr-1, Math.max(numCols, 14)).clearContent();
  if (newData.length) s.getRange(2, 1, newData.length, 14).setValues(newData);
  s.getRange(1,1,1,14).setValues([NH]);
  s.getRange(1,1,1,9).setFontWeight('bold').setBackground('#FBBC04').setFontColor('white');
  s.getRange(1,11,1,4).setFontWeight('bold').setBackground('#34A853').setFontColor('white');
}

// ---------- 전체 데이터 한번에 ----------
function loadAll(userId) {
  const ttResult = loadAllTimetables(userId);
  const sylSheet = jm_syllabusSheet();
  const sylRange = sylSheet.getDataRange();
  const sylRows = sylRange.getValues();
  const sylFormulas = sylRange.getFormulas();
  let sylRich = null;
  try { sylRich = sylRange.getRichTextValues(); } catch(e) {}

  const syllabusData = {};
  const sylHeader = sylRows[0] || [];
  const sylFmt = jm_getSylFormatType(sylHeader);

  if (sylFmt === 'new14') {
    // 과목(B)·기간(D) 빈칸은 위 행 값 상속
    let currentSubject = '';
    let currentPeriod = '';
    const urlColMap = [[3,'period'],[4,'ch'],[5,'unit'],[6,'topic'],[7,'prep'],[8,'memo']];
    for (let i = 1; i < sylRows.length; i++) {
      const rowSubject = String(sylRows[i][1]||'').trim();
      if (rowSubject && rowSubject !== currentSubject) currentPeriod = '';
      if (rowSubject) currentSubject = rowSubject;
      const subject = currentSubject;
      const rowPeriod = String(jm_parseSheetVal(sylRows[i][3])||'').trim();
      if (rowPeriod) currentPeriod = rowPeriod;

      const isDoneRow = jm_sylDone(sylRows[i][0]);
      const hasSylContent = isDoneRow ||
        String(sylRows[i][3]||'').trim() || String(sylRows[i][4]||'').trim() ||
        String(sylRows[i][5]||'').trim() || String(sylRows[i][6]||'').trim() ||
        String(sylRows[i][7]||'').trim() || String(sylRows[i][8]||'').trim();
      if (hasSylContent && subject) {
        if (!syllabusData[subject]) syllabusData[subject] = [];
        const item = jm_parseSylRow(sylRows[i], false, sylHeader);
        if (!item.period && currentPeriod) item.period = currentPeriod;
        const links = {};
        for (let m = 0; m < urlColMap.length; m++) {
          const c = urlColMap[m][0], field = urlColMap[m][1];
          const runs = jm_getCellRuns(sylRows[i][c], sylFormulas[i] ? sylFormulas[i][c] : '', sylRich && sylRich[i] ? sylRich[i][c] : null);
          if (runs) links[field] = runs;
        }
        if (Object.keys(links).length) item._links = links;
        syllabusData[subject].push(item);
      }
    }
  } else {
    // 레거시(old/trans/new8)
    const sylIsOld = sylFmt !== 'new8';
    const urlMap = sylFmt === 'old'
      ? [[1,'period'],[2,'unit'],[3,'ch'],[4,'topic'],[5,'prep']]
      : sylFmt === 'trans'
        ? [[1,'ch'],[2,'unit'],[3,'topic'],[4,'prep'],[5,'memo']]
        : [[1,'period'],[2,'ch'],[3,'unit'],[4,'topic'],[5,'prep'],[6,'memo']];
    for (let i = 1; i < sylRows.length; i++) {
      const subject = String(sylRows[i][0]||'').trim();
      if (!subject) continue;
      if (!syllabusData[subject]) syllabusData[subject] = [];
      const item = jm_parseSylRow(sylRows[i], sylIsOld, sylHeader);
      const links = {};
      for (let m = 0; m < urlMap.length; m++) {
        const c = urlMap[m][0], field = urlMap[m][1];
        const runs = jm_getCellRuns(sylRows[i][c], sylFormulas[i] ? sylFormulas[i][c] : '', sylRich && sylRich[i] ? sylRich[i][c] : null);
        if (runs) links[field] = runs;
      }
      if (Object.keys(links).length) item._links = links;
      syllabusData[subject].push(item);
    }
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
    fullTT: loadFullTimetableGrid(),
    syllabusData,
    journals: journalResult.journals,
    conceptLinks: conceptResult.data
  };
}

// ---------- 전체시간표 그리드 읽기/쓰기 (방식A 양방향 동기화) ----------
// 시간표 시트 J열(10)~ 영역을 그대로 2차원 배열로 반환
function loadFullTimetableGrid() {
  const s = jm_timetableSheet();
  const C0 = 10; // J열
  const lastRow = s.getLastRow();
  const lastCol = s.getLastColumn();
  if (lastRow < 1 || lastCol < C0) return { grid: [], r0: 1, c0: C0 };
  const vals = s.getRange(1, C0, lastRow, lastCol - C0 + 1).getValues();
  const grid = vals.map(row => row.map(v =>
    v instanceof Date ? Utilities.formatDate(v, 'Asia/Seoul', 'M/d') : String(v)));
  return { grid, r0: 1, c0: C0 };
}

// 사이트에서 전체시간표 한 칸 수정 → 시트 J열 영역에 기록 (J열 미만은 거부: 다른 데이터 보호)
function saveFullTTCell(row, col, value) {
  if (!(col >= 10)) return { success: false, message: '전체시간표 영역(J열~)만 수정할 수 있습니다.' };
  const s = jm_timetableSheet();
  s.getRange(row, col).setValue(value);
  return { success: true };
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
  let currentClassKey = '';

  for (let i = 0; i < allData.length; i++) {
    const type = String(allData[i][0] || '').trim();
    if (!type || type === '타이틀' || type === '안내' || type === '빈칸' ||
        type === '섹션' || type === '컬럼헤더' || type === '시수결과') continue;

    if (type === '시수') {
      // ④ 시수: B=학급, C=1학기기준, E=2학기기준 (D/F=실제는 표시용)
      const cls = String(allData[i][1]||'').trim();
      if (cls) subjectHoursData[cls] = { s1req: parseInt(allData[i][2])||0, s2req: parseInt(allData[i][4])||0 };
      continue;
    }

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

    } else if (type === '담당학급헤더') {
      const raw = String(allData[i][1]||'').trim();
      const m = raw.match(/\[\s*(.+?)\s*\]/);
      currentClassKey = m ? m[1].trim() : raw;

    } else if (type === '담당학급') {
      const label = String(allData[i][1]||'').trim();
      let cls, p;
      // 구형 포맷: "3-1-1교시" (클래스명 포함)
      const legacyMatch = label.match(/^(.+)-(\d+)교시$/);
      if (legacyMatch) {
        cls = legacyMatch[1];
        p = parseInt(legacyMatch[2]) - 1;
        currentClassKey = cls;
      } else {
        // 신형 포맷: "1교시" (클래스명은 헤더에서)
        const periodMatch = label.match(/^(\d+)교시$/);
        if (!periodMatch) continue;
        cls = currentClassKey;
        p = parseInt(periodMatch[1]) - 1;
      }
      if (!cls) continue;
      if (!classTTMap[cls]) classTTMap[cls] = Array.from({length:6}, () => ['','','','','']);
      if (p >= 0 && p < 6) {
        classTTMap[cls][p] = [
          String(allData[i][2]||''), String(allData[i][3]||''),
          String(allData[i][4]||''), String(allData[i][5]||''), String(allData[i][6]||'')
        ];
      }
    }
  }

  // 입력 순서 보존(정렬 없음). 이름이 있으면 시간표가 비어도 표시.
  // 단, 사용자가 안 건드린 기본 슬롯 이름(학급1~학급15)은 제외.
  const classTTList = Object.keys(classTTMap)
    .filter(name => !/^학급\d+$/.test(name) || classTTMap[name].some(period => period.some(v => v !== '')))
    .map(name => ({ name, tt: classTTMap[name] }));
  return { success:true, myTT, classTTList, timetableEvents, vacationPeriods, subjectHoursData };
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

// ---------- 시수계산표 저장 (사이트 → 시트 ④, 양방향 동기화) ----------
// hours: [{cls, s1req, s1act, s2req, s2act}, ...]
function saveSubjectHours(userId, hours) {
  const s = jm_timetableSheet();
  // ④ 헤더 보정(구버전 헤더 대비) + 데이터 영역(41-50) 초기화
  s.getRange(40, 1, 1, 7).setValues([['컬럼헤더','학급','1학기 기준','1학기 실제','2학기 기준','2학기 실제','연간']]);
  s.getRange(41, 1, 10, 7).clearContent();
  s.getRange(41, 2, 10, 6).setBackground('#F8F9FF').setFontColor('#555').setFontWeight('normal').setHorizontalAlignment('center');
  s.getRange(41, 3, 10, 1).setBackground('#FFFDE7'); // C 1학기 기준
  s.getRange(41, 5, 10, 1).setBackground('#FFFDE7'); // E 2학기 기준
  const list = (hours || []).slice(0, 10);
  const rows = [];
  for (let i = 0; i < 10; i++) {
    if (i < list.length) {
      const h = list[i];
      rows.push(['시수', h.cls||'', h.s1req||0, h.s1act||0, h.s2req||0, h.s2act||0, (h.s1act||0)+(h.s2act||0)]);
    } else rows.push(['시수','','','','','','']);
  }
  s.getRange(41, 1, 10, 7).setValues(rows);
  // 실제(D,F)가 기준(C,E)과 다르면 빨강
  for (let i = 0; i < list.length; i++) {
    const h = list[i], r = 41 + i;
    if ((h.s1req||0) !== (h.s1act||0)) s.getRange(r, 4).setFontColor('#CC0000').setFontWeight('bold');
    if ((h.s2req||0) !== (h.s2act||0)) s.getRange(r, 6).setFontColor('#CC0000').setFontWeight('bold');
  }
  s.hideColumns(1);
  return { success: true };
}

// ---------- 전체시간표 생성 (J열~) ----------
function generateFullTimetable(semYear) {
  const s = jm_timetableSheet();
  const allData = s.getDataRange().getValues();

  function nd(v) {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
    const str = String(v).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : '';
  }
  function fd(d) { return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'); }

  // 기본시간표: rows 6-11 (idx 5-10), cols C-G (idx 2-6)
  // myTT[교시0based][요일0based] : 0=월..4=금
  const myTT = [];
  for (let r = 5; r <= 10; r++) myTT.push([2,3,4,5,6].map(c => String(allData[r][c]||'').trim()));

  // 방학: rows 15-24 (idx 14-23)  B=시작, C=종료, D=방학명
  const vacs = [];
  for (let r = 14; r <= 23; r++) {
    const st = nd(allData[r][1]), en = nd(allData[r][2]), nm = String(allData[r][3]||'').trim();
    if (st && en) vacs.push({ st, en, nm });
  }

  // 행사: rows 28-37 (idx 27-36)  B=날짜, C=행사명
  const evts = {};
  for (let r = 27; r <= 36; r++) {
    const dt = nd(allData[r][1]), nm = String(allData[r][2]||'').trim();
    if (dt && nm) evts[dt] = nm;
  }

  function isVac(d) { return vacs.some(v => d >= v.st && d <= v.en); }
  function vacNm(d) { const v = vacs.find(v => d >= v.st && d <= v.en); return v ? v.nm : ''; }

  const yr = semYear || (function(){ const n = new Date(); return n.getMonth() >= 2 ? n.getFullYear() : n.getFullYear()-1; })();
  const sems = [
    { label: yr+'학년도 1학기', st: new Date(yr,2,1),   en: new Date(yr,7,31) },
    { label: yr+'학년도 2학기', st: new Date(yr,8,1),   en: new Date(yr+1,1,28) }
  ];

  const SC = 10, NC = 33; // J열(10) ~ AP열(42)
  const DAYS = ['월','화','수','목','금'];

  // 기존 전체시간표 영역 초기화
  const lr = Math.max(s.getLastRow(), 3);
  s.getRange(1, SC, lr, NC).clearContent().clearFormat().breakApart();

  // 헤더 1행: 주 | 기간 | 월(병합6) | 화(병합6) | 수(병합6) | 목(병합6) | 금(병합6) | 비고
  const h1 = ['주', '기간'];
  DAYS.forEach(d => { h1.push(d); for (let i=0;i<5;i++) h1.push(''); });
  h1.push('비고');
  s.getRange(1, SC, 1, NC).setValues([h1]);
  for (let d=0; d<5; d++) s.getRange(1, SC+2+d*6, 1, 6).merge();

  // 헤더 2행: '' | '' | 1~6 반복 5번 | ''
  const h2 = ['', ''];
  for (let d=0;d<5;d++) for (let p=1;p<=6;p++) h2.push(p);
  h2.push('');
  s.getRange(2, SC, 1, NC).setValues([h2]);

  // 헤더 스타일
  const HP = '#534AB7', HL = '#EEEDFE';
  s.getRange(1,SC,1,NC).setBackground(HP).setFontColor('#fff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  s.setRowHeight(1, 28);
  s.getRange(2,SC,1,NC).setBackground(HL).setFontColor(HP).setFontWeight('bold')
    .setHorizontalAlignment('center');
  s.setRowHeight(2, 22);

  // 열 너비
  s.setColumnWidth(SC, 32);
  s.setColumnWidth(SC+1, 75);
  for (let i=0;i<30;i++) s.setColumnWidth(SC+2+i, 52);
  s.setColumnWidth(SC+32, 200);

  let curRow = 3;

  for (const sem of sems) {
    // 학기 구분 행
    s.getRange(curRow, SC, 1, NC).merge()
      .setValue(sem.label)
      .setBackground('#E8F0FE').setFontColor('#1A56BD').setFontWeight('bold')
      .setHorizontalAlignment('left');
    s.setRowHeight(curRow, 24);
    curRow++;

    // 학기 시작일의 그 주 월요일 구하기
    let cur = new Date(sem.st.getTime());
    const dow = cur.getDay();
    if (dow === 0) cur.setDate(cur.getDate() + 1);
    else if (dow !== 1) cur.setDate(cur.getDate() - (dow - 1));

    let wk = 0;
    const batchData = [];
    const batchStart = curRow;

    while (cur <= sem.en) {
      wk++;
      const wd = [0,1,2,3,4].map(i => { const d = new Date(cur.getTime()); d.setDate(cur.getDate()+i); return d; });

      // 기간 표시: 학기 범위로 클립
      const first = wd.find(d => d >= sem.st) || wd[0];
      const last  = [...wd].reverse().find(d => d <= sem.en) || wd[4];
      const rng = (first.getMonth()+1)+'.'+first.getDate()+'~'+(last.getMonth()+1)+'.'+last.getDate();

      const row = [wk, rng];
      const rem = [];
      const usedVac = new Set();

      for (let d=0; d<5; d++) {
        const day = wd[d];
        if (day < sem.st || day > sem.en) { for(let p=0;p<6;p++) row.push(''); continue; }
        const ds = fd(day);
        if (isVac(ds)) {
          for(let p=0;p<6;p++) row.push('');
          const vn = vacNm(ds);
          if (vn && !usedVac.has(vn)) { usedVac.add(vn); rem.push(vn); }
        } else if (evts[ds]) {
          for(let p=0;p<6;p++) row.push('');
          rem.push((day.getMonth()+1)+'.'+day.getDate()+'('+DAYS[d]+') '+evts[ds]);
        } else {
          for(let p=0;p<6;p++) row.push(myTT[p][d] || '');
        }
      }
      row.push(rem.join('\n'));
      batchData.push(row);
      curRow++;
      cur.setDate(cur.getDate() + 7);
    }

    if (batchData.length) {
      s.getRange(batchStart, SC, batchData.length, NC).setValues(batchData);
      s.getRange(batchStart, SC, batchData.length, NC).setVerticalAlignment('middle').setHorizontalAlignment('center');
      s.getRange(batchStart, SC, batchData.length, 1).setFontWeight('bold');
      s.getRange(batchStart, SC+32, batchData.length, 1).setHorizontalAlignment('left').setWrap(true);
      for (let r=batchStart; r<batchStart+batchData.length; r++) s.setRowHeight(r, 24);
    }
    curRow++;
  }

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
  const sylHeader = data[0] || [];
  const fmt = jm_getSylFormatType(sylHeader);
  const isOld = fmt === 'old' || fmt === 'trans';
  const items = [];
  if (fmt === 'new14') {
    let currentSubject = '';
    let currentPeriod = '';
    for (let i = 1; i < data.length; i++) {
      const rowSubject = String(data[i][1]||'').trim();
      if (rowSubject && rowSubject !== currentSubject) currentPeriod = '';
      if (rowSubject) currentSubject = rowSubject;
      const rowPeriod = String(jm_parseSheetVal(data[i][3])||'').trim();
      if (rowPeriod) currentPeriod = rowPeriod;
      if (currentSubject !== subject) continue;
      const isDoneRow = jm_sylDone(data[i][0]);
      const hasSylContent = isDoneRow ||
        String(data[i][3]||'').trim() || String(data[i][4]||'').trim() ||
        String(data[i][5]||'').trim() || String(data[i][6]||'').trim() ||
        String(data[i][7]||'').trim() || String(data[i][8]||'').trim();
      if (hasSylContent) {
        const item = jm_parseSylRow(data[i], false, sylHeader);
        if (!item.period && currentPeriod) item.period = currentPeriod;
        items.push(item);
      }
    }
  } else {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]||'').trim() !== subject) continue;
      items.push(jm_parseSylRow(data[i], isOld, sylHeader));
    }
  }
  return {success:true, items};
}

// 명시적 저장 전용(자동저장은 프론트에서 끔). 상속 인식 삭제 + 개념행(K) 보존.
function saveSyllabus(userId, subject, sylData) {
  const s = jm_syllabusSheet();
  const numCols = Math.max(s.getLastColumn(), 7);
  const header = s.getRange(1, 1, 1, numCols).getValues()[0];
  if (jm_isOldSylFormat(header)) jm_migrateSylToNewFormat(s);
  const data = s.getDataRange().getValues();
  // 빈 과목칸은 위 행 과목 상속 → 행별 실효 과목 계산
  const effSubjects = [''];
  let eff = '';
  for (let i = 1; i < data.length; i++) {
    const rs = String(data[i][1]||'').trim();
    if (rs) eff = rs;
    effSubjects[i] = eff;
  }
  for (let i = data.length - 1; i >= 1; i--) {
    if (effSubjects[i] !== subject) continue;
    if (String(data[i][10]||'').trim()) continue; // 개념(K) 행은 보존
    s.deleteRow(i + 1);
  }
  sylData.forEach((item, idx) => {
    s.appendRow([
      item.done ? true : false, subject, idx + 1,
      item.period||'', item.ch||'', item.unit||'', item.topic||'', item.prep||'', item.memo||'',
      '', '', '', '', ''
    ]);
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
