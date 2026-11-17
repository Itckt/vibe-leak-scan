import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { copyText } from '../public/shared.js';
import { setupPromptControls } from '../public/prompt-controls.js';
import { buildVariants, buildFixPlan } from '../src/prompts.js';

class Element extends EventTarget {
  textContent = '';
  value = '';
  hidden = false;
  open = false;
  focus() { this.focused = true; }
  select() { this.selected = true; }
  remove() { this.removed = true; }
  set innerHTML(_value) { throw new Error('Unsafe HTML rendering'); }
  fire(type) { this.dispatchEvent(new Event(type)); }
}

function browser(t, clipboard, execCommand) {
  const inputs = [];
  const activeElement = new Element();
  const document = {
    activeElement,
    body: { append: (element) => inputs.push(element) },
    createElement: () => new Element(),
    execCommand,
    createRange: () => ({ selectNodeContents: (node) => { node.rangeSelected = true; } }),
    defaultView: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
  };
  for (const [name, value] of Object.entries({ navigator: { clipboard }, document })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return { inputs, document, activeElement };
}
const denied = async () => { throw new Error('Clipboard denied'); };
const flush = () => new Promise(setImmediate);

function reportControls(document) {
  const finding = { type: 'source_map', title: '來源對照檔公開', source: 'https://fixture.invalid/app.js.map', severity: '中' };
  const report = { platforms: ['Lovable'], findings: [{ ...finding, ...buildVariants(finding) }] };
  const select = new Element();
  const copyPlan = new Element();
  const planFallback = new Element();
  planFallback.hidden = true;
  const planText = new Element();
  const nodes = Object.fromEntries(['.prompt-text', '.manual-step', '.copy-prompt', '.prompt-panel'].map((key) => [key, Object.assign(new Element(), { ownerDocument: document })]));
  setupPromptControls(report, { select, copyPlan, planFallback, planText, cards: [{ querySelector: (key) => nodes[key] }], copy: copyText, getStorage: () => ({ getItem() {}, setItem() {} }) });
  return { report, select, copyPlan, planFallback, planText, nodes };
}

test('writeText rejection falls through to execCommand and removes the temporary textarea', async (t) => {
  let calls = 0;
  const { inputs, activeElement } = browser(t, { writeText: denied }, (command) => { assert.equal(command, 'copy'); calls += 1; return true; });
  const button = new Element();
  assert.equal(await copyText('待複製的文字', button), true);
  assert.equal(calls, 1);
  assert.equal(inputs[0].value, '待複製的文字');
  assert.equal(inputs[0].selected, true);
  assert.equal(inputs[0].removed, true);
  assert.equal(activeElement.focused, true);
  assert.equal(button.textContent, '已複製 ✓');
});

test('missing Clipboard API still uses the legacy copy method', async (t) => {
  const { inputs } = browser(t, undefined, () => true);
  assert.equal(await copyText('備援文字', new Element()), true);
  assert.equal(inputs.length, 1);
});

test('Clipboard API success avoids execCommand and temporary textareas', async (t) => {
  let copied;
  const { inputs } = browser(t, { writeText: async (value) => { copied = value; } }, () => { throw new Error('Must not run'); });
  assert.equal(await copyText('正常複製', new Element()), true);
  assert.equal(copied, '正常複製');
  assert.equal(inputs.length, 0);
});

test('all copy methods failing returns false, cleans up even on exceptions, and shows the failure message', async (t) => {
  const { inputs } = browser(t, { writeText: denied }, () => { throw new Error('Legacy method denied'); });
  const button = new Element();
  button.textContent = '複製報告連結';
  assert.equal(await copyText('http://localhost:3000/report/example', button), false);
  assert.equal(inputs[0].removed, true);
  assert.equal(button.textContent, '無法自動複製，請選取文字複製');
  t.mock.timers.tick(2500);
  assert.equal(button.textContent, '複製報告連結');
});

test('failed plan copy reveals focused selected text and keeps it updated with the selected tool', async (t) => {
  const { document } = browser(t, { writeText: denied }, () => false);
  const ui = reportControls(document);
  assert.equal(ui.planFallback.hidden, true);
  ui.copyPlan.fire('click');
  await flush();
  assert.equal(ui.planFallback.hidden, false);
  assert.equal(ui.planText.value, buildFixPlan(ui.report, 'lovable'));
  assert.equal(ui.planText.focused, true);
  assert.equal(ui.planText.selected, true);
  ui.select.value = 'agent';
  ui.select.fire('change');
  assert.equal(ui.planText.value, buildFixPlan(ui.report, 'agent'));
});

test('a delayed rejection reveals the current tool plan rather than the earlier selection', async (t) => {
  let reject;
  const { document } = browser(t, { writeText: () => new Promise((_, failure) => { reject = failure; }) }, () => false);
  const ui = reportControls(document);
  ui.copyPlan.fire('click');
  ui.select.value = 'bolt';
  ui.select.fire('change');
  reject(new Error('Denied'));
  await flush();
  assert.equal(ui.planText.value, buildFixPlan(ui.report, 'bolt'));
  assert.equal(ui.planFallback.hidden, false);
});

test('successful plan copy keeps the manual area hidden for both APIs and hides an earlier failure', async (t) => {
  let succeeds = true;
  let useModern = true;
  const { document } = browser(t, { writeText: async () => { if (!useModern || !succeeds) throw new Error('Denied'); } }, () => succeeds);
  const ui = reportControls(document);
  for (const modern of [true, false]) {
    useModern = modern;
    ui.copyPlan.fire('click');
    await flush();
    assert.equal(ui.planFallback.hidden, true);
  }
  succeeds = false;
  ui.copyPlan.fire('click');
  await flush();
  assert.equal(ui.planFallback.hidden, false);
  succeeds = true;
  ui.copyPlan.fire('click');
  await flush();
  assert.equal(ui.planFallback.hidden, true);
});

test('failed finding copy opens the disclosure and selects its visible prompt', async (t) => {
  const { document } = browser(t, { writeText: denied }, () => false);
  const ui = reportControls(document);
  ui.nodes['.copy-prompt'].fire('click');
  await flush();
  assert.equal(ui.nodes['.prompt-panel'].open, true);
  assert.equal(ui.nodes['.prompt-text'].rangeSelected, true);
  assert.equal(ui.nodes['.prompt-text'].textContent, ui.report.findings[0].prompts.lovable);
  assert.equal(ui.planFallback.hidden, true);
});

test('manual plan textarea is read-only, labelled, hidden initially and near the copy button', async () => {
  const html = await readFile(new URL('../public/report.html', import.meta.url), 'utf8');
  assert.match(html, /id="plan-fallback"[^>]*hidden/);
  assert.match(html, /<textarea id="plan-text" readonly/);
  assert.ok(html.includes('for="plan-text"'));
  assert.ok(html.indexOf('id="copy-plan"') < html.indexOf('id="plan-fallback"'));
  assert.ok(html.indexOf('id="plan-fallback"') < html.indexOf('class="report-overview"'));
});
