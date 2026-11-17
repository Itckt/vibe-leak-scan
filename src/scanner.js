import { safeFetch, createBudget, parseTarget } from './network.js';
import { readHtml, isHtml } from './html.js';
import { detectSecrets, secretFinding, redactObject, displayUrl } from './secrets.js';
import { SEVERITIES, finding, checkHeaders, detectPlatforms, sourceMapLooksReal, gradeReport } from './checks.js';
import { checkSensitiveFiles, checkSupabase } from './deep.js';
import { AppError } from './errors.js';
import { buildVariants } from './prompts.js';
import { extractImports } from './imports.js';

export const MAX_SCRIPTS = 30;

export async function scan({ url: input, mode = 'passive', verificationId }, verifications) {
  const url = parseTarget(input);
  if (!['passive', 'deep'].includes(mode)) throw new AppError('INVALID_MODE', '請選擇被動掃描或深度掃描。');
  const budget = createBudget();
  // This gate lives inside the scanner as well as being enforced for every HTTP scan.
  let verifiedOrigin;
  if (mode === 'deep') {
    if (!verifications) throw new AppError('OWNERSHIP_REQUIRED', '深度掃描必須通過擁有權驗證。', 403);
    verifiedOrigin = await verifications.authorize(url.href, verificationId, budget);
  }
  const page = await safeFetch(url.href, { budget, allowedOrigin: verifiedOrigin });
  if (page.status !== 200 || !isHtml(page.body, page.headers['content-type'])) throw new AppError('NOT_HTML', '網址未傳回可掃描的 HTML 網頁。', 422);
  const html = readHtml(page.body, page.url);
  const findings = checkHeaders(page.url, page.headers, html.meta, detectPlatforms(page.url, [], page.headers));
  const notices = new Set();
  const addNotice = (message) => notices.add(message);
  const sources = [];
  const secrets = new Set();
  const secretIdentities = new Set();
  const inspectedMaps = new Set();
  let scriptCount = 0;
  let importedScripts = 0;
  let mapCount = 0;
  const inspect = (text, source) => {
    sources.push(text);
    for (const secret of detectSecrets(text)) {
      secrets.add(secret.value);
      const identity = `${secret.type}:${secret.value}`;
      if (!secretIdentities.has(identity)) {
        secretIdentities.add(identity);
        findings.push(secretFinding(secret, source));
      }
    }
  };
  const inspectMaps = async (text, source) => {
    const links = [...text.matchAll(/(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=\s*([^\s*]+)/g)].map((match) => match[1]);
    for (const link of links) {
      if (link.startsWith('data:')) continue;
      let mapUrl;
      try { mapUrl = new URL(link, source).href; } catch { continue; }
      if (inspectedMaps.has(mapUrl)) continue;
      if (inspectedMaps.size >= 30) { addNotice('來源對照檔超出三十個的安全上限，其餘檔案未檢查。'); break; }
      inspectedMaps.add(mapUrl);
      try {
        const map = await safeFetch(mapUrl, { budget });
        if (map.status === 200 && sourceMapLooksReal(map.body)) {
          mapCount += 1;
          inspect(map.body, map.url);
          findings.push(finding('source_map', '中', '原始碼對照檔可被公開下載', '公開程式引用的來源對照檔可以讀取，可能暴露原始程式結構。', '對照檔可能包含原始碼、註解或內部路徑，降低他人分析程式的難度。', '在正式環境停用公開來源對照檔，或只把檔案上傳至受保護的錯誤追蹤服務；移除公開檔案及引用。', { source: displayUrl(map.url) }));
        }
      } catch { addNotice('部分來源對照檔無法讀取或超出安全限制，未完成檢查。'); }
    }
  };
  inspect(page.body, page.url);
  const { scripts, inline, modulepreloads, baseUrl } = html;
  for (const text of inline) await inspectMaps(text, page.url);
  const queue = [];
  const queued = new Set();
  const downloaded = new Set();
  const enqueue = (source, depth, imported) => {
    try { const normalized = new URL(source); normalized.hash = ''; source = normalized.href; } catch { return; }
    if (queued.has(source) || downloaded.has(source)) return;
    if (depth > 5) { addNotice('模組匯入超出五層上限，部分檔案未被檢查。'); return; }
    if (queue.length >= MAX_SCRIPTS) { addNotice('JavaScript 檔案超出三十個的上限，部分檔案未被檢查。'); return; }
    queued.add(source);
    queue.push({ source, depth, imported });
  };
  const follow = (text, importer, depth) => {
    const imports = extractImports(text, importer);
    if (imports.unresolved) addNotice('部分載入使用裸模組名、非字面值動態 import 或無法解析的路徑；未解析 import map，這些檔案未被檢查。');
    for (const source of imports.urls) enqueue(source, depth + 1, true);
  };
  for (const source of scripts) enqueue(source, 0, false);
  for (const source of modulepreloads) enqueue(source, 0, true);
  for (const text of inline) follow(text, baseUrl, 0);
  for (const { source, depth, imported } of queue) {
    if (downloaded.has(source)) continue;
    try {
      const script = await safeFetch(source, { budget });
      if (script.status !== 200 || isHtml(script.body, script.headers['content-type'])) continue;
      if (downloaded.has(script.url)) continue;
      downloaded.add(script.url);
      scriptCount += 1;
      if (imported) importedScripts += 1;
      inspect(script.body, script.url);
      follow(script.body, script.url, depth);
      await inspectMaps(script.body, script.url);
    } catch { addNotice('部分 JavaScript 資源無法讀取或超出安全限制，未完成檢查。'); }
  }
  let databaseChecks = [];
  if (mode === 'deep') {
    findings.push(...await checkSensitiveFiles(verifiedOrigin, budget, addNotice));
    const database = await checkSupabase(sources, budget, addNotice);
    findings.push(...database.findings);
    databaseChecks = database.checked;
  }
  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const report = {
    version: 1, createdAt: new Date().toISOString(), target: displayUrl(url.href), finalTarget: displayUrl(page.url),
    mode: mode === 'deep' ? '深度掃描' : '被動掃描', ownershipVerified: mode === 'deep',
    ...gradeReport(findings), findings, platforms: detectPlatforms(page.url, sources, page.headers),
    notices: [...notices], databaseChecks,
    coverage: { scripts: scriptCount, importedScripts, inlineScripts: inline.length, sourceMaps: mapCount, bytes: budget.used },
    limitations: '此工具不執行網頁程式、不解析 import map；以保守字串掃描跟隨靜態與字面值動態 import，可能多讀取疑似引用，不能證明涵蓋所有執行時資源。密鑰偵測只驗證格式及 JWT 角色，不會呼叫服務確認有效性。評級僅反映已完成的檢查。',
  };
  // Drop raw sources at the boundary. Only this sanitized result may leave the scanner.
  const clean = redactObject(report, [...secrets]);
  clean.findings = clean.findings.map((item) => ({ ...item, ...buildVariants(item, clean.platforms) }));
  return clean;
}
