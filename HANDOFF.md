# 일해용전담 앱 — 인수인계 문서

새 PC에서 이 파일을 기점으로 작업을 이어받으세요.

---

## 1. 프로젝트 개요

Google Apps Script(GAS) + HTML/JS/CSS 구성의 **학교 교사용 수업 관리 앱**.  
- 탭: **시간표 / 진도표 / 수업일지 / 출석부**  
- GAS가 백엔드(구글 시트 읽기·쓰기), `index.html` + `app.js` + `style.css`가 프론트엔드.  
- 배포는 GAS 웹앱으로 하고, `gas_updater.js`로 로컬에서 자동 push.

---

## 2. 주요 파일

| 파일 | 역할 |
|---|---|
| `apps_script.gs` | GAS 서버 코드 (구글 시트 I/O) |
| `app.js` | 프론트엔드 로직 |
| `index.html` | UI 구조 |
| `style.css` | 스타일 |
| `gas_updater.js` | 로컬→GAS 자동 배포 스크립트 (OAuth2) |
| `.gas_token.json` | OAuth 토큰 (gitignore, 새 PC에서 재발급 필요) |

---

## 3. 현재 라이브 버전

**v46** (최신 배포)

GAS 웹앱 URL:
```
https://script.google.com/macros/s/AKfycbyDnzHtR5fnj1FHvOKtxA0wF59BNzLNsD6jeZnBWNnj8lenwr0OqniWXqZ4e8s7MY03/exec
```
(`app.js` 17번 줄 `GAS_URL` 상수)

GAS Script ID (gas_updater.js 배포 대상):
```
1BIrbPF1RrB2ooETDnQIJ1gWqk_boShtUqO2PECq3WtFsHA-soz95icto
```

---

## 4. 새 PC 초기 설정

```bash
# 1. 의존성 설치
npm install

# 2. GAS 배포 실행 (첫 실행 시 브라우저 OAuth 인증 팝업 뜸)
node gas_updater.js
```

`.gas_token.json`은 보안상 git에 포함되지 않아 새 PC에서 브라우저 승인 1회 필요.

---

## 5. 배포 방법

```bash
node gas_updater.js
```

- `apps_script.gs` 내용을 GAS 프로젝트에 업로드하고 새 배포 버전을 생성함.  
- 완료 후 응답에 버전명(예: v47) 반드시 명시.  
- 앱 URL은 변경되지 않음(기존 URL 그대로 사용).

---

## 6. 수정 대기 중인 버그 / 기능

| # | 항목 | 설명 | 상태 |
|---|---|---|---|
| 1 | **"3-1" 날짜 인식 버그** | 구글 시트가 "3-1" 같은 학급명을 날짜(3월 1일)로 자동 변환하는 문제. `apps_script.gs` 674~677줄에 임시 복원 로직 있음. 시간표 섹션에서도 같은 문제 발생 가능. | 🔧 대기 중 |

> v45에서 "전체시간표 생성 버튼 제거", v46에서 "행사 시트 반영 + 셀 서식" 완료됨.

---

## 7. 보안 참고

`gas_updater.js` 15~16번 줄에 OAuth 클라이언트 시크릿이 하드코딩되어 공개 저장소에 노출되어 있습니다.  
설치형 앱 특성상 즉각적인 위험은 낮지만 인지해두세요.  
민감하다면 환경변수로 분리하거나 `.env`로 이동 권장.

---

## 8. 최근 커밋 히스토리 (참고)

```
v46 - fix: 시간표 셀 텍스트 서식 적용 + 행사 시트 반영
v45 - feat: 시트 양식 만들기·전체시간표 생성 버튼 제거, 구글 시트 커스텀 메뉴 추가
v44 - feat: 전체시간표 구글시트 자동 생성 기능 추가
v41 - feat: 진도표 K~N열 개념링크 헤더 추가
v40 - feat: 진도표 개념 아이콘 바 + 컬럼 재정렬 + 다중 링크 버그 수정
```

---

## 9. Claude 메모리 참고

이 PC의 메모리는 `C:\Users\user\.claude\projects\...\memory\`에 있으며 자동으로 동기화되지 않습니다.  
주요 내용은 이 HANDOFF.md에 모두 담겨 있습니다.
