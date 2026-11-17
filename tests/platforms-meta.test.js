import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHeaders, detectPlatforms, gradeReport } from '../src/checks.js';
import { readHtml } from '../src/html.js';
import { buildPrompt, buildFixPlan, TOOLS } from '../src/prompts.js';
import { scan } from '../src/scanner.js';
import { allowPrivate, localServer } from './helpers.js';

const url = 'https://fixture.invalid/';
const types = (html, headers = {}) => checkHeaders(url, headers, readHtml(html, url).meta).map((item) => item.type);

test('GitHub Pages detection accepts github.io subdomains and custom-domain Server header', () => {
  assert.ok(detectPlatforms('https://owner.github.io/project/', []).includes('GitHub Pages'));
  assert.ok(detectPlatforms(url, [], { Server: 'GitHub.com' }).includes('GitHub Pages'));
  assert.ok(detectPlatforms(url, [], { server: 'github.com' }).includes('GitHub Pages'));
  for (const host of ['https://github.io/', 'https://github.io.evil.invalid/', 'https://notgithub.io/']) {
    assert.ok(!detectPlatforms(host, ['GitHub.com owner.github.io']).includes('GitHub Pages'));
  }
  assert.ok(!detectPlatforms(url, [], { server: 'GitHub.com.invalid' }).includes('GitHub Pages'));
});

test('valid head meta CSP and referrer satisfy the checks, but meta framing does not', () => {
  const findings = types('<head><meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; frame-ancestors &#39;none&#39;"><meta name="referrer" content="strict-origin-when-cross-origin"></head>');
  assert.ok(!findings.includes('header_csp'));
  assert.ok(!findings.includes('header_referrer'));
  assert.ok(findings.includes('header_framing'));
});

test('meta script-src works; meta-only frame-ancestors is not a valid script policy', () => {
  assert.ok(!types('<head><meta http-equiv="CONTENT-SECURITY-POLICY" content="script-src &#39;self&#39;"></head>').includes('header_csp'));
  const findings = types('<head><meta http-equiv="Content-Security-Policy" content="frame-ancestors &#39;none&#39;"></head>');
  assert.ok(findings.includes('header_csp'));
  assert.ok(findings.includes('header_framing'));
});

test('body, template and commented meta policies are ignored', () => {
  const meta = '<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;"><meta name="referrer" content="no-referrer">';
  for (const html of [`<head></head><body>${meta}</body>`, `<head><template>${meta}</template></head>`, `<head><!--${meta}--></head>`]) {
    assert.ok(types(html).includes('header_csp'));
    assert.ok(types(html).includes('header_referrer'));
  }
});

