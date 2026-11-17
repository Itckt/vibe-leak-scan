import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSecrets, decodeJwt, maskSecret, redactObject, displayUrl, SECRET_TYPES, secretFinding } from '../src/secrets.js';
import { fixtureKeys, fakeJwt } from '../fixtures/keys.js';

const keys = fixtureKeys();
const variants = Object.entries(keys).map(([name, key]) => [name, name === 'openai_project' ? 'openai' : name === 'github_fine' ? 'github' : name, key]);
for (const [name, type, key] of variants) {
  test(`detects ${name} and masks the evidence`, () => {
    const result = detectSecrets(`const fixture = \`${key}\`;`);
    assert.deepEqual(result.map((item) => item.type), [type]);
    assert.ok(result[0].value === key, 'The detector must preserve only its in-memory candidate');
    const evidence = secretFinding(result[0], 'https://fixture.invalid/app.js').evidence;
    assert.ok(evidence === `${key.slice(0, 6)}…${key.slice(-4)}`, 'Evidence must show only the first six and last four characters');
    assert.ok(!evidence.includes(key), 'Full keys must never appear in evidence');
    assert.equal(SECRET_TYPES[type].severity, ['supabase_anon', 'supabase_publishable'].includes(type) ? '資訊' : type === 'google' ? '低' : ['aws', 'slack', 'sendgrid', 'resend', 'telegram'].includes(type) ? '高' : '嚴重');
  });
  test(`rejects malformed ${name}`, () => {
    const invalid = type.startsWith('supabase_') && ['supabase_anon', 'supabase_service_role'].includes(type)
      ? fakeJwt('authenticated')
      : type === 'pem' ? key.replace('END PRIVATE', 'END PUBLIC')
        : type === 'telegram' ? key.replace(':', '.')
          : key.replace(/^[A-Za-z]+/, 'invalid');
    assert.ok(!detectSecrets(invalid).some((item) => item.type === type), 'Malformed credentials must not match');
  });
}

test('JWT classification requires decoded role, canonical JSON, and the expected structure', () => {
  assert.equal(decodeJwt(keys.supabase_service_role)?.role, 'service_role');
  assert.equal(decodeJwt(keys.supabase_anon)?.role, 'anon');
  assert.deepEqual(detectSecrets(fakeJwt('authenticated')), []);
  assert.deepEqual(detectSecrets(fakeJwt('service_role_extra')), []);
  assert.deepEqual(detectSecrets(fakeJwt('ADMIN')), []);
  assert.deepEqual(detectSecrets(fakeJwt('other', { note: 'service_role' })), []);
  assert.equal(decodeJwt('bad.payload.signature'), null);
  assert.equal(decodeJwt('not-a-jwt'), null);
  const malformed = [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from('not json role=service_role').toString('base64url'), 'a'.repeat(32)].join('.');
  assert.deepEqual(detectSecrets(malformed), []);
});

test('detects every Slack prefix without incorrectly detecting OpenAI for Anthropic', () => {
  for (const suffix of ['b', 'a', 'p', 'r', 's']) {
    const value = keys.slack.replace('xoxb', `xox${suffix}`);
    assert.deepEqual(detectSecrets(value).map((item) => item.type), ['slack']);
  }
  assert.ok(!detectSecrets(keys.anthropic).some((item) => item.type === 'openai'));
});

test('rejects short examples, public Stripe keys, unrelated JWTs, and wrong token lengths', () => {
  const negatives = ['sk-' + 'short', 'sk-proj-' + 'example', 'sk-ant-' + 'short', 'sb_secret_' + 'short', 'sb_publishable_' + 'short', 'pk_live_' + 'A'.repeat(32), 'AKIA' + 'A'.repeat(15), 'AKIA' + 'A'.repeat(17), 'ghp_' + 'A'.repeat(35), 'github_pat_' + 'A'.repeat(59), 'xoxb-' + 'short', 'SG.' + 'A'.repeat(20) + '.' + 'B'.repeat(43), 're_' + 'short', '1234567:' + 'A'.repeat(35), '12345678901:' + 'A'.repeat(35), 'AIza' + 'A'.repeat(34), 'AIza' + 'A'.repeat(36)];
  for (const value of negatives) assert.ok(detectSecrets(value).length === 0, 'Invalid lengths and public Stripe keys must not match');
});

test('deduplicates candidates, recursively redacts, and removes URL queries', () => {
  assert.equal(detectSecrets(`${keys.openai} ${keys.openai}`).length, 1);
  const object = redactObject({ nested: [{ value: keys.openai }, { value: encodeURIComponent(keys.pem) }] }, Object.values(keys));
  const serialized = JSON.stringify(object);
  for (const key of Object.values(keys)) assert.ok(!serialized.includes(key), 'No raw candidate may survive redaction');
  assert.ok(!serialized.includes(encodeURIComponent(keys.pem)), 'Encoded PEM must be removed');
  assert.equal(maskSecret('tiny'), '已遮蓋');
  const url = displayUrl(`https://fixture.invalid/${encodeURIComponent(keys.openai)}?private=unrelated-value#secret`);
  assert.ok(!url.includes(keys.openai) && !url.includes('unrelated-value'));
});

test('detects escaped PEM strings and common private-key labels without matching public keys', () => {
  for (const prefix of ['', 'RSA ', 'EC ', 'DSA ', 'OPENSSH ', 'ENCRYPTED ']) {
    const privateKey = keys.pem.replaceAll('PRIVATE KEY', `${prefix}PRIVATE KEY`);
    assert.ok(detectSecrets(privateKey).some((item) => item.type === 'pem'));
    assert.ok(detectSecrets(JSON.stringify(privateKey)).some((item) => item.type === 'pem'));
    assert.ok(!detectSecrets(privateKey.replaceAll('PRIVATE KEY', 'PUBLIC KEY')).some((item) => item.type === 'pem'));
  }
});

test('detects Telegram credentials embedded in bot API URLs', () => {
  const url = `https://api.telegram.invalid/bot${keys.telegram}/sendMessage`;
  assert.deepEqual(detectSecrets(url).map((item) => item.type), ['telegram']);
  assert.ok(!displayUrl(url).includes(keys.telegram));
});
