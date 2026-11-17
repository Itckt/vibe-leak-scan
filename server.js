import { createApp } from './src/app.js';
import { readRuntimeConfig } from './src/runtime.js';

const { port, host, publicOrigin } = readRuntimeConfig();
const server = createApp({ publicOrigin }).listen(port, host, () => {
  console.log(publicOrigin ? '漏唔漏線上試用服務已啟動。' : `漏唔漏已啟動：http://localhost:${port}`);
  if (process.env.ALLOW_PRIVATE_TARGETS === '1') console.log('本機測試模式已開啟，只應掃描你建立的測試網站。');
});
server.on('error', () => { console.error('無法啟動服務，請檢查連接埠是否已被使用。'); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
