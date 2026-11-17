import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readdir } from 'node:fs/promises';
import { readRuntimeConfig, validatePublicOrigin } from '../src/runtime.js';
import { createApp } from '../src/app.js';
import { MemoryReportStore } from '../src/memory-reports.js';
import { fixtureKeys } from '../fixtures/keys.js';
import { localServer, reportDirectory } from './helpers.js';
import { showServiceStatus } from '../public/service-status.js';

const origin = 'https://scan.example.invalid';
const hostedHeaders = { Host: 'scan.example.invalid', Origin: origin };
function httpRequest(url, { method = 'GET', headers = {}, body } = {}) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  // Native HTTP preserves the test Host header instead of fetch's synthesized Host.
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: new Headers(response.headers), json: async () => JSON.parse(text) }));
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Local request timed out')));
    request.end(body);
  });
}
async function post(base, route, body, headers) {
  const response = await httpRequest(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
function privateTargetsOff(t) {
  const previous = process.env.ALLOW_PRIVATE_TARGETS;
  delete process.env.ALLOW_PRIVATE_TARGETS;
  t.after(() => { if (previous === undefined) delete process.env.ALLOW_PRIVATE_TARGETS; else process.env.ALLOW_PRIVATE_TARGETS = previous; });
}

test('local startup remains loopback-only unless hosting is explicitly enabled', () => {
  assert.deepEqual(readRuntimeConfig({}), { host: '127.0.0.1', port: 3000, publicOrigin: null });
  assert.equal(readRuntimeConfig({ PUBLIC_ORIGIN: origin }).publicOrigin, null);
  assert.equal(readRuntimeConfig({ ALLOW_PRIVATE_TARGETS: '1' }).host, '127.0.0.1');
});

test('hosted startup uses a configured HTTPS origin and the platform port', () => {
  assert.deepEqual(readRuntimeConfig({ HOSTED: '1', RENDER_EXTERNAL_URL: origin, PORT: '10000' }), { host: '0.0.0.0', port: 10000, publicOrigin: origin });
  assert.equal(readRuntimeConfig({ HOSTED: '1', PUBLIC_ORIGIN: origin, RENDER_EXTERNAL_URL: 'https://ignored.invalid' }).publicOrigin, origin);
});

for (const input of [undefined, 'http://scan.example.invalid', 'https://user:pass@scan.example.invalid', 'https://scan.example.invalid/path', 'https://scan.example.invalid/?key=fake', 'https://scan.example.invalid/#part', 'https://scan.example.invalid:8443', 'https://127.0.0.1', 'https://10.0.0.1', 'https://[::1]', 'https://a.localhost']) {
  test(`hosted origin rejects unsafe or ambiguous configuration ${String(input)}`, () => assert.throws(() => validatePublicOrigin(input)));
}

test('hosted mode refuses the private-target exception at startup and app construction', (t) => {
  assert.throws(() => readRuntimeConfig({ HOSTED: '1', PUBLIC_ORIGIN: origin, ALLOW_PRIVATE_TARGETS: '1' }));
  privateTargetsOff(t);
  process.env.ALLOW_PRIVATE_TARGETS = '1';
  assert.throws(() => createApp({ publicOrigin: origin }));
});

test('invalid listener configuration fails closed', () => {
  assert.throws(() => readRuntimeConfig({ HOSTED: '1' }));
  assert.throws(() => readRuntimeConfig({ HOSTED: 'true' }));
  for (const port of ['0', '-1', '65536', '3.5', 'invalid']) assert.throws(() => readRuntimeConfig({ PORT: port }));
});

test('hosted HTTP accepts only its configured Host and HTTPS browser origin', async (t) => {
  privateTargetsOff(t);
  const app = await localServer(createApp({ publicOrigin: origin }));
  t.after(app.close);
  const status = await httpRequest(`${app.origin}/api/status`, { headers: hostedHeaders });
  assert.deepEqual(await status.json(), { hosted: true, reportRetentionMinutes: 60 });
  assert.equal((await httpRequest(`${app.origin}/api/status`)).status, 403);
  for (const host of ['other.example.invalid', 'scan.example.invalid.evil.invalid']) {
    assert.equal((await httpRequest(`${app.origin}/api/status`, { headers: { Host: host, 'X-Forwarded-Host': 'scan.example.invalid' } })).status, 403);
  }
  for (const browserOrigin of ['https://other.invalid', 'http://scan.example.invalid', 'null']) {
    const response = await post(app.origin, '/api/scans', { url: 'invalid' }, { ...hostedHeaders, Origin: browserOrigin, 'X-Forwarded-Proto': 'https' });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'INVALID_ORIGIN');
  }
  assert.equal((await post(app.origin, '/api/scans', { url: 'invalid' }, hostedHeaders)).status, 400);
});

test('hosted HTTP retains SSRF rejection and the unverified deep-scan gate', async (t) => {
  privateTargetsOff(t);
  const directory = await reportDirectory(t);
  const app = await localServer(createApp({ publicOrigin: origin, dataDirectory: directory }));
  t.after(app.close);
  for (const url of ['http://127.0.0.1', 'http://169.254.169.254', 'http://10.0.0.1']) {
    const response = await post(app.origin, '/api/scans', { url }, hostedHeaders);
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'SSRF_BLOCKED');
  }
  const deep = await post(app.origin, '/api/scans', { url: 'https://fixture.invalid', mode: 'deep', verified: true }, hostedHeaders);
  assert.equal(deep.status, 403);
  assert.equal(deep.body.error.code, 'OWNERSHIP_REQUIRED');
  assert.deepEqual(await readdir(directory), []);
});

