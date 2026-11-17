import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { gzipSync } from 'node:zlib';
import { safeFetch, validateTarget, isPublicAddress, parseTarget, createBudget, USER_AGENT } from '../src/network.js';
import { allowPrivate, localServer } from './helpers.js';

test('a silent connection yields to the next pinned address after three seconds', async (t) => {
  allowPrivate(t);
  const fixture = await localServer((_req, res) => res.end('reachable fixture'));
  t.after(fixture.close);
  const original = http.request;
  let attempts = 0;
  let resolutions = 0;
  let destroyed = false;
  const pinned = [];
  t.mock.method(http, 'request', (url, options, callback) => {
    options.lookup(url.hostname, {}, (_error, address) => pinned.push(address));
    attempts += 1;
    if (attempts > 1) return original(url, options, callback);
    const request = new EventEmitter();
    request.end = () => {};
    request.destroy = () => { destroyed = true; };
    return request;
  });
  const started = Date.now();
  const result = await safeFetch(`http://fixture.invalid:${new URL(fixture.origin).port}`, {
    timeoutMs: 5000,
    resolver: async () => { resolutions += 1; return [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }]; },
  });
  assert.equal(result.body, 'reachable fixture');
  assert.equal(destroyed, true);
  assert.equal(resolutions, 1);
  assert.deepEqual(pinned, ['::1', '127.0.0.1']);
  assert.ok(Date.now() - started >= 2900 && Date.now() - started < 5000);
});

test('silent final address gets remaining time, while an established connection does not fall back', async (t) => {
  allowPrivate(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let attempts = 0;
  let connected = false;
  t.mock.method(http, 'request', () => {
    attempts += 1;
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => {
      if (connected) request.emit('socket', Object.assign(new EventEmitter(), { connecting: false }));
    };
    return request;
  });
  const resolver = async () => [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }];
  const flush = () => new Promise(setImmediate);
  for (const scenario of ['all silent', 'connected', 'short budget']) {
    attempts = 0;
    connected = scenario === 'connected';
    let outcome;
    const result = safeFetch('http://fixture.invalid/', { resolver, budget: createBudget({ durationMs: scenario === 'short budget' ? 1000 : 20000 }) }).then(() => { outcome = 'success'; }, (error) => { outcome = error.code; });
    await flush();
    if (scenario === 'short budget') {
      t.mock.timers.tick(1000);
      await result;
      assert.equal(attempts, 1);
    } else {
      t.mock.timers.tick(3000);
      await flush();
      assert.equal(attempts, connected ? 1 : 2);
      t.mock.timers.tick(3000);
      await flush();
      assert.equal(outcome, undefined, 'Final address or connected response must retain the shared remaining time');
      t.mock.timers.tick(4000);
      await result;
    }
    assert.equal(outcome, 'TIMEOUT');
  }
});

test('falls back from unreachable IPv6 to reachable IPv4 in resolver order without resolving again', async (t) => {
  allowPrivate(t);
  const fixture = await localServer((_req, res) => res.end('fallback fixture'));
  t.after(fixture.close);
  let resolutions = 0;
  const families = [];
  const original = http.request;
  t.mock.method(http, 'request', (url, options, callback) => {
    families.push(options.family);
    return original(url, options, callback);
  });
  const result = await safeFetch(`http://fixture.invalid:${new URL(fixture.origin).port}/`, {
    resolver: async () => { resolutions += 1; return [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }]; },
  });
  assert.equal(result.body, 'fallback fixture');
  assert.deepEqual(families, [6, 4]);
  assert.equal(resolutions, 1);
});

test('returns the network error after all validated addresses refuse connections', async (t) => {
  allowPrivate(t);
  const fixture = await localServer((_req, res) => res.end());
  const port = new URL(fixture.origin).port;
  await fixture.close();
  const original = http.request;
  const families = [];
  t.mock.method(http, 'request', (url, options, callback) => {
    families.push(options.family);
    return original(url, options, callback);
  });
  await assert.rejects(safeFetch(`http://fixture.invalid:${port}/`, {
    resolver: async () => [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }],
  }), { code: 'NETWORK_ERROR' });
  assert.deepEqual(families, [6, 4]);
});

test('mixed public and private DNS answers are rejected before any connection attempt', async (t) => {
  const previous = process.env.ALLOW_PRIVATE_TARGETS;
  delete process.env.ALLOW_PRIVATE_TARGETS;
  t.after(() => { if (previous !== undefined) process.env.ALLOW_PRIVATE_TARGETS = previous; });
  const request = t.mock.method(http, 'request', () => { throw new Error('Connection must not be attempted'); });
  await assert.rejects(safeFetch('http://fixture.invalid/', {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }],
  }), { code: 'SSRF_BLOCKED' });
  assert.equal(request.mock.callCount(), 0);
});

