import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TOOLS, buildPrompt, buildVariants, buildFixPlan, defaultTool, manualStep, promptFor } from '../src/prompts.js';
import { SECRET_TYPES, secretFinding } from '../src/secrets.js';
import { checkHeaders } from '../src/checks.js';
import { fixtureKeys } from '../fixtures/keys.js';

const keys = fixtureKeys();
const findings = [
  ...Object.keys(SECRET_TYPES).map((type) => secretFinding({ type, value: keys[type] }, 'https://fixture.invalid/app.js')),
  ...checkHeaders('http://fixture.invalid/', {}),
  { type: 'supabase_anonymous_read', severity: '嚴重', title: '匿名訪客可讀取資料表', source: 'https://fixture.invalid/', table: 'profiles', columns: ['id', 'email'] },
  { type: 'sensitive_file', severity: '嚴重', title: '敏感檔案公開', file: '/.env', source: 'https://fixture.invalid/.env' },
  { type: 'source_map', severity: '中', title: '來源對照檔公開', source: 'https://fixture.invalid/app.js.map' },
];
const privateFinding = (f) => f.type.startsWith('secret_') && !['secret_google', 'secret_supabase_anon', 'secret_supabase_publishable'].includes(f.type);
for (const finding of findings) {
  for (const tool of TOOLS) {
    test(`${finding.type} / ${tool}: five sections, sanitized evidence, specific safety instructions`, () => {
      for (const key of Object.values(keys)) assert.ok(!JSON.stringify(finding).includes(key), 'Never pass full keys to prompts');
      const before = JSON.stringify(finding);
      const prompt = buildPrompt(finding, tool);
      assert.equal(JSON.stringify(finding), before);
      assert.equal(prompt, buildPrompt(finding, tool));
      assert.deepEqual([...prompt.matchAll(/^(背景|目標|步驟|不要做|驗收)$/gm)].map((m) => m[0]), ['背景', '目標', '步驟', '不要做', '驗收']);
      assert.ok(prompt.includes(finding.title));
      if (finding.evidence) assert.ok(prompt.includes(finding.evidence));
      if (finding.source) assert.ok(prompt.includes(finding.source));
      if (finding.table) for (const field of [finding.table, ...finding.columns]) assert.ok(prompt.includes(field));
      assert.match(prompt, /步驟\n1\. /);
      for (const key of Object.values(keys)) assert.ok(!prompt.includes(key), 'Prompts must not contain full fixture keys');
      if (privateFinding(finding)) {
        for (const warning of ['VITE_', 'NEXT_PUBLIC_', 'PUBLIC_', 'REACT_APP_', 'base64', '拆開字串', 'log', '使用者身分', '限制用量']) assert.ok(prompt.includes(warning));
        const phrases = { lovable: ['Secrets', 'Edge Function', 'Deno.env.get("名稱")'], bolt: ['Secrets', 'server function', '其他託管商'], replit: ['Secrets', '後端路由', '環境變數'], agent: ['codebase', 'server route', '.gitignore', 'git 歷史', '前端改為'], generic: ['伺服器端環境變數', '伺服器端函式'] };
        for (const phrase of phrases[tool]) assert.ok(prompt.includes(phrase));
      }
      if (finding.type === 'supabase_anonymous_read') for (const phrase of ['先詢問使用者', 'using (true)', 'auth.uid()', 'alter table', 'enable row level security', '不要刪除或修改現有資料']) assert.ok(prompt.includes(phrase));
      if (finding.type === 'secret_supabase_service_role') assert.match(prompt, /anon 或 publishable.*RLS/);
      if (finding.type === 'sensitive_file') for (const phrase of ['.gitignore', '404', '所有憑證']) assert.ok(prompt.includes(phrase));
      if (finding.type === 'source_map') for (const phrase of ['build.sourcemap', 'sourceMappingURL', '.map']) assert.ok(prompt.includes(phrase));
      if (finding.type.startsWith('header_')) assert.ok(prompt.includes('不支援自訂回應 header'));
    });
  }
}

test('variants differ meaningfully and retain generic backward compatibility', () => {
  for (const finding of findings) {
    const result = buildVariants(finding);
    assert.deepEqual(Object.keys(result.prompts), TOOLS);
    assert.equal(result.prompt, result.prompts.generic);
    assert.equal(new Set(Object.values(result.prompts)).size, 5);
    if (privateFinding(finding)) assert.ok(result.manualStep.includes('舊密鑰已經公開過'));
    else if (finding.type === 'secret_google') assert.ok(result.manualStep.includes('雲端主控台'));
    else if (finding.type !== 'sensitive_file') assert.equal(result.manualStep, undefined);
  }
});

