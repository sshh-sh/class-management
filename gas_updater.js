/**
 * GAS 자동 업데이트 스크립트
 * 최초 1회만 브라우저 승인 → 이후 자동 실행
 */
import http from 'http';
import https from 'https';
import fs from 'fs';
import { execSync } from 'child_process';
import { URL, URLSearchParams } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLIENT_ID = '1072944905499-vm2v2i5dvn0a0d2o4ca36i1vge8cvbn0.apps.googleusercontent.com';
const CLIENT_SECRET = 'v6V3fKV_zWU7iw1DrpO1rknX';
const REDIRECT_URI = 'http://localhost:8888';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_FILE = path.join(__dirname, '.gas_token.json');

const SCRIPT_ID = '1BIrbPF1RrB2ooETDnQIJ1gWqk_boShtUqO2PECq3WtFsHA-soz95icto';
const GAS_FILE = path.join(__dirname, 'apps_script.gs');

const SCOPES = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/script.webapp.deploy',
].join(' ');

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getTokenFromRefresh(refreshToken) {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token'
  });
  const res = await httpsRequest(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, params.toString());
  if (!res.body.access_token) throw new Error('토큰 갱신 실패');
  return res.body.access_token;
}

async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI, grant_type: 'authorization_code'
  });
  const res = await httpsRequest(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, params.toString());
  if (!res.body.access_token) throw new Error('토큰 발급 실패: ' + JSON.stringify(res.body));
  // 리프레시 토큰 저장 (다음부터 자동 로그인)
  if (res.body.refresh_token) {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: res.body.refresh_token }));
    console.log('✅ 인증 정보 저장 완료 (다음부터 자동 로그인)');
  }
  return res.body.access_token;
}

