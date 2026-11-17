import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setupPromptControls } from '../public/prompt-controls.js';
import { buildVariants, buildFixPlan, TOOLS } from '../src/prompts.js';

class Element extends EventTarget {
  textContent = '';
  value = '';
  hidden = false;
  set innerHTML(_value) { throw new Error('HTML insertion is forbidden'); }
  fire(type) { this.dispatchEvent(new Event(type)); }
}
function controls(report, getStorage) {
  const select = new Element();
  const copyPlan = new Element();
  const planFallback = new Element();
  planFallback.hidden = true;
  const planText = new Element();
  const cards = report.findings.map(() => {
    const nodes = Object.fromEntries(['.prompt-text', '.manual-step', '.copy-prompt'].map((name) => [name, new Element()]));
    return { querySelector: (name) => nodes[name] };
  });
  const copied = [];
  setupPromptControls(report, { select, copyPlan, planFallback, planText, cards, getStorage, copy: (value) => copied.push(value) });
  return { select, copyPlan, cards, copied };
}
const finding = { type: 'secret_openai', severity: '嚴重', title: 'OpenAI 私密金鑰公開', evidence: 'sk-dem…0000', source: 'https://fixture.invalid/app.js' };
const current = { ...finding, ...buildVariants(finding) };

test('selection updates every prompt and both copy actions, and persists the choice', () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  const report = { platforms: ['Lovable'], findings: [current, current] };
  const ui = controls(report, () => storage);
  assert.equal(ui.select.value, 'lovable');
  for (const tool of TOOLS) {
    ui.select.value = tool;
    ui.select.fire('change');
    for (const card of ui.cards) {
      assert.equal(card.querySelector('.prompt-text').textContent, current.prompts[tool]);
      assert.equal(card.querySelector('.manual-step').textContent, current.manualStep);
      assert.equal(card.querySelector('.manual-step').hidden, false);
      card.querySelector('.copy-prompt').fire('click');
      assert.equal(ui.copied.at(-1), current.prompts[tool]);
    }
    ui.copyPlan.fire('click');
    assert.equal(ui.copied.at(-1), buildFixPlan(report, tool));
    assert.equal(data.get('laumlau-tool'), tool);
  }
  assert.equal(controls(report, () => storage).select.value, 'generic');
});

test('storage getter, read and write failures do not prevent rendering or tool changes', () => {
  const fail = () => { throw new Error('Storage unavailable'); };
  for (const getStorage of [fail, () => ({ getItem: fail, setItem: fail })]) {
    const ui = controls({ platforms: ['Bolt'], findings: [current] }, getStorage);
    assert.equal(ui.select.value, 'bolt');
    ui.select.value = 'agent';
    ui.select.fire('change');
    assert.equal(ui.cards[0].querySelector('.prompt-text').textContent, current.prompts.agent);
  }
});

test('legacy reports display and copy original prompts for every tool, without empty manual notices', () => {
  const legacy = { type: 'source_map', severity: '中', prompt: '舊版修復指令 <script>不執行</script>' };
  const ui = controls({ findings: [legacy], platforms: [] }, () => ({ getItem: () => 'invalid', setItem() {} }));
  for (const tool of TOOLS) {
    ui.select.value = tool;
    ui.select.fire('change');
    const card = ui.cards[0];
    assert.equal(card.querySelector('.prompt-text').textContent, legacy.prompt);
    assert.equal(card.querySelector('.manual-step').hidden, true);
    card.querySelector('.copy-prompt').fire('click');
    assert.equal(ui.copied.at(-1), legacy.prompt);
    ui.copyPlan.fire('click');
    assert.ok(ui.copied.at(-1).includes(legacy.prompt));
  }
});

test('report markup puts manual notice above copy action and plan button at the top', async () => {
  const html = await readFile(new URL('../public/report.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="copy-plan"') < html.indexOf('class="report-overview"'));
  assert.ok(html.indexOf('class="manual-step') < html.indexOf('class="button copy-prompt"'));
  for (const tool of TOOLS) assert.ok(html.includes(`value="${tool}"`));
  for (const file of ['report.js', 'prompt-controls.js']) {
    const source = await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8');
    assert.ok(!source.includes('innerHTML'));
  }
});
