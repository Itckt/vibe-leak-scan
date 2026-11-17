import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createApp, WindowLimiter } from '../src/app.js';
import { scan } from '../src/scanner.js';
import { VerificationStore } from '../src/verification.js';
import { discoverSupabase } from '../src/deep.js';
import { createFixture } from '../fixtures/site.js';
import { fixtureKeys, fakeJwt } from '../fixtures/keys.js';
import { SECRET_TYPES } from '../src/secrets.js';
import { SEVERITIES } from '../src/checks.js';
import { TOOLS } from '../src/prompts.js';
import { ReportStore } from '../src/storage.js';
import { allowPrivate, localServer, post, reportDirectory } from './helpers.js';

async function verifiedStore(fixture, method = 'meta') {
  const store = new VerificationStore();
  const challenge = store.issue(fixture.origin);
  fixture.setVerificationToken(challenge.token, method);
  await store.check(challenge.id);
  return { store, challenge };
}

test('HTTP scan finds fixture leaks, stores only masked secrets, and never stores row values or logs secrets', async (t) => {
  allowPrivate(t);
  const directory = await reportDirectory(t);
  const fixture = await createFixture();
  t.after(fixture.close);
  const app = await localServer(createApp({ dataDirectory: directory }));
  t.after(app.close);
  const logged = [];
  for (const method of ['log', 'warn', 'error']) t.mock.method(console, method, (...args) => logged.push(args.join(' ')));

  const passive = await post(app.origin, '/api/scans', { url: `${fixture.origin}/?api_key=${encodeURIComponent(fixture.keys.openai)}` });
  assert.equal(passive.status, 201);
  assert.ok(/^[A-Za-z0-9_-]{32}$/.test(passive.body.id));
  const passiveReport = await (await fetch(`${app.origin}/api/reports/${passive.body.id}`)).json();
  for (const type of Object.keys(SECRET_TYPES)) assert.ok(passiveReport.findings.some((item) => item.type === `secret_${type}`), `Missing finding type: ${type}`);
  assert.ok(passiveReport.findings.some((item) => item.type === 'source_map'));
  assert.ok(passiveReport.findings.some((item) => item.type === 'secret_openai' && item.source.endsWith('/assets/chunk.js')));
  assert.ok(passiveReport.findings.some((item) => item.type === 'secret_anthropic' && item.source.endsWith('/assets/nested.js')));
  assert.equal(passiveReport.coverage.scripts, 3);
  assert.equal(passiveReport.coverage.importedScripts, 2);
  assert.equal(passiveReport.findings.filter((item) => item.type.startsWith('header_')).length, 6);
  assert.ok(!passiveReport.findings.some((item) => ['sensitive_file', 'supabase_anonymous_read'].includes(item.type)));
  assert.ok(!fixture.requests.some((item) => item.path.startsWith('/rest/') || item.path.startsWith('/.env') || item.path.startsWith('/.git')));
  assert.equal(passiveReport.grade, 'F');
  assert.ok(passiveReport.platforms.includes('Supabase') && passiveReport.platforms.includes('Firebase') && passiveReport.platforms.includes('Lovable'));

  const challenge = await post(app.origin, '/api/verifications', { url: fixture.origin });
  assert.equal(challenge.status, 201);
  fixture.setVerificationToken(challenge.body.token);
  const check = await post(app.origin, `/api/verifications/${challenge.body.id}/check`, {});
  assert.equal(check.status, 200);
  const deep = await post(app.origin, '/api/scans', { url: fixture.origin, mode: 'deep', verificationId: challenge.body.id });
  assert.equal(deep.status, 201);
  assert.notEqual(deep.body.id, passive.body.id);
  const report = await (await fetch(`${app.origin}/api/reports/${deep.body.id}`)).json();
  assert.equal(report.ownershipVerified, true);
  assert.equal(report.findings.filter((item) => item.type === 'sensitive_file').length, 4);
  const databaseFinding = report.findings.find((item) => item.type === 'supabase_anonymous_read');
  assert.ok(databaseFinding, 'Anonymous data access must be reported');
  assert.equal(databaseFinding.severity, '嚴重');
  assert.equal(databaseFinding.table, 'profiles');
  assert.deepEqual(databaseFinding.columns, ['id', 'email']);
  assert.equal(report.databaseChecks.length, 3);
  assert.ok(report.databaseChecks.some((item) => item.table === 'empty_table' && item.result.includes('無法')));
  const ranks = report.findings.map((item) => SEVERITIES.indexOf(item.severity));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  for (const item of report.findings) for (const field of ['title', 'description', 'why', 'fix', 'prompt']) assert.ok(/[\u3400-\u9fff]/u.test(item[field]), `Missing Traditional Chinese prose: ${field}`);

  for (const name of await readdir(directory)) {
    const stored = await readFile(path.join(directory, name), 'utf8');
    for (const item of JSON.parse(stored).findings) {
      assert.deepEqual(Object.keys(item.prompts), TOOLS);
      assert.equal(item.prompt, item.prompts.generic);
      for (const prompt of Object.values(item.prompts)) assert.ok(prompt.includes('背景\n') && prompt.includes('驗收\n'));
      if (item.type === 'secret_openai') assert.ok(item.manualStep.includes('撤銷舊密鑰'));
    }
    for (const key of Object.values(fixture.keys)) {
      assert.ok(!stored.includes(key), 'Stored JSON must not contain any full fixture key');
      assert.ok(!stored.includes(JSON.stringify(key).slice(1, -1)), 'Stored JSON must not contain an escaped full fixture key');
      assert.ok(!stored.includes(encodeURIComponent(key)), 'Stored JSON must not contain an encoded full fixture key');
      assert.ok(!logged.join('\n').includes(key), 'Logs must not contain any full fixture key');
    }
    for (const value of fixture.rowValues) assert.ok(!stored.includes(value), 'Stored reports must not contain row values');
  }
  const html = await fetch(`${app.origin}${deep.body.reportUrl}`);
  assert.equal(html.status, 200);
  assert.ok((await html.text()).includes('網站安全報告'));
  assert.ok(html.headers.get('content-security-policy').includes("script-src 'self'"));
  const module = await fetch(`${app.origin}/src/prompts.js`);
  assert.equal(module.status, 200);
  assert.ok((await module.text()).includes('export function buildFixPlan'));
  assert.ok(!module.headers.get('content-security-policy').includes('unsafe-inline'));
  assert.equal((await fetch(`${app.origin}/src/scanner.js`)).status, 404);
  assert.ok(fixture.requests.every((item) => item.method === 'GET' && !item.privileged));
  assert.ok(fixture.requests.every((item) => item.userAgent.includes('Security-Scanner')));
  const tableRequests = fixture.requests.filter((item) => /^\/rest\/v1\/[^/]+$/.test(item.path));
  assert.equal(tableRequests.length, 3);
  assert.ok(tableRequests.every((item) => item.query === '?select=*&limit=1'));
});