test('hosted global scan quota cannot be bypassed with forwarded IPs', async (t) => {
  privateTargetsOff(t);
  const app = await localServer(createApp({ publicOrigin: origin }));
  t.after(app.close);
  for (let index = 0; index < 6; index++) {
    const response = await post(app.origin, '/api/scans', { url: 'invalid' }, { ...hostedHeaders, 'X-Forwarded-For': `192.0.2.${index}`, 'X-Real-IP': `192.0.2.${index}` });
    assert.equal(response.status, index < 5 ? 400 : 429);
    if (index === 5) assert.equal(response.headers.get('retry-after'), '60');
  }
});

test('hosted health check works behind a proxy without relaxing report Host validation or CSP', async (t) => {
  privateTargetsOff(t);
  const app = await localServer(createApp({ publicOrigin: origin }));
  t.after(app.close);
  const health = await httpRequest(`${app.origin}/healthz`);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const home = await httpRequest(app.origin, { headers: hostedHeaders });
  assert.equal(home.status, 200);
  const csp = home.headers.get('content-security-policy');
  assert.ok(csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'"));
  assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
  assert.ok(home.headers.get('strict-transport-security').includes('max-age='));
  assert.equal((await httpRequest(`${app.origin}/api/reports/${'a'.repeat(32)}`)).status, 403);
});

test('hosted requests fail closed if private targets are enabled after construction', async (t) => {
  privateTargetsOff(t);
  const app = await localServer(createApp({ publicOrigin: origin }));
  t.after(app.close);
  process.env.ALLOW_PRIVATE_TARGETS = '1';
  assert.equal((await httpRequest(`${app.origin}/healthz`)).status, 503);
  assert.equal((await post(app.origin, '/api/scans', { url: 'http://127.0.0.1' }, hostedHeaders)).status, 503);
});

test('temporary reports mask fake credentials and cannot be modified through returned objects', async () => {
  const store = new MemoryReportStore();
  const key = fixtureKeys().openai;
  const saved = await store.save({ target: 'fixture', evidence: key });
  assert.ok(!JSON.stringify(saved).includes(key));
  assert.match(saved.id, /^[A-Za-z0-9_-]{32}$/);
  saved.evidence = 'changed';
  const retrieved = await store.get(saved.id);
  assert.notEqual(retrieved.evidence, 'changed');
  assert.ok(!JSON.stringify(retrieved).includes(key));
});

test('temporary reports expire and disappear on process-store restart', async () => {
  let now = 0;
  const store = new MemoryReportStore({ now: () => now, ttlMs: 1000 });
  const saved = await store.save({ target: 'fixture' });
  now = 999;
  assert.equal((await store.get(saved.id)).id, saved.id);
  now = 1000;
  await assert.rejects(store.get(saved.id), (error) => error.status === 404);
  await assert.rejects(new MemoryReportStore().get(saved.id), (error) => error.status === 404);
  await assert.rejects(store.get('../SPEC.md'), (error) => error.status === 404);
});

test('temporary report count and UTF-8 byte limits evict oldest reports', async () => {
  const store = new MemoryReportStore({ maxReports: 2 });
  const first = await store.save({ target: 'one' });
  await store.save({ target: 'two' });
  const third = await store.save({ target: 'three' });
  await assert.rejects(store.get(first.id), (error) => error.status === 404);
  assert.equal((await store.get(third.id)).target, 'three');
  const bounded = new MemoryReportStore({ maxBytes: 220, maxReportBytes: 220 });
  const old = await bounded.save({ target: '繁'.repeat(20) });
  const latest = await bounded.save({ target: '新'.repeat(20) });
  await assert.rejects(bounded.get(old.id));
  assert.equal((await bounded.get(latest.id)).id, latest.id);
  await assert.rejects(bounded.save({ target: '大'.repeat(100) }), (error) => error.status === 413);
  assert.equal((await bounded.get(latest.id)).id, latest.id);
});

test('public status notice explains temporary storage and shared quota with text only', async () => {
  const notice = { hidden: true, textContent: '' };
  const label = { textContent: '' };
  await showServiceStatus(notice, label, async () => ({ hosted: true }));
  assert.equal(notice.hidden, false);
  assert.ok(notice.textContent.includes('一小時') && notice.textContent.includes('重啟') && notice.textContent.includes('每分鐘五次'));
  assert.equal(label.textContent, '免安裝線上試用版');
  await showServiceStatus(notice, label, async () => ({ hosted: false }));
  assert.equal(notice.hidden, true);
});