test('header remedies name only detected hosting configurations', () => {
  const finding = findings.find((f) => f.type === 'header_hsts');
  for (const tool of TOOLS) {
    assert.ok(buildPrompt(finding, tool, ['Vercel']).includes('vercel.json'));
    assert.ok(!buildPrompt(finding, tool, ['Vercel']).includes('_headers'));
    assert.ok(buildPrompt(finding, tool, ['Netlify']).includes('_headers'));
    assert.ok(!buildPrompt(finding, tool).includes('vercel.json'));
  }
});

test('tool defaults honor valid saved choices and unambiguous detection', () => {
  assert.equal(defaultTool(['Lovable', 'Supabase']), 'lovable');
  assert.equal(defaultTool(['Bolt']), 'bolt');
  assert.equal(defaultTool(['Replit']), 'replit');
  assert.equal(defaultTool(['Lovable', 'Bolt']), 'generic');
  assert.equal(defaultTool([]), 'generic');
  assert.equal(defaultTool(['Lovable'], 'replit'), 'replit');
  assert.equal(defaultTool(['Lovable'], 'unrecognized'), 'lovable');
});

test('merged plan groups private keys, retains special steps, sorts by severity and lists manual work first', () => {
  const selected = ['source_map', 'secret_openai', 'secret_aws', 'secret_supabase_service_role', 'secret_google'];
  const items = selected.map((type) => findings.find((f) => f.type === type)).map((f) => ({ ...f, ...buildVariants(f) }));
  const plan = buildFixPlan({ findings: items, platforms: [] }, 'lovable');
  assert.ok(plan.startsWith('你要自己做\n'));
  assert.ok(plan.indexOf(manualStep(items[1])) < plan.indexOf('修復項目 1'));
  assert.ok(plan.includes('每完成一項，先報告'));
  assert.equal((plan.match(/^步驟$/gm) || []).length, 3);
  assert.ok(plan.indexOf('修復項目 1（嚴重）') < plan.indexOf('修復項目 2（中）'));
  for (const f of items) if (f.evidence) assert.ok(plan.includes(f.evidence));
  assert.ok(plan.includes('anon 或 publishable'));
  assert.ok(plan.includes('AWS 識別碼是憑證的一部分'));
  assert.ok(plan.includes('Deno.env.get'));
});

test('long plans include only critical and high findings, retain all manual notices, and disclose omissions', () => {
  const secret = findings.find((f) => f.type === 'secret_openai');
  const low = findings.find((f) => f.type === 'secret_google');
  const items = [secret, ...Array.from({ length: 70 }, (_, i) => ({ ...low, source: `https://fixture.invalid/omitted-${i}` }))].map((f) => ({ ...f, ...buildVariants(f) }));
  const plan = buildFixPlan({ findings: items }, 'agent');
  assert.ok(plan.includes('6000'));
  assert.ok(plan.includes('70 個其他問題未包含'));
  assert.ok(!plan.includes('omitted-'));
  assert.ok(plan.includes(secret.evidence));
  assert.ok(plan.includes(manualStep(low)));
  assert.ok(plan.includes('git 歷史'));
});

test('legacy prompt fallback and empty plans remain readable', () => {
  const legacy = { type: 'source_map', severity: '中', prompt: '這是舊報告的修復指令。' };
  for (const tool of TOOLS) {
    assert.equal(promptFor(legacy, tool), legacy.prompt);
    assert.ok(buildFixPlan({ findings: [legacy] }, tool).includes(legacy.prompt));
  }
  assert.ok(buildFixPlan({ findings: [] }).includes('沒有需要合併的問題'));
});

test('prompt module has no imports or ambient I/O and ignores unrelated row fields', async () => {
  const source = await readFile(new URL('../src/prompts.js', import.meta.url), 'utf8');
  assert.ok(!/\b(?:import|require|fetch|console|localStorage|process|Date)\b/.test(source));
  const finding = { ...findings.find((f) => f.type === 'supabase_anonymous_read'), rows: [{ id: 'ROW_VALUE_MUST_NOT_APPEAR' }] };
  assert.ok(!buildPrompt(finding).includes('ROW_VALUE_MUST_NOT_APPEAR'));
});
