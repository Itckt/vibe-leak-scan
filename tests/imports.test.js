import test from 'node:test';
import assert from 'node:assert/strict';
import { extractImports } from '../src/imports.js';
import { readHtml } from '../src/html.js';
import { scan } from '../src/scanner.js';
import { allowPrivate, localServer } from './helpers.js';

const base = 'https://fixture.invalid/assets/app.js';
for (const [name, code, paths] of [
  ['default and named static imports', 'import x from "./one.js"; import { y } from "./two.js";', ['./one.js', './two.js']],
  ['side effect imports', 'import "./one.js";', ['./one.js']],
  ['reexports', 'export {a} from "./one.js";export * from "./two.js";', ['./one.js', './two.js']],
  ['literal dynamic imports', 'import("./one.js");import(\'./two.js\');', ['./one.js', './two.js']],
  ['minified syntax', 'import{a as b}from"./one.js";export{b}from"./two.js";import("./three.js")', ['./one.js', './two.js', './three.js']],
  ['relative, root and absolute paths', 'import "../up.js";import "/root.js";import "https://cdn.invalid/ext.js";', ['../up.js', '/root.js', 'https://cdn.invalid/ext.js']],
  ['comments and escapes', String.raw`import/* a */(".\x2fone.js");export{a}from/* b */'./two.js';`, ['./one.js', './two.js']],
  ['static template and dynamic options', 'import(`./one.js`);import("./two.js",{with:{type:"json"}})', ['./one.js', './two.js']],
]) {
  test(`import extractor: ${name}`, () => {
    assert.deepEqual(extractImports(code, base), { urls: paths.map((path) => new URL(path, base).href), unresolved: false });
  });
}

test('bare names and nonliteral loads are skipped with a combined unresolved flag', () => {
  const result = extractImports('import x from "react";export{y}from"package/sub";import(path);import("./"+name);import(`./${name}`);import "data:text/plain,1";import "./ok.js";', base);
  assert.deepEqual(result, { urls: ['https://fixture.invalid/assets/ok.js'], unresolved: true });
});

test('import extractor deduplicates normalized URLs and strips fragments', () => {
  assert.deepEqual(extractImports('import "./one.js";import("./one.js#two");export{a}from"../assets/one.js";', base), { urls: ['https://fixture.invalid/assets/one.js'], unresolved: false });
});

test('unfinished literals and malformed URLs produce an unresolved flag', () => {
  for (const code of ['import("./unfinished', 'import "https://[";', String.raw`import("./escaped\"`]) {
    assert.equal(extractImports(code, base).unresolved, true);
  }
});

test('HTML modulepreloads resolve against the document base and deduplicate', () => {
  const html = readHtml('<head><base href="/modules/"><link rel="MODULEPRELOAD" href="./one.js"><link rel="modulepreload" href="./one.js"><link rel="stylesheet" href="no.css"></head>', base);
  assert.deepEqual(html.modulepreloads, ['https://fixture.invalid/modules/one.js']);
});

async function graph(t, routes, headers = {}) {
  allowPrivate(t);
  const requests = [];
  const site = await localServer((req, res) => {
    requests.push(req.url);
    const route = routes[req.url] || { body: 'missing', status: 404 };
    res.writeHead(route.status ?? 200, { 'Content-Type': route.type || (req.url === '/' ? 'text/html' : 'application/javascript'), ...headers });
    res.end(route.body);
  });
  t.after(site.close);
  return { report: await scan({ url: site.origin }), requests };
}

test('scanner follows preload, inline import and cyclic minified reexports exactly once', async (t) => {
  const { report, requests } = await graph(t, {
    '/': { body: '<head><base href="/js/"><link rel="modulepreload" href="./pre.js"></head><body><script type="module" src="./app.js"></script><script type="module">import "./inline.js"</script></body>' },
    '/js/app.js': { body: 'import{a}from"./pre.js";import("./nested/chunk.js");' },
    '/js/pre.js': { body: 'export{b}from"./app.js";' },
    '/js/inline.js': { body: 'import "./pre.js";' },
    '/js/nested/chunk.js': { body: 'import "../app.js#again";' },
  });
  assert.equal(report.coverage.scripts, 4);
  assert.equal(report.coverage.importedScripts, 3);
  assert.equal(new Set(requests).size, requests.length);
  assert.equal(report.notices.length, 0);
  assert.match(report.limitations, /不執行.*不解析 import map/);
});

