import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHeaders, detectPlatforms, sensitiveFileLooksReal, sourceMapLooksReal, gradeReport } from '../src/checks.js';

const safeHeaders = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
};

test('reports all six missing HTTP protections', () => {
  assert.deepEqual(checkHeaders('http://fixture.invalid/', {}).map((item) => item.type), ['header_https', 'header_hsts', 'header_csp', 'header_framing', 'header_nosniff', 'header_referrer']);
});
test('recognizes HTTPS and valid headers including frame-ancestors', () => {
  assert.deepEqual(checkHeaders('https://fixture.invalid/', safeHeaders), []);
});
test('accepts X-Frame-Options as an alternative, case-insensitively', () => {
  const headers = { ...safeHeaders, 'content-security-policy': "default-src 'self'", 'X-Frame-Options': 'SAMEORIGIN' };
  assert.deepEqual(checkHeaders('https://fixture.invalid/', headers), []);
});
test('does not accept report-only CSP, max-age zero, wildcard framing, or unsafe referrers', () => {
  const headers = { ...safeHeaders, 'strict-transport-security': 'max-age=0', 'content-security-policy': "default-src 'self'; frame-ancestors *", 'referrer-policy': 'no-referrer, unsafe-url', 'x-content-type-options': 'sniff' };
  assert.deepEqual(checkHeaders('https://fixture.invalid/', headers).map((item) => item.type), ['header_hsts', 'header_framing', 'header_nosniff', 'header_referrer']);
  delete headers['content-security-policy'];
  headers['content-security-policy-report-only'] = "default-src 'self'";
  assert.ok(checkHeaders('https://fixture.invalid/', headers).some((item) => item.type === 'header_csp'));
});

for (const [platform, host, marker] of [
  ['Lovable', 'sample.lovable.app', 'lovable-tagger'], ['Bolt', 'sample.bolt.host', 'bolt.new'],
  ['Replit', 'sample.replit.app', '@replit/plugin'], ['Vercel', 'sample.vercel.app', '/_vercel/insights'],
  ['Netlify', 'sample.netlify.app', 'netlify-identity'],
]) {
  test(`recognizes ${platform} hostname and bundle clues`, () => {
    assert.ok(detectPlatforms(`https://${host}`, []).includes(platform));
    assert.ok(detectPlatforms('https://fixture.invalid', [marker]).includes(platform));
  });
}
test('recognizes Supabase and Firebase without performing Firebase rule checks', () => {
  assert.deepEqual(detectPlatforms('https://fixture.invalid', ['@supabase/supabase-js', 'firebase/app']), ['Supabase', 'Firebase']);
  assert.deepEqual(detectPlatforms('https://fixture.invalid', []), []);
});

test('validates sensitive file formats and rejects SPA fallback HTML', () => {
  const files = { '/.env': 'DATABASE_PASSWORD=fixture-only\n', '/.env.local': 'export APP_MODE=fixture\n', '/.git/config': '[core]\nrepositoryformatversion = 0\n', '/.git/HEAD': 'ref: refs/heads/fixture\n' };
  for (const [file, body] of Object.entries(files)) {
    assert.equal(sensitiveFileLooksReal(file, body, 'text/plain'), true);
    assert.equal(sensitiveFileLooksReal(file, '<!doctype html><html>APP_MODE=fixture</html>', 'text/html'), false);
    assert.equal(sensitiveFileLooksReal(file, 'not a config', 'text/plain'), false);
  }
});
test('requires an actual version-three source map, not SPA fallback or arbitrary JSON', () => {
  assert.equal(sourceMapLooksReal(JSON.stringify({ version: 3, sources: ['app.js'], mappings: '' })), true);
  for (const body of ['<html>fallback</html>', '{}', '{"version":2}', '{"version":3}']) assert.equal(sourceMapLooksReal(body), false);
});
test('grades by worst finding and keeps public key information at A', () => {
  for (const [severity, grade] of [['嚴重', 'F'], ['高', 'D'], ['中', 'C'], ['低', 'B'], ['資訊', 'A']]) assert.equal(gradeReport([{ severity }]).grade, grade);
  assert.equal(gradeReport([]).grade, 'A');
});
