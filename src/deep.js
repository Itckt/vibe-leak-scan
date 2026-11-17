import { safeFetch, parseTarget } from './network.js';
import { detectSecrets, decodeJwt, displayUrl } from './secrets.js';
import { finding, sensitiveFileLooksReal } from './checks.js';

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
export const MAX_TABLES = 100;
export const MAX_PROJECTS = 5;

export function discoverSupabase(sources) {
  const projects = new Map();
  const fallbackTables = new Set();
  const add = (rawUrl, key) => {
    try {
      const url = parseTarget(rawUrl);
      if (url.pathname !== '/' || url.search) return;
      const kind = detectSecrets(key).find((item) => item.value === key)?.type;
      if (!['supabase_anon', 'supabase_publishable'].includes(kind)) return;
      const payload = decodeJwt(key);
      if (payload?.ref && /\.supabase\.(?:co|in)$/.test(url.hostname) && payload.ref !== url.hostname.split('.')[0]) return;
      if (!projects.has(url.origin)) projects.set(url.origin, { url: url.origin, key, jwt: kind === 'supabase_anon' });
    } catch { /* Only literal HTTP project URLs and public keys are eligible. */ }
  };
  for (const source of sources) {
    for (const match of source.matchAll(/\.from\(\s*["'`]([A-Za-z_][A-Za-z0-9_]{0,62})["'`]\s*\)/g)) fallbackTables.add(match[1]);
    for (const match of source.matchAll(/\bcreateClient\s*\(\s*["'`]([^"'`\r\n]+)["'`]\s*,\s*["'`]([^"'`\r\n]+)["'`]/g)) add(match[1], match[2]);
    const urls = [...new Set(source.match(/https:\/\/[a-z0-9-]+\.supabase\.(?:co|in)\b/g) || [])];
    const publicKeys = detectSecrets(source).filter((item) => ['supabase_anon', 'supabase_publishable'].includes(item.type));
    for (const key of publicKeys) {
      const ref = decodeJwt(key.value)?.ref;
      const matched = ref ? urls.filter((url) => new URL(url).hostname.split('.')[0] === ref) : urls.length === 1 ? urls : [];
      if (matched.length === 1) add(matched[0], key.value);
    }
  }
  return { projects: [...projects.values()], fallbackTables: [...fallbackTables] };
}

export async function checkSensitiveFiles(origin, budget, addNotice) {
  const findings = [];
  for (const path of ['/.env', '/.env.local', '/.git/config', '/.git/HEAD']) {
    try {
      const result = await safeFetch(`${origin}${path}`, { budget, allowedOrigin: origin });
      if (result.status === 200 && sensitiveFileLooksReal(path, result.body, result.headers['content-type'])) {
        findings.push(finding('sensitive_file', '嚴重', '敏感檔案可被公開下載', `網站公開了 ${path}，內容符合這類設定檔的格式。`, '環境設定或版本控制資訊可能包含憑證、內部位置及原始碼線索。', '移除公開目錄中的環境設定與版本控制檔案，在伺服器封鎖相關路徑；若含有憑證，立即撤銷並更換。', { source: displayUrl(`${origin}${path}`), file: path }));
      } else if (result.status >= 500) addNotice('部分敏感檔案檢查遇到網站錯誤，未能完成。');
    } catch { addNotice('部分敏感檔案無法讀取或超出安全限制，未能完成檢查。'); }
  }
  return findings;
}

export async function checkSupabase(sources, budget, addNotice) {
  const { projects, fallbackTables } = discoverSupabase(sources);
  const findings = [];
  const checked = [];
  if (!projects.length) {
    addNotice('未找到可明確配對的 Supabase 專案網址與匿名或公開發佈密鑰，未執行資料權限檢查。');
    return { findings, checked };
  }
  if (projects.length > MAX_PROJECTS) addNotice('Supabase 專案超出五個的安全上限，其餘專案未檢查。');
  for (const project of projects.slice(0, MAX_PROJECTS)) {
    const headers = { apikey: project.key, Accept: 'application/json' };
    if (project.jwt) headers.Authorization = `Bearer ${project.key}`;
    const options = { budget, allowedOrigin: project.url, headers };
    let tables = [];
    let schemaRead = false;
    try {
      const schema = await safeFetch(`${project.url}/rest/v1/`, { ...options, headers: { ...headers, Accept: 'application/openapi+json' } });
      if (schema.status === 200) {
        const document = JSON.parse(schema.body);
        if ((document.swagger || document.openapi) && document.paths && typeof document.paths === 'object' && !Array.isArray(document.paths)) {
          schemaRead = true;
          const paths = Object.keys(document.paths).filter((path) => path !== '/' && !path.startsWith('/rpc/'));
          tables = paths.filter((path) => /^\/[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(path) && document.paths[path]?.get).map((path) => path.slice(1));
          if (paths.some((path) => !/^\/[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(path))) addNotice('部分資料表名稱不符合安全的識別字格式，已略過。');
        }
      }
    } catch { /* Fall back to literal table names without retaining the schema body. */ }
    if (!schemaRead || !tables.length) {
      tables = fallbackTables;
      addNotice('無法由 OpenAPI 完整列出資料表，已改用程式中明確出現的資料表名稱。');
    }
    tables = [...new Set(tables)];
    if (!tables.length) addNotice('沒有可檢查的資料表名稱，無法判斷 Supabase 的匿名讀取權限。');
    if (tables.length > MAX_TABLES) addNotice('資料表超出每個專案一百個的安全上限，其餘資料表未檢查。');
    for (const table of tables.slice(0, MAX_TABLES)) {
      try {
        const result = await safeFetch(`${project.url}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`, options);
        if ([401, 403].includes(result.status)) { checked.push({ project: displayUrl(project.url), table, result: '此匿名請求被拒絕' }); continue; }
        if (result.status !== 200 && result.status !== 206) { addNotice('部分資料表無法完成匿名讀取檢查。'); continue; }
        const rows = JSON.parse(result.body);
        if (!Array.isArray(rows)) { addNotice('資料表回應格式不符合預期，未能判斷匿名權限。'); continue; }
        if (rows.length && rows[0] && typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
          // Never copy, serialize, interpolate, or log any row value.
          const columns = Object.keys(rows[0]).filter((name) => SAFE_IDENTIFIER.test(name)).slice(0, 100);
          findings.push(finding('supabase_anonymous_read', '嚴重', '匿名訪客可讀取資料表', `以公開密鑰讀到了「${table}」的資料。報告只保留資料表與欄位名稱。`, '資料可能刻意公開，也可能是 RLS 未啟用或政策過寬；僅憑這次讀取無法確定原因，應立即核對資料用途。', `確認「${table}」的公開用途；啟用 RLS、撤銷不必要的匿名 SELECT 權限，並以最小權限重寫政策及測試。`, { source: displayUrl(project.url), table, columns }));
          checked.push({ project: displayUrl(project.url), table, result: '匿名可讀取資料' });
        } else if (!rows.length) {
          checked.push({ project: displayUrl(project.url), table, result: '沒有傳回資料，無法據此證明 RLS 已啟用' });
        } else addNotice('資料列格式不符合預期，未能完成匿名權限判斷。');
      } catch { addNotice('部分資料表無法讀取或超出安全限制，未能完成權限檢查。'); }
    }
  }
  return { findings, checked };
}