test('does not retry an HTTP error status or a body failure after response headers', async (t) => {
  allowPrivate(t);
  const fixture = await localServer((req, res) => {
    if (req.url === '/status') { res.writeHead(503); return res.end('unavailable'); }
    res.writeHead(200, { 'Content-Length': '100' });
    res.write('partial');
    setImmediate(() => res.destroy());
  });
  t.after(fixture.close);
  const original = http.request;
  const request = t.mock.method(http, 'request', (...args) => original(...args));
  const options = { resolver: async () => [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }] };
  assert.equal((await safeFetch(`${fixture.origin}/status`, options)).status, 503);
  assert.equal(request.mock.callCount(), 1);
  await assert.rejects(safeFetch(`${fixture.origin}/partial`, options), { code: 'NETWORK_ERROR' });
  assert.equal(request.mock.callCount(), 2);
});

test('fallback attempts share one deadline and respect a shorter scan budget', async (t) => {
  allowPrivate(t);
  const originalNow = Date.now;
  let now = originalNow();
  t.mock.method(Date, 'now', () => now);
  const delays = [];
  const originalTimer = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    delays.push(delay);
    return originalTimer(callback, delay, ...args);
  });
  const request = t.mock.method(http, 'request', () => {
    const attempt = new EventEmitter();
    attempt.destroy = () => {};
    attempt.end = () => queueMicrotask(() => {
      now += 60;
      attempt.emit('error', { code: 'ECONNREFUSED' });
    });
    return attempt;
  });
  const addresses = Array.from({ length: 3 }, () => ({ address: '127.0.0.1', family: 4 }));
  for (const [timeoutMs, durationMs] of [[100, 1000], [1000, 100]]) {
    delays.length = 0;
    const before = request.mock.callCount();
    await assert.rejects(safeFetch('http://fixture.invalid/', {
      timeoutMs, budget: createBudget({ durationMs }), resolver: async () => addresses,
    }), { code: 'TIMEOUT' });
    assert.equal(request.mock.callCount() - before, 2);
    assert.deepEqual(delays, [100, 100, 40]);
  }
});

test('SSRF guard rejects private, loopback, metadata, reserved, and non-HTTP URLs by default', async (t) => {
  const previous = process.env.ALLOW_PRIVATE_TARGETS;
  delete process.env.ALLOW_PRIVATE_TARGETS;
  t.after(() => { if (previous !== undefined) process.env.ALLOW_PRIVATE_TARGETS = previous; });
  for (const url of ['http://127.0.0.1', 'http://169.254.169.254', 'http://10.0.0.1', 'http://172.16.2.1', 'http://192.168.1.1', 'http://0.0.0.0', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://[fc00::1]', 'http://[fe80::1]', 'http://100.100.100.200', 'http://[2002:7f00:1::1]']) {
    await assert.rejects(validateTarget(url), { code: 'SSRF_BLOCKED' });
  }
  for (const url of ['file:///etc/passwd', 'ftp://fixture.invalid', 'data:text/plain,test', 'http://user:pass@fixture.invalid', 'javascript:alert(1)', 'http://fixture.invalid/\n']) assert.throws(() => parseTarget(url), { code: 'INVALID_URL' });
});

test('DNS validation rejects mixed answers and DNS rebinding before a connection', async (t) => {
  const previous = process.env.ALLOW_PRIVATE_TARGETS;
  delete process.env.ALLOW_PRIVATE_TARGETS;
  t.after(() => { if (previous !== undefined) process.env.ALLOW_PRIVATE_TARGETS = previous; });
  await assert.rejects(validateTarget('https://fixture.invalid', { resolver: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }] }), { code: 'SSRF_BLOCKED' });
  await assert.rejects(validateTarget('https://fixture.invalid', { resolver: async () => [{ address: 'fe80::1', family: 6 }] }), { code: 'SSRF_BLOCKED' });
  const target = await validateTarget('https://fixture.invalid', { resolver: async () => [{ address: '93.184.216.34', family: 4 }] });
  assert.equal(target.addresses.length, 1);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  assert.equal(isPublicAddress('2001:db8::1'), false);
  assert.equal(isPublicAddress('224.0.0.1'), false);
});