test('scanner follows five import edges and reports omitted deeper files', async (t) => {
  const routes = { '/': { body: '<script src="/0.js"></script>' } };
  for (let i = 0; i < 8; i++) routes[`/${i}.js`] = { body: `import "./${i + 1}.js";` };
  const { report, requests } = await graph(t, routes);
  assert.equal(report.coverage.scripts, 6);
  assert.equal(report.coverage.importedScripts, 5);
  assert.ok(!requests.includes('/6.js'));
  assert.ok(report.notices.some((notice) => notice.includes('五層')));
});

test('all script sources share the thirty-file ceiling and report omissions', async (t) => {
  const routes = {
    '/': { body: '<script src="/app.js"></script><link rel="modulepreload" href="/pre.js">' },
    '/app.js': { body: Array.from({ length: 35 }, (_, i) => `import "./${i}.js";`).join('') },
    '/pre.js': { body: '' },
  };
  for (let i = 0; i < 35; i++) routes[`/${i}.js`] = { body: 'export const a=1;' };
  const { report, requests } = await graph(t, routes);
  assert.equal(report.coverage.scripts, 30);
  assert.equal(report.coverage.importedScripts, 29);
  assert.equal(requests.length, 31);
  assert.ok(report.notices.some((notice) => notice.includes('三十')));
});

test('HTML fallback and non-200 imports are silently skipped and never followed', async (t) => {
  const { report, requests } = await graph(t, {
    '/': { body: '<script src="/app.js"></script>' },
    '/app.js': { body: 'import "./fallback.js";import "./missing.js";import "./wrong-type.js";' },
    '/fallback.js': { body: '<!doctype html><script>import "./never.js"</script>', type: 'application/javascript' },
    '/wrong-type.js': { body: 'import "./never.js";', type: 'text/html' },
    '/missing.js': { body: 'import "./never.js";', status: 404 },
  });
  assert.equal(report.coverage.scripts, 1);
  assert.equal(report.coverage.importedScripts, 0);
  assert.equal(report.notices.length, 0);
  assert.ok(!requests.includes('/never.js'));
});

test('unresolved imports across files result in one notice, while resolvable loads continue', async (t) => {
  const { report, requests } = await graph(t, {
    '/': { body: '<script src="/app.js"></script>' },
    '/app.js': { body: 'import "react";import(name);import "./ok.js";' },
    '/ok.js': { body: 'import "bare";import(`./${value}`);' },
  });
  assert.equal(report.notices.length, 1);
  assert.match(report.notices[0], /裸模組名.*非字面值.*未被檢查/);
  assert.deepEqual(requests, ['/', '/app.js', '/ok.js']);
});

test('an imported file over 5 MB is rejected and reported', async (t) => {
  const { report } = await graph(t, {
    '/': { body: '<script src="/app.js"></script>' },
    '/app.js': { body: 'import "./large.js";' },
    '/large.js': { body: 'x'.repeat(5_000_001) },
  });
  assert.equal(report.coverage.scripts, 1);
  assert.ok(report.notices.some((notice) => notice.includes('安全限制')));
});

test('imported files share the 25 MB scan budget', async (t) => {
  const routes = { '/': { body: '<script src="/app.js"></script>' }, '/app.js': { body: Array.from({ length: 6 }, (_, i) => `import "./${i}.js";`).join('') } };
  for (let i = 0; i < 6; i++) routes[`/${i}.js`] = { body: 'x'.repeat(4_999_000) };
  const { report, requests } = await graph(t, routes);
  assert.equal(report.coverage.scripts, 6);
  assert.equal(requests.length, 8);
  assert.ok(report.notices.some((notice) => notice.includes('安全限制')));
});

test('import requests are revalidated by the SSRF guard before connecting', async (t) => {
  allowPrivate(t);
  const requests = [];
  const site = await localServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<script src="/app.js"></script>');
    } else {
      // Only the local entry resource is allowed; imported loopback targets must now fail.
      delete process.env.ALLOW_PRIVATE_TARGETS;
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end('import "./blocked.js";');
    }
  });
  t.after(site.close);
  const report = await scan({ url: site.origin });
  assert.deepEqual(requests, ['/', '/app.js']);
  assert.equal(report.coverage.scripts, 1);
  assert.ok(report.notices.some((notice) => notice.includes('安全限制')));
});
