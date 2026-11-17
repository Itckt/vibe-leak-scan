import http from 'node:http';
import { fixtureKeys } from './keys.js';

export async function createFixture({ port = 0, verificationToken = '', verificationMethod = 'meta', openApi = true, spaFallback = false, redirectProof = false } = {}) {
  const keys = fixtureKeys();
  const requests = [];
  const rowValues = ['ROW_VALUE_' + 'NEVER_STORE_9726', 'fixture-person' + '@example.invalid'];
  let token = verificationToken;
  let method = verificationMethod;
  let origin;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    // Record only method, path, and whether a privileged key was sent. Never retain headers.
    requests.push({ method: req.method, path: url.pathname, query: url.search, userAgent: req.headers['user-agent'], privileged: [keys.supabase_service_role, keys.supabase_secret].includes(req.headers.apikey) });
    const send = (body, type = 'text/plain', status = 200) => { res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` }); res.end(body); };
    const home = () => `<!doctype html><html lang="zh-Hant"><head><title>本機安全測試網站</title>${token && method === 'meta' ? `<meta name="laumlau-verify" content="${token}">` : ''}<script>window.fixturePublicKey = "${keys.google}";</script></head><body><h1>故意保留問題的本機測試網站</h1><p>所有憑證都是假的，只供本機測試。</p><script type="module" src="/assets/app.js"></script></body></html>`;
    if (url.pathname === '/') return send(home(), 'text/html');
    if (url.pathname === '/assets/app.js') {
      const values = Object.entries(keys).filter(([name]) => !['openai', 'anthropic'].includes(name)).map(([, value]) => `String.raw\`${value}\``).join(',\n');
      const script = `// Local fixture only: intentionally fake credentials.\nconst fixtureLeaks = [${values}];\nfunction createClient() { return { from() {} }; }\nconst supabase = createClient("${origin}", "${keys.supabase_anon}");\nsupabase.from("profiles");\nconst library = "@supabase/supabase-js";\nconst hosting = "lovable-tagger";\nconst backend = "firebase/app";\n//# sourceMappingURL=app.js.map`;
      return send(`import "./chunk.js";\n${script}`, 'application/javascript');
    }
    if (url.pathname === '/assets/chunk.js') return send(`const key = "${keys.openai}"; import("./nested.js");`, 'application/javascript');
    if (url.pathname === '/assets/nested.js') return send(`const key = "${keys.anthropic}";`, 'application/javascript');
    if (url.pathname === '/assets/app.js.map') return send(JSON.stringify({ version: 3, sources: ['src/app.js'], names: [], mappings: 'AAAA', sourcesContent: ['// Deliberately public fixture source.'] }), 'application/json');
    if (url.pathname === '/.well-known/laumlau-verify.txt') {
      if (redirectProof) { res.writeHead(302, { Location: '/proof.txt' }); return res.end(); }
      return token && method === 'file' ? send(token) : send('未找到驗證檔案', 'text/plain', 404);
    }
    if (url.pathname === '/proof.txt') return send(token);
    if (['/.env', '/.env.local', '/.git/config', '/.git/HEAD'].includes(url.pathname)) {
      if (spaFallback) return send(home(), 'text/html');
      const contents = {
        '/.env': `APP_ENV=fixture\nSERVER_API_KEY=${keys.openai}\n`,
        '/.env.local': `LOCAL_TEST=true\nMAIL_KEY=${keys.resend}\n`,
        '/.git/config': '[core]\n repositoryformatversion = 0\n bare = false\n',
        '/.git/HEAD': 'ref: refs/heads/fixture\n',
      };
      return send(contents[url.pathname]);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (req.method !== 'GET') return send('只允許讀取', 'text/plain', 405);
      if (req.headers.apikey !== keys.supabase_anon) return send('{}', 'application/json', 401);
      if (url.pathname === '/rest/v1/') return openApi
        ? send(JSON.stringify({ swagger: '2.0', paths: { '/profiles': { get: {} }, '/empty_table': { get: {} }, '/protected_table': { get: {} }, '/rpc/do_not_call': { post: {} } } }), 'application/json')
        : send('{}', 'application/json', 403);
      if (url.searchParams.get('limit') !== '1' || url.searchParams.get('select') !== '*') return send('{}', 'application/json', 400);
      if (url.pathname === '/rest/v1/profiles') return send(JSON.stringify([{ id: rowValues[0], email: rowValues[1] }]), 'application/json');
      if (url.pathname === '/rest/v1/empty_table') return send('[]', 'application/json');
      if (url.pathname === '/rest/v1/protected_table') return send('{}', 'application/json', 403);
    }
    send('找不到測試資源', 'text/plain', 404);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, keys, rowValues, requests,
    setVerificationToken(value, type = method) { token = value; method = type; },
    close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); }),
  };
}
