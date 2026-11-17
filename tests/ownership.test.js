import test from 'node:test';
import assert from 'node:assert/strict';
import { VerificationStore } from '../src/verification.js';
import { createBudget } from '../src/network.js';
import { scan } from '../src/scanner.js';
import { hasVerificationMeta, readHtml } from '../src/html.js';
import { createFixture } from '../fixtures/site.js';
import { allowPrivate } from './helpers.js';

test('HTML parser handles attributes and bases without accepting scripts or comments as proof', () => {
  const token = 'local-verification-token';
  assert.equal(hasVerificationMeta(`<html><head><meta content='${token}' name='laumlau-verify'></head></html>`, token), true);
  for (const html of [
    `<html><head><!-- <meta name="laumlau-verify" content="${token}"> --></head></html>`,
    `<html><head><script>const fake = '<meta name="laumlau-verify" content="${token}">'</script></head></html>`,
    `<html><head></head><body><meta name="laumlau-verify" content="${token}"></body></html>`,
    `<meta name="laumlau-verify" content="wrong-${token}">`,
  ]) assert.equal(hasVerificationMeta(html, token), false);
  const html = '<head><base href="/assets/"><script src="app.js?a=1&amp;b=2"></script></head><body><script>inline()</script><!-- <script src="ignored.js"></script> --></body>';
  const parsed = readHtml(html, 'https://fixture.invalid/page');
  assert.deepEqual(parsed.scripts, ['https://fixture.invalid/assets/app.js?a=1&b=2']);
  assert.deepEqual(parsed.inline, ['inline()']);
});

for (const method of ['meta', 'file']) {
  test(`verifies ${method} proof, binds origin, and revalidates before each deep scan`, async (t) => {
    allowPrivate(t);
    const fixture = await createFixture();
    t.after(fixture.close);
    const store = new VerificationStore();
    const challenge = store.issue(fixture.origin);
    assert.ok(/^[A-Za-z0-9_-]{32}$/.test(challenge.id));
    assert.ok(/^[a-f0-9]{64}$/.test(challenge.token));
    assert.ok(challenge.token !== challenge.id);
    await assert.rejects(store.check(challenge.id), { code: 'OWNERSHIP_NOT_FOUND' });
    await assert.rejects(store.authorize(fixture.origin, challenge.id, createBudget()), { code: 'OWNERSHIP_REQUIRED' });
    fixture.setVerificationToken(challenge.token, method);
    await assert.rejects(store.authorize(fixture.origin, challenge.id, createBudget()), { code: 'OWNERSHIP_REQUIRED' });
    assert.equal((await store.check(challenge.id)).verified, true);
    assert.equal(await store.authorize(fixture.origin, challenge.id, createBudget()), fixture.origin);
    await assert.rejects(store.authorize(fixture.origin.replace('127.0.0.1', 'localhost'), challenge.id, createBudget()), { code: 'OWNERSHIP_REQUIRED' });
    fixture.setVerificationToken('removed');
    await assert.rejects(store.authorize(fixture.origin, challenge.id, createBudget()), { code: 'OWNERSHIP_REQUIRED' });
  });
}

test('expired, nonexistent, and redirect-based proofs cannot unlock scanning', async (t) => {
  allowPrivate(t);
  const fixture = await createFixture({ verificationMethod: 'file', redirectProof: true });
  t.after(fixture.close);
  let now = Date.now();
  const store = new VerificationStore({ now: () => now });
  const challenge = store.issue(fixture.origin);
  fixture.setVerificationToken(challenge.token, 'file');
  await assert.rejects(store.check(challenge.id), { code: 'OWNERSHIP_NOT_FOUND' });
  now += 15 * 60 * 1000 + 1;
  await assert.rejects(store.check(challenge.id), { code: 'OWNERSHIP_REQUIRED' });
  await assert.rejects(store.authorize(fixture.origin, 'invented', createBudget()), { code: 'OWNERSHIP_REQUIRED' });
});

test('scanner itself has no deep-scan bypass, even when called without HTTP', async (t) => {
  allowPrivate(t);
  const fixture = await createFixture();
  t.after(fixture.close);
  await assert.rejects(scan({ url: fixture.origin, mode: 'deep', verified: true }), { code: 'OWNERSHIP_REQUIRED' });
  assert.equal(fixture.requests.length, 0);
});
