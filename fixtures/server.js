import { createFixture } from './site.js';

const fixture = await createFixture({ port: Number(process.env.FIXTURE_PORT || 4173), verificationToken: process.env.FIXTURE_VERIFICATION_TOKEN || '', verificationMethod: process.env.FIXTURE_VERIFICATION_METHOD === 'file' ? 'file' : 'meta' });
console.log(`本機測試網站已啟動：${fixture.origin}`);
console.log('這個網站刻意包含假密鑰與錯誤設定，只供本機測試。');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await fixture.close(); });
