import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the actual report renderer with a small DOM double, forbidding HTML insertion.
class Element {
  textContent = '';
  children = [];
  nodes = new Map();
  dataset = {};
  attributes = {};
  classList = { add() {} };
  set innerHTML(_value) { throw new Error('HTML insertion is forbidden'); }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener() {}
  setAttribute(key, value) { this.attributes[key] = value; }
  cloneNode() { return new Element(); }
}

async function render(report) {
  const document = new Element();
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.createElement = () => new Element();
  document.querySelector('#finding-template').content = { firstElementChild: new Element() };
  const source = (await readFile(new URL('../public/report.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  let controlsReport;
  await vm.runInNewContext(source, {
    document, request: async () => report, copyText() {},
    setupPromptControls: (value) => { controlsReport = value; },
    location: { pathname: `/report/${'a'.repeat(32)}` },
  });
  assert.equal(document.querySelector('#report-status').hidden, true, document.querySelector('#report-status').textContent);
  assert.equal(document.querySelector('#report-content').hidden, false);
  assert.equal(controlsReport, report);
  return document;
}

const base = {
  target: 'https://fixture.invalid/', grade: 'C', summary: '測試', createdAt: '2026-01-01',
  mode: '被動掃描', ownershipVerified: false, platforms: ['GitHub Pages'], notices: [], databaseChecks: [],
  coverage: { scripts: 3, importedScripts: 2, inlineScripts: 0, sourceMaps: 0, bytes: 1000 },
  limitations: '不執行程式，不解析 import map。',
};

test('report renders import coverage and platform markers as text without changing severity', async () => {
  const document = await render({ ...base, findings: [{
    type: 'header_nosniff', severity: '低', title: '缺少內容類型保護',
    platformLimit: 'GitHub Pages 不支援自訂 HTTP 回應 header。',
    fix: '<meta> 不能取代 HTTP header。',
  }] });
  assert.match(document.querySelector('#report-coverage').textContent, /3 個外部程式檔案（其中 2 個/);
  const card = document.querySelector('#findings').children[0];
  assert.equal(card.dataset.severity, '低');
  assert.equal(card.querySelector('.severity-badge').textContent, '低');
  assert.equal(card.querySelector('.finding-top').children[0].textContent, '平台限制');
  assert.equal(card.querySelector('.finding-fix').textContent, '<meta> 不能取代 HTTP header。');
});

test('old report without new coverage or platform fields still renders', async () => {
  const report = structuredClone(base);
  delete report.coverage.importedScripts;
  report.findings = [{ type: 'header_nosniff', severity: '低', prompt: '舊指令', fix: '舊建議' }];
  const document = await render(report);
  assert.match(document.querySelector('#report-coverage').textContent, /其中 0 個/);
  assert.equal(document.querySelector('#findings').children[0].querySelector('.finding-top').children.length, 0);
});
