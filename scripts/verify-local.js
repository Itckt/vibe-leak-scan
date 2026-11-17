import { readFile } from 'node:fs/promises';
import { createFixture } from '../fixtures/site.js';
import { SECRET_TYPES } from '../src/secrets.js';

const appOrigin = 'http://localhost:3000';
let passed = 0;
let failed = 0;
let fixture;
const check = (name, condition) => {
  if (!condition) { failed += 1; console.error(`失敗：${name}`); throw new Error('Verification failed'); }
  passed += 1;
  console.log(`通過：${name}`);
};
async function post(route, body) {
  const response = await fetch(`${appOrigin}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(135000) });
  return { status: response.status, body: await response.json() };
}
try {
  if (process.env.ALLOW_PRIVATE_TARGETS !== '1') throw new Error('Local opt-in required');
  const home = await fetch(appOrigin, { signal: AbortSignal.timeout(10000) });
  check('npm start 提供本機首頁', home.status === 200 && (await home.text()).includes('檢查你的網站'));
  fixture = await createFixture();
  const blocked = await post('/api/scans', { url: fixture.origin, mode: 'deep', verified: true });
  check('直接呼叫未驗證的深度掃描遭拒', blocked.status === 403 && blocked.body.error.code === 'OWNERSHIP_REQUIRED');
  check('被拒絕的深度掃描沒有接觸目標', fixture.requests.length === 0);
  const passive = await post('/api/scans', { url: fixture.origin });
  check('API 建立被動掃描報告', passive.status === 201 && /^[A-Za-z0-9_-]{32}$/.test(passive.body.id));
  const passiveReport = await (await fetch(`${appOrigin}/api/reports/${passive.body.id}`)).json();
  check('被動報告包含每種預期密鑰及來源對照檔', Object.keys(SECRET_TYPES).every((type) => passiveReport.findings.some((item) => item.type === `secret_${type}`)) && passiveReport.findings.some((item) => item.type === 'source_map'));
  check('被動掃描未存取深度檢查路徑', !fixture.requests.some((item) => /^\/(?:\.env|\.git|rest\/)/.test(item.path)));
  const challenge = await post('/api/verifications', { url: fixture.origin });
  check('API 建立擁有權驗證碼', challenge.status === 201);
  fixture.setVerificationToken(challenge.body.token);
  const verified = await post(`/api/verifications/${challenge.body.id}/check`, {});
  check('API 讀取並確認網站驗證標記', verified.status === 200 && verified.body.verified === true);
  const deep = await post('/api/scans', { url: fixture.origin, mode: 'deep', verificationId: challenge.body.id });
  check('API 建立深度掃描報告', deep.status === 201 && /^[A-Za-z0-9_-]{32}$/.test(deep.body.id));
  const stored = await readFile(new URL(`../data/${deep.body.id}.json`, import.meta.url), 'utf8');
  const report = JSON.parse(stored);
  check('磁碟報告包含四個敏感檔案與匿名可讀資料表', report.findings.filter((item) => item.type === 'sensitive_file').length === 4 && report.findings.some((item) => item.type === 'supabase_anonymous_read' && item.table === 'profiles' && item.columns.join(',') === 'id,email'));
  const keys = Object.values(fixture.keys);
  check('磁碟報告沒有任何完整、跳脫或編碼後的假密鑰', keys.every((key) => !stored.includes(key) && !stored.includes(JSON.stringify(key).slice(1, -1)) && !stored.includes(encodeURIComponent(key))));
  check('磁碟報告沒有任何資料列的值', fixture.rowValues.every((value) => !stored.includes(value)));
  const page = await fetch(`${appOrigin}${deep.body.reportUrl}`);
  check('獨立報告網址可以開啟', page.status === 200 && (await page.text()).includes('網站安全報告'));
  check('掃描全程只使用 GET，未使用管理員密鑰', fixture.requests.every((item) => item.method === 'GET' && !item.privileged));
  console.log(`本次報告：${appOrigin}${deep.body.reportUrl}`);
} catch {
  if (!failed) { failed += 1; console.error('失敗：無法完成本機驗證。請確認已安裝依賴，並以 ALLOW_PRIVATE_TARGETS=1 啟動 npm start。'); }
  process.exitCode = 1;
} finally {
  await fixture?.close();
  console.log(`驗證結果：通過 ${passed} 項，失敗 ${failed} 項。`);
}