test('ALLOW_PRIVATE_TARGETS must be exactly 1', async (t) => {
  const previous = process.env.ALLOW_PRIVATE_TARGETS;
  process.env.ALLOW_PRIVATE_TARGETS = 'true';
  t.after(() => { if (previous === undefined) delete process.env.ALLOW_PRIVATE_TARGETS; else process.env.ALLOW_PRIVATE_TARGETS = previous; });
  await assert.rejects(validateTarget('http://127.0.0.1'), { code: 'SSRF_BLOCKED' });
  process.env.ALLOW_PRIVATE_TARGETS = '1';
  assert.equal((await validateTarget('http://127.0.0.1')).addresses[0].address, '127.0.0.1');
});

test('pins DNS to the validated socket address and identifies every request as the scanner', async (t) => {
  allowPrivate(t);
  let calls = 0;
  let receivedAgent;
  const fixture = await localServer((req, res) => { receivedAgent = req.headers['user-agent']; res.end('fixture'); });
  t.after(fixture.close);
  const port = new URL(fixture.origin).port;
  const result = await safeFetch(`http://fixture.invalid:${port}/`, { resolver: async () => { calls += 1; return [{ address: calls === 1 ? '127.0.0.1' : '10.0.0.1', family: 4 }]; } });
  assert.equal(result.body, 'fixture');
  assert.equal(calls, 1);
  assert.equal(receivedAgent, USER_AGENT);
});

test('revalidates redirect destinations and blocks a redirect to private space', async (t) => {
  allowPrivate(t);
  const fixture = await localServer((_req, res) => {
    delete process.env.ALLOW_PRIVATE_TARGETS;
    res.writeHead(302, { Location: 'http://169.254.169.254/' }); res.end();
  });
  t.after(fixture.close);
  await assert.rejects(safeFetch(fixture.origin), { code: 'SSRF_BLOCKED' });
});

test('follows at most five redirects and forbids cross-origin credential redirects', async (t) => {
  allowPrivate(t);
  let foreignRequests = 0;
  const foreign = await localServer((_req, res) => { foreignRequests += 1; res.end('unexpected'); });
  t.after(foreign.close);
  const fixture = await localServer((req, res) => {
    if (req.url === '/foreign') { res.writeHead(302, { Location: foreign.origin }); return res.end(); }
    const count = Number(req.url.slice(1));
    if (count > 0) { res.writeHead(302, { Location: `/${count - 1}` }); res.end(); } else res.end('done');
  });
  t.after(fixture.close);
  assert.equal((await safeFetch(`${fixture.origin}/5`)).body, 'done');
  await assert.rejects(safeFetch(`${fixture.origin}/6`), { code: 'REDIRECT_LIMIT' });
  await assert.rejects(safeFetch(`${fixture.origin}/foreign`, { allowedOrigin: fixture.origin, headers: { apikey: 'fixture-only' } }), { code: 'ORIGIN_CHANGED' });
  assert.equal(foreignRequests, 0);
});

test('bounds resource sizes, decompressed sizes, and cumulative bytes', async (t) => {
  allowPrivate(t);
  const fixture = await localServer((req, res) => {
    const body = Buffer.from('x'.repeat(req.url === '/small' ? 60 : 2048));
    if (req.url === '/gzip') { res.writeHead(200, { 'Content-Encoding': 'gzip' }); res.end(gzipSync(body)); }
    else res.end(body);
  });
  t.after(fixture.close);
  await assert.rejects(safeFetch(fixture.origin, { maxBytes: 100 }), { code: 'SIZE_LIMIT' });
  await assert.rejects(safeFetch(`${fixture.origin}/gzip`, { maxBytes: 100 }), { code: 'SIZE_LIMIT' });
  const budget = createBudget({ maxBytes: 100 });
  await safeFetch(`${fixture.origin}/small`, { budget });
  await assert.rejects(safeFetch(`${fixture.origin}/small`, { budget }), { code: 'SIZE_LIMIT' });
});

test('times out DNS, stalled responses, and slow-drip bodies within the request deadline', async (t) => {
  allowPrivate(t);
  await assert.rejects(validateTarget('http://fixture.invalid', { timeoutMs: 30, resolver: () => new Promise(() => {}) }), { code: 'TIMEOUT' });
  const fixture = await localServer((req, res) => {
    if (req.url === '/stall') return;
    res.writeHead(200);
    const timer = setInterval(() => res.write('x'), 10);
    res.on('close', () => clearInterval(timer));
  });
  t.after(fixture.close);
  for (const route of ['/stall', '/drip']) await assert.rejects(safeFetch(`${fixture.origin}${route}`, { timeoutMs: 40 }), { code: 'TIMEOUT' });
  await assert.rejects(safeFetch(fixture.origin, { budget: createBudget({ durationMs: -1 }) }), { code: 'SCAN_TIMEOUT' });
});