test('legacy report without prompt variants still loads through the report API and page', async (t) => {
  const directory = await reportDirectory(t);
  const legacy = await new ReportStore(directory).save({ findings: [{ type: 'source_map', prompt: '舊報告修復指令', severity: '中' }] });
  const app = await localServer(createApp({ dataDirectory: directory }));
  t.after(app.close);
  const result = await (await fetch(`${app.origin}/api/reports/${legacy.id}`)).json();
  assert.equal(result.findings[0].prompt, '舊報告修復指令');
  assert.equal(result.findings[0].prompts, undefined);
  assert.equal((await fetch(`${app.origin}/report/${legacy.id}`)).status, 200);
});

test('unverified deep HTTP requests are rejected before any target request, regardless of supplied flags', async (t) => {
  allowPrivate(t);
  const fixture = await createFixture();
  t.after(fixture.close);
  const directory = await reportDirectory(t);
  const app = await localServer(createApp({ dataDirectory: directory }));
  t.after(app.close);
  for (const body of [
    { url: fixture.origin, mode: 'deep' },
    { url: fixture.origin, mode: 'deep', verified: true, ownershipVerified: true },
    { url: fixture.origin, mode: 'deep', verificationId: 'invented' },
  ]) {
    const response = await post(app.origin, '/api/scans', body);
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'OWNERSHIP_REQUIRED');
  }
  const challenge = await post(app.origin, '/api/verifications', { url: fixture.origin });
  fixture.setVerificationToken(challenge.body.token);
  const unchecked = await post(app.origin, '/api/scans', { url: fixture.origin, mode: 'deep', verificationId: challenge.body.id, verified: true });
  assert.equal(unchecked.status, 403);
  assert.equal(fixture.requests.length, 0);
  assert.deepEqual(await readdir(directory), []);
});

test('HTTP proof cannot be reused after removing the marker', async (t) => {
  allowPrivate(t);
  const fixture = await createFixture();
  t.after(fixture.close);
  const app = await localServer(createApp({ dataDirectory: await reportDirectory(t) }));
  t.after(app.close);
  const challenge = await post(app.origin, '/api/verifications', { url: fixture.origin });
  fixture.setVerificationToken(challenge.body.token, 'file');
  assert.equal((await post(app.origin, `/api/verifications/${challenge.body.id}/check`, {})).status, 200);
  fixture.setVerificationToken('');
  const response = await post(app.origin, '/api/scans', { url: fixture.origin, mode: 'deep', verificationId: challenge.body.id });
  assert.equal(response.status, 403);
  assert.ok(!fixture.requests.some((item) => item.path.startsWith('/rest/') || item.path.startsWith('/.env')));
});