test('HSTS, nosniff and framing protections remain HTTP-header-only', () => {
  const html = '<head><meta http-equiv="Strict-Transport-Security" content="max-age=31536000"><meta http-equiv="X-Content-Type-Options" content="nosniff"><meta http-equiv="X-Frame-Options" content="DENY"></head>';
  for (const type of ['header_hsts', 'header_nosniff', 'header_framing']) assert.ok(types(html).includes(type));
  const findings = types(html, { 'Strict-Transport-Security': 'max-age=31536000', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'" });
  for (const type of ['header_hsts', 'header_nosniff', 'header_framing', 'header_csp']) assert.ok(!findings.includes(type));
});

test('meta referrer uses existing valid-value checks and ignores invalid overrides', () => {
  for (const policy of ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'origin', 'origin-when-cross-origin']) {
    assert.ok(!types(`<head><meta name="referrer" content="${policy}"></head>`).includes('header_referrer'));
  }
  for (const policy of ['', 'unknown', 'unsafe-url', 'no-referrer-when-downgrade']) {
    assert.ok(types(`<head><meta name="referrer" content="${policy}"></head>`).includes('header_referrer'));
  }
  assert.ok(!types('<head><meta name="referrer" content="unknown"></head>', { 'Referrer-Policy': 'no-referrer' }).includes('header_referrer'));
  assert.ok(types('<head><meta name="referrer" content="unsafe-url"></head>', { 'Referrer-Policy': 'no-referrer' }).includes('header_referrer'));
});

test('confirmed GitHub Pages receives appropriate advice and markers without changing severity or grade', () => {
  const plain = checkHeaders(url, {});
  const github = checkHeaders(url, {}, {}, ['GitHub Pages']);
  assert.deepEqual(github.map(({ type, severity }) => ({ type, severity })), plain.map(({ type, severity }) => ({ type, severity })));
  assert.deepEqual(gradeReport(github), gradeReport(plain));
  for (const item of github) {
    if (['header_framing', 'header_nosniff', 'header_hsts'].includes(item.type)) {
      assert.match(item.platformLimit, /GitHub Pages.*不支援.*風險仍然存在/);
      assert.match(item.fix, /CDN.*代理.*託管/);
    } else {
      assert.equal(item.platformLimit, undefined);
      assert.match(item.fix, /<meta /);
    }
  }
  for (const platforms of [[], ['Vercel'], ['Netlify'], ['Lovable']]) {
    const findings = checkHeaders(url, {}, {}, platforms);
    assert.ok(findings.every((item) => !item.platformLimit && !item.fix.includes('GitHub Pages')));
  }
});

for (const tool of TOOLS) {
  for (const type of ['header_csp', 'header_referrer', 'header_framing', 'header_nosniff', 'header_hsts']) {
    test(`GitHub Pages ${type} gives grounded ${tool} guidance`, () => {
      const item = checkHeaders(url, {}, {}, ['GitHub Pages']).find((item) => item.type === type);
      const prompt = buildPrompt(item, tool, ['GitHub Pages', 'Vercel', 'Netlify']);
      assert.match(prompt, /GitHub Pages 不支援自訂 HTTP 回應 header/);
      assert.ok(!prompt.includes('vercel.json') && !prompt.includes('_headers'));
      for (const part of ['背景', '目標', '步驟', '不要做', '驗收']) assert.ok(prompt.includes(`${part}\n`));
      if (type === 'header_csp') {
        assert.match(prompt, /先盤點.*實際.*資源/);
        assert.match(prompt, /<meta http-equiv="Content-Security-Policy" content="依實際資源填寫政策">/);
        assert.match(prompt, /不要套用萬用政策/);
        assert.match(prompt, /frame-ancestors、report-uri 或 sandbox.*忽略/);
      } else if (type === 'header_referrer') {
        assert.match(prompt, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
        assert.match(prompt, /<head>/);
      } else {
        assert.match(prompt, /平台限制/);
        assert.match(prompt, /CDN 或代理.*託管/);
        assert.match(prompt, /不要以 meta 取代/);
        assert.match(prompt, /明確列為未修復/);
      }
      assert.ok(!buildPrompt(item, tool, []).includes('GitHub Pages'));
    });
  }
}

test('merged fix plan retains GitHub Pages meta guidance and platform limitations', () => {
  const plan = buildFixPlan({ platforms: ['GitHub Pages'], findings: checkHeaders(url, {}, {}, ['GitHub Pages']) }, 'generic');
  assert.match(plan, /<meta http-equiv="Content-Security-Policy"/);
  assert.match(plan, /<meta name="referrer"/);
  assert.match(plan, /CDN 或代理/);
});

test('scanner wires custom-domain platform headers and head meta into findings and prompts', async (t) => {
  allowPrivate(t);
  const site = await localServer((_req, res) => {
    res.writeHead(200, { Server: 'GitHub.com', 'Content-Type': 'text/html' });
    res.end('<head><meta http-equiv="Content-Security-Policy" content="script-src &#39;self&#39;; frame-ancestors &#39;none&#39;"><meta name="referrer" content="no-referrer"></head>');
  });
  t.after(site.close);
  const report = await scan({ url: site.origin });
  assert.ok(report.platforms.includes('GitHub Pages'));
  assert.ok(!report.findings.some((item) => ['header_csp', 'header_referrer'].includes(item.type)));
  const framing = report.findings.find((item) => item.type === 'header_framing');
  assert.ok(framing.platformLimit);
  for (const tool of TOOLS) assert.match(framing.prompts[tool], /GitHub Pages.*平台限制/s);
});
