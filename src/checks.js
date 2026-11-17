export const SEVERITIES = ['嚴重', '高', '中', '低', '資訊'];

export function finding(type, severity, title, description, why, fix, extra = {}) {
  return { type, severity, title, description, why, fix, prompt: `請協助修復「${title}」。${fix}請提供具體修改及驗證方式，保留現有功能，避免輸出任何密鑰或個人資料。`, ...extra };
}

export function checkHeaders(url, headers, meta = {}, platforms = []) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  const results = [];
  const add = (name, severity, title, why, fix) => results.push(finding(`header_${name}`, severity, title, '網站回應缺少有效的相關保護設定。', why, fix));
  if (new URL(url).protocol !== 'https:') add('https', '高', '網站未使用 HTTPS', '傳輸內容可能被攔截或竄改。', '設定有效的 TLS 憑證，並將 HTTP 重新導向至 HTTPS。');
  if (!/\bmax-age\s*=\s*[1-9]\d*\b/i.test(normalized['strict-transport-security'] || '')) add('hsts', '中', '缺少有效的 HSTS', '瀏覽器無法記住網站必須使用加密連線。', '確認全站支援 HTTPS 後，設定 Strict-Transport-Security，並使用適當的正數 max-age。');
  const csp = normalized['content-security-policy'] || '';
  if (![csp, ...(meta.csp || [])].some((policy) => /(?:^|;)\s*(?:default-src|script-src)\s+[^;]+/i.test(policy))) add('csp', '中', '缺少有效的內容安全政策', '注入的惡意腳本較容易執行，增加跨網站指令碼攻擊風險。', '設定 Content-Security-Policy，以 default-src 或 script-src 限制來源，優先使用 nonce 或雜湊。');
  const frame = csp.match(/(?:^|;)\s*frame-ancestors\s+([^;]+)/i)?.[1]?.trim();
  if (!/^(?:DENY|SAMEORIGIN)$/i.test(normalized['x-frame-options'] || '') && !(frame && frame !== '*')) add('framing', '中', '未限制網頁被嵌入', '他人可能把網頁藏在框架內，誘導使用者誤按按鈕。', '設定 X-Frame-Options: DENY 或 SAMEORIGIN，或在 CSP 使用嚴格的 frame-ancestors。');
  if (normalized['x-content-type-options']?.toLowerCase() !== 'nosniff') add('nosniff', '低', '缺少內容類型保護', '瀏覽器可能錯誤猜測檔案類型，增加不預期執行內容的風險。', '為回應加入 X-Content-Type-Options: nosniff，並設定正確的 Content-Type。');
  const policies = [normalized['referrer-policy'] || '', ...(meta.referrer || [])].flatMap((value) => value.toLowerCase().split(',').map((part) => part.trim()));
  const valid = new Set(['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'origin', 'origin-when-cross-origin', 'unsafe-url', 'no-referrer-when-downgrade']);
  const policy = policies.filter((part) => valid.has(part)).at(-1);
  if (!policy || ['unsafe-url', 'no-referrer-when-downgrade'].includes(policy)) add('referrer', '低', '來源網址保護不足', '跳轉至其他網站時，可能傳送完整路徑或查詢參數。', '設定 Referrer-Policy: strict-origin-when-cross-origin 或 no-referrer。');
  if (platforms.includes('GitHub Pages')) {
    for (const item of results) {
      if (item.type === 'header_csp') item.fix = 'GitHub Pages 不支援自訂 HTTP 回應 header。先盤點實際資源，在 <head> 加入 <meta http-equiv="Content-Security-Policy" content="依實際資源填寫政策">，政策需含 default-src 或 script-src；不要直接使用佔位文字。meta 中的 frame-ancestors、report-uri、sandbox 不生效。';
      if (item.type === 'header_referrer') item.fix = 'GitHub Pages 不支援自訂 HTTP 回應 header。可在 <head> 加入 <meta name="referrer" content="strict-origin-when-cross-origin">，再確認來源網址傳送行為。';
      if (['header_framing', 'header_nosniff', 'header_hsts'].includes(item.type)) {
        item.platformLimit = 'GitHub Pages 不支援自訂 HTTP 回應 header，無法直接設定這項保護；風險仍然存在。';
        item.fix = `${item.platformLimit}可在網站前加入能設定 header 的 CDN 或代理，或轉用支援自訂 header 的託管；不要用 meta 假裝修好。`;
      }
      item.prompt = `請協助修復「${item.title}」。${item.fix}請提供實際驗收結果，不要假裝完成平台不支援的操作。`;
    }
  }
  return results;
}

export function detectPlatforms(url, sources, headers = {}) {
  const hostname = new URL(url).hostname.toLowerCase();
  const text = sources.join('\n');
  const server = Object.entries(headers).find(([key]) => key.toLowerCase() === 'server')?.[1];
  const candidates = [
    ['GitHub Pages', hostname.endsWith('.github.io') || String(server || '').trim().toLowerCase() === 'github.com'],
    ['Lovable', /(?:^|\.)lovable\.(?:app|dev)$/.test(hostname) || /lovable(?:-tagger|\.dev|\.app)|data-lov-/i.test(text)],
    ['Bolt', /(?:^|\.)bolt\.(?:host|new)$/.test(hostname) || /bolt\.new|stackblitz|webcontainer/i.test(text)],
    ['Replit', /(?:^|\.)(?:replit\.app|replit\.dev|repl\.co)$/.test(hostname) || /replit(?:\.com|\.app|\.dev)|@replit/i.test(text)],
    ['Vercel', /(?:^|\.)vercel\.app$/.test(hostname) || /_vercel\/|@vercel\/|vercel\.app/i.test(text)],
    ['Netlify', /(?:^|\.)netlify\.app$/.test(hostname) || /\.netlify\/|netlify-identity|netlify\.app/i.test(text)],
    ['Supabase', /supabase\.(?:co|in)|supabase-js|sb_publishable_|sb_secret_/i.test(text)],
    ['Firebase', /firebaseio\.com|firebaseapp\.com|firebasedatabase\.app|firebase(?:\/app|\/auth)|initializeApp\s*\(/i.test(text)],
  ];
  return candidates.filter(([, found]) => found).map(([name]) => name);
}

export function sensitiveFileLooksReal(path, body, contentType = '') {
  if (/text\/html|application\/xhtml/i.test(contentType) || /<\s*(?:!doctype|html|head|body|script)\b/i.test(body)) return false;
  if (path === '/.env' || path === '/.env.local') return /^\s*(?:export\s+)?[A-Z_][A-Z0-9_]{2,}\s*=\s*[^\r\n]+/m.test(body);
  if (path === '/.git/HEAD') return /^(?:ref: refs\/(?:heads|tags)\/[\w./-]+|[0-9a-f]{40}|[0-9a-f]{64})\s*$/i.test(body);
  if (path === '/.git/config') return /(?:^|\n)\s*\[(?:core|remote\s+"[^"\r\n]+")\]/.test(body) && /^\s*(?:repositoryformatversion|bare|url)\s*=\s*\S+/m.test(body);
  return false;
}

export function sourceMapLooksReal(body) {
  try {
    const map = JSON.parse(body);
    return map?.version === 3 && ((Array.isArray(map.sources) && typeof map.mappings === 'string') || Array.isArray(map.sections));
  } catch { return false; }
}

export function gradeReport(findings) {
  const worst = Math.min(...findings.map((item) => SEVERITIES.indexOf(item.severity)), 5);
  const grade = ['F', 'D', 'C', 'B', 'A', 'A'][worst];
  const summary = [
    '發現嚴重風險，請優先撤銷外洩密鑰並收緊資料存取權限。',
    '發現高風險問題，請儘快修復憑證或連線保護。',
    '發現需要修正的安全設定，建議依序完成修復。',
    '基本保護仍可改善，請檢查來源限制及安全標頭。',
    '未發現高風險問題，仍須確認公開密鑰與資料權限設定。',
    '本次已完成的檢查未發現問題，這不代表網站完全安全。',
  ][worst];
  return { grade, summary };
}