test('uses bundle table names when OpenAPI is unavailable, and rejects SPA sensitive-file fallbacks', async (t) => {
  allowPrivate(t);
  const fixture = await createFixture({ openApi: false, spaFallback: true });
  t.after(fixture.close);
  const { store, challenge } = await verifiedStore(fixture, 'file');
  const report = await scan({ url: fixture.origin, mode: 'deep', verificationId: challenge.id }, store);
  assert.ok(report.findings.some((item) => item.type === 'supabase_anonymous_read' && item.table === 'profiles'));
  assert.ok(!report.findings.some((item) => item.type === 'sensitive_file'));
  assert.ok(report.notices.some((item) => item.includes('OpenAPI')));
  assert.equal(fixture.requests.filter((item) => item.path === '/rest/v1/profiles').length, 1);
});

test('limits external scripts to thirty and ignores unavailable source maps', async (t) => {
  allowPrivate(t);
  const paths = [];
  const fixture = await localServer((req, res) => {
    paths.push(req.url);
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<html><head></head><body>${Array.from({ length: 33 }, (_, index) => `<script src="/${index}.js"></script>`).join('')}</body></html>`);
    }
    if (req.url.endsWith('.map')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>SPA fallback</html>'); }
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end('// harmless fixture\n//# sourceMappingURL=app.js.map');
  });
  t.after(fixture.close);
  const report = await scan({ url: fixture.origin });
  assert.equal(report.coverage.scripts, 30);
  assert.equal(paths.filter((item) => item.endsWith('.js')).length, 30);
  assert.ok(report.notices.some((item) => item.includes('三十')));
  assert.ok(!report.findings.some((item) => item.type === 'source_map'));
});

test('only public Supabase keys are eligible and explicit JWT refs must match the project', () => {
  const keys = fixtureKeys();
  const sources = [
    `createClient("https://fixture.supabase.co", "${keys.supabase_service_role}")`,
    `createClient("https://fixture.supabase.co", "${keys.supabase_secret}")`,
  ];
  assert.equal(discoverSupabase(sources).projects.length, 0);
  assert.equal(discoverSupabase([`createClient("https://fixture.supabase.co", "${fakeJwt('anon', { ref: 'different' })}")`]).projects.length, 0);
  const publicProject = discoverSupabase([`createClient("https://fixture.supabase.co", "${keys.supabase_publishable}")`]).projects;
  assert.equal(publicProject.length, 1);
  assert.equal(publicProject[0].jwt, false);
});

test('rate limit is five scans per socket IP per minute and ignores forged forwarding headers', async (t) => {
  const app = await localServer(createApp({ dataDirectory: await reportDirectory(t) }));
  t.after(app.close);
  for (let index = 0; index < 6; index += 1) {
    const result = await post(app.origin, '/api/scans', { url: 'invalid' }, { 'X-Forwarded-For': `192.0.2.${index}` });
    assert.equal(result.status, index < 5 ? 400 : 429);
    if (index === 5) assert.equal(result.headers.get('retry-after'), '60');
  }
  let now = 0;
  const limiter = new WindowLimiter(5, () => now);
  for (let index = 0; index < 5; index += 1) assert.equal(limiter.take('fixture'), true);
  assert.equal(limiter.take('fixture'), false);
  now = 60001;
  assert.equal(limiter.take('fixture'), true);
});

test('HTTP API blocks required SSRF examples with the opt-in unset', async (t) => {
  const previous = process.env.ALLOW_PRIVATE_TARGETS;
  delete process.env.ALLOW_PRIVATE_TARGETS;
  t.after(() => { if (previous !== undefined) process.env.ALLOW_PRIVATE_TARGETS = previous; });
  const app = await localServer(createApp({ dataDirectory: await reportDirectory(t) }));
  t.after(app.close);
  for (const url of ['http://127.0.0.1', 'http://169.254.169.254', 'http://10.0.0.1']) {
    const response = await post(app.origin, '/api/scans', { url });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'SSRF_BLOCKED');
  }
});

test('API rejects cross-site writes, malformed bodies, and report traversal', async (t) => {
  const app = await localServer(createApp({ dataDirectory: await reportDirectory(t) }));
  t.after(app.close);
  const crossSite = await post(app.origin, '/api/scans', { url: 'http://fixture.invalid' }, { Origin: 'https://untrusted.invalid' });
  assert.equal(crossSite.status, 403);
  const malformed = await fetch(`${app.origin}/api/scans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"url":' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_BODY');
  const plain = await fetch(`${app.origin}/api/scans`, { method: 'POST', body: 'invalid' });
  assert.equal(plain.status, 415);
  assert.equal((await fetch(`${app.origin}/api/reports/not-a-report`)).status, 404);
  assert.equal((await fetch(`${app.origin}/api/reports/%2e%2e%2fSPEC.md`)).status, 404);
  assert.equal((await fetch(`${app.origin}/data/`)).status, 404);
});
