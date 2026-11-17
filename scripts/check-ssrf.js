import http from 'node:http';
import { createApp } from '../src/app.js';

if (process.env.ALLOW_PRIVATE_TARGETS !== undefined) {
  console.error('請先移除 ALLOW_PRIVATE_TARGETS 環境變數，再執行預設 SSRF 防護驗證。');
  process.exitCode = 1;
} else {
  const server = http.createServer(createApp());
  let passed = 0;
  let failed = 0;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const url of ['http://127.0.0.1', 'http://169.254.169.254', 'http://10.0.0.1']) {
      const response = await fetch(`${origin}/api/scans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (response.status === 403 && body.error?.code === 'SSRF_BLOCKED') { passed += 1; console.log(`通過：${url} 在連線前遭 SSRF 防護阻擋。`); }
      else { failed += 1; console.error(`失敗：${url} 未傳回預期的拒絕結果。`); }
    }
  } catch { failed += 1; console.error('失敗：無法完成 SSRF 防護驗證。'); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    console.log(`驗證結果：通過 ${passed} 項，失敗 ${failed} 項。`);
    if (failed) process.exitCode = 1;
  }
}