async function getGasContent(token) {
  const res = await httpsRequest(
    `https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`,
    { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (res.status !== 200) throw new Error('기존 코드 조회 실패: ' + JSON.stringify(res.body));
  return res.body;
}

async function updateGasContent(token, source) {
  const current = await getGasContent(token);
  const manifestFile = current.files?.find(f => f.name === 'appsscript');
  let manifestSource;
  if (manifestFile) {
    const m = JSON.parse(manifestFile.source);
    m.webapp = { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' };
    manifestSource = JSON.stringify(m);
    console.log('✅ 기존 manifest 보존');
  } else {
    manifestSource = JSON.stringify({
      timeZone: 'Asia/Seoul',
      oauthScopes: ['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive'],
      exceptionLogging: 'STACKDRIVER',
      runtimeVersion: 'V8',
      webapp: { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' }
    });
  }
  const body = JSON.stringify({
    files: [
      { name: 'appsscript', type: 'JSON', source: manifestSource },
      { name: 'Code', type: 'SERVER_JS', source }
    ]
  });
  const res = await httpsRequest(
    `https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`,
    { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
    body
  );
  if (res.status !== 200) throw new Error('코드 업데이트 실패: ' + JSON.stringify(res.body));
  console.log('✅ GAS 코드 업데이트 완료');
}

async function createVersion(token) {
  const res = await httpsRequest(
    `https://script.googleapis.com/v1/projects/${SCRIPT_ID}/versions`,
    { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
    JSON.stringify({ description: '자동 배포' })
  );
  if (res.status !== 200) throw new Error('버전 생성 실패: ' + JSON.stringify(res.body));
  console.log(`✅ 새 버전 생성: v${res.body.versionNumber}`);
  return res.body.versionNumber;
}

async function getDeployments(token) {
  const res = await httpsRequest(
    `https://script.googleapis.com/v1/projects/${SCRIPT_ID}/deployments`,
    { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (res.status !== 200) throw new Error('배포 목록 조회 실패: ' + JSON.stringify(res.body));
  return res.body.deployments || [];
}

async function deleteDeployment(token, deploymentId) {
  const res = await httpsRequest(
    `https://script.googleapis.com/v1/projects/${SCRIPT_ID}/deployments/${deploymentId}`,
    { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (res.status !== 200) console.log(`⚠️  배포 삭제 실패 (${deploymentId}): ${res.status}`);
}

async function createDeployment(token, versionNumber) {
  const res = await httpsRequest(
    `https://script.googleapis.com/v1/projects/${SCRIPT_ID}/deployments`,
    { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
    JSON.stringify({ versionNumber, manifestFileName: 'appsscript', description: '자동 배포' })
  );
  if (res.status !== 200) throw new Error('배포 생성 실패: ' + JSON.stringify(res.body));
  console.log('✅ 새 배포 생성 완료');
  return res.body;
}

async function deploy(token) {
  console.log('\n🔄 GAS 업데이트 시작...');
  const source = fs.readFileSync(GAS_FILE, 'utf8');
  await updateGasContent(token, source);
  const versionNumber = await createVersion(token);
  let deployments = await getDeployments(token);
  console.log(`📋 배포 목록: ${deployments.length}개`);

  // 배포 한도(20개) 초과 시 오래된 배포 삭제
  const MAX_DEPLOYMENTS = 19;
  const deletable = deployments
    .filter(d => d.deploymentId !== '@HEAD' && d.deploymentConfig?.versionNumber)
    .sort((a, b) => (a.deploymentConfig.versionNumber || 0) - (b.deploymentConfig.versionNumber || 0));
  if (deletable.length > MAX_DEPLOYMENTS) {
    const toDelete = deletable.slice(0, deletable.length - MAX_DEPLOYMENTS);
    for (const dep of toDelete) {
      await deleteDeployment(token, dep.deploymentId);
      console.log(`🗑  구버전 배포 삭제: v${dep.deploymentConfig.versionNumber}`);
    }
  }

  const newDeploy = await createDeployment(token, versionNumber);
  const newUrl = newDeploy.entryPoints?.find(e => e.entryPointType === 'WEB_APP')?.webApp?.url;
  if (newUrl) {
    console.log(`🌐 새 GAS URL: ${newUrl}`);
    const appJsPath = path.join(__dirname, 'app.js');
    let appJs = fs.readFileSync(appJsPath, 'utf8');
    appJs = appJs.replace(/const GAS_URL = '[^']+';/, `const GAS_URL = '${newUrl}';`);
    fs.writeFileSync(appJsPath, appJs, 'utf8');
    console.log('✅ app.js GAS_URL 업데이트 완료');
  } else {
    console.log('⚠️  새 배포 URL을 찾지 못했습니다.');
  }
  console.log('\n🎉 완료! GitHub에 푸시 후 사이트를 확인하세요.');
  process.exit(0);
}

// ── 메인 흐름 ──────────────────────────────────────────
// 1. 저장된 리프레시 토큰이 있으면 자동 실행
if (fs.existsSync(TOKEN_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (saved.refresh_token) {
      console.log('🔑 저장된 인증 정보로 자동 로그인 중...');
      const token = await getTokenFromRefresh(saved.refresh_token);
      console.log('✅ 자동 인증 성공');
      await deploy(token);
    }
  } catch(e) {
    console.log('⚠️  저장된 토큰 만료. 브라우저 재인증 필요...');
    fs.unlinkSync(TOKEN_FILE);
    // 아래 브라우저 OAuth 흐름으로 계속
    startBrowserAuth();
  }
} else {
  startBrowserAuth();
}

// 2. 브라우저 OAuth 흐름 (최초 1회)
function startBrowserAuth() {
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent'
    }).toString();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:8888');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (error) {
      res.end('<h2>❌ 승인 거부됨</h2><p>창을 닫아주세요.</p>');
      server.close(); process.exit(1);
    }
    if (code) {
      res.end('<h2>✅ 승인 완료!</h2><p>이 창을 닫아도 됩니다. GAS 업데이트 중...</p>');
      server.close();
      try {
        const token = await exchangeCodeForToken(code);
        console.log('✅ 인증 성공');
        await deploy(token);
      } catch(e) { console.error('❌ 오류:', e.message); process.exit(1); }
    } else {
      res.end('<p>잘못된 요청입니다.</p>');
    }
  });

  server.listen(8888, () => {
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🔐 최초 1회 Google 승인이 필요합니다');
    console.log('  승인 후 다음부터는 자동으로 실행됩니다');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    try {
      execSync(`start "" "${authUrl}"`, { stdio: 'ignore' });
      console.log('  ✅ 브라우저가 열렸습니다. 허용을 눌러주세요.');
    } catch {
      console.log('  📋 아래 URL을 브라우저에 붙여넣으세요:');
      console.log('  ' + authUrl);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });
}
