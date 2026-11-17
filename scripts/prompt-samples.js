import { buildPrompt } from '../src/prompts.js';

// These inputs are masked examples, not generated or real credentials.
console.log('Lovable：OpenAI 私密金鑰外洩\n');
console.log(buildPrompt({ type: 'secret_openai', severity: '嚴重', title: 'OpenAI 私密金鑰出現在公開資源', source: 'https://fixture.invalid/app.js', evidence: 'sk-dem…0000' }, 'lovable'));
console.log('\n程式碼代理：匿名可讀 Supabase 資料表\n');
console.log(buildPrompt({ type: 'supabase_anonymous_read', severity: '嚴重', title: '匿名訪客可讀取資料表', source: 'https://fixture.invalid/', table: 'profiles', columns: ['id', 'email'] }, 'agent'));
