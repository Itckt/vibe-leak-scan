const boundary = '[A-Za-z0-9_\\-]';
const tokenRule = (type, expression) => ({ type, expression: new RegExp(`(?<!${boundary})(?:${expression})(?!${boundary})`, 'g') });

const rules = [
  tokenRule('supabase_secret', 'sb_secret_[A-Za-z0-9_-]{20,256}'),
  tokenRule('supabase_publishable', 'sb_publishable_[A-Za-z0-9_-]{20,256}'),
  tokenRule('openai', 'sk-(?:proj-[A-Za-z0-9_-]{20,256}|(?!ant-|proj-)[A-Za-z0-9]{20,256})'),
  tokenRule('anthropic', 'sk-ant-[A-Za-z0-9_-]{20,256}'),
  tokenRule('stripe_secret', 'sk_live_[A-Za-z0-9]{20,128}'),
  tokenRule('stripe_restricted', 'rk_live_[A-Za-z0-9]{20,128}'),
  tokenRule('aws', 'AKIA[A-Z0-9]{16}'),
  tokenRule('github', 'ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,255}'),
  tokenRule('slack', 'xox[baprs]-[A-Za-z0-9-]{20,200}'),
  tokenRule('sendgrid', 'SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}'),
  tokenRule('resend', 're_[A-Za-z0-9]{20,100}'),
  { type: 'telegram', expression: /(?<!\d)\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g },
  tokenRule('google', 'AIza[A-Za-z0-9_-]{35}'),
];

export const SECRET_TYPES = {
  supabase_service_role: { name: 'Supabase 管理員密鑰', severity: '嚴重', why: '這種密鑰可繞過資料列層級安全規則，外洩可能讓他人讀取或修改整個專案。' },
  supabase_secret: { name: 'Supabase 伺服器密鑰', severity: '嚴重', why: '這種密鑰具有伺服器權限，不應交給瀏覽器或訪客。' },
  supabase_anon: { name: 'Supabase 匿名公開密鑰', severity: '資訊', why: '匿名密鑰本身可以公開，但資料表必須啟用資料列層級安全規則（RLS），並限制匿名權限。', public: true },
  supabase_publishable: { name: 'Supabase 公開發佈密鑰', severity: '資訊', why: '公開發佈密鑰本身可以公開；資料保護依賴資料列層級安全規則（RLS）及正確的權限設定。', public: true },
  openai: { name: 'OpenAI 私密金鑰', severity: '嚴重', why: '他人可能冒用你的配額呼叫模型，造成額外費用及資料外洩。' },
  anthropic: { name: 'Anthropic 私密金鑰', severity: '嚴重', why: '他人可能使用你的模型配額，造成額外費用及未授權存取。' },
  stripe_secret: { name: 'Stripe 正式環境私密金鑰', severity: '嚴重', why: '他人可能利用正式環境權限接觸付款資料或執行金流操作。' },
  stripe_restricted: { name: 'Stripe 正式環境受限金鑰', severity: '嚴重', why: '受限金鑰仍有指定的正式環境權限，不應放在公開前端。' },
  aws: { name: 'AWS 存取金鑰識別碼', severity: '高', why: '這是雲端憑證的一部分；若搭配私密金鑰外洩，可能讓他人操作雲端資源。' },
  github: { name: 'GitHub 存取權杖', severity: '嚴重', why: '權杖可能讓他人讀取私有程式碼、修改儲存庫或操作自動化流程。' },
  slack: { name: 'Slack 存取權杖', severity: '高', why: '權杖可能被用來讀取工作空間內容或冒用機器人權限。' },
  sendgrid: { name: 'SendGrid 郵件金鑰', severity: '高', why: '他人可能使用你的寄信服務發送郵件，消耗配額並損害網域信譽。' },
  resend: { name: 'Resend 郵件金鑰', severity: '高', why: '他人可能冒用寄信權限，消耗配額並影響郵件信譽。' },
  telegram: { name: 'Telegram 機器人權杖', severity: '高', why: '他人可能冒用你的機器人或接觸機器人可取得的訊息。' },
  pem: { name: 'PEM 私鑰', severity: '嚴重', why: '私鑰用來證明身分或解密資料，公開後可能被冒用。' },
  google: { name: 'Google API 公開金鑰', severity: '低', why: 'Firebase 等前端服務可能刻意公開此金鑰，仍須限制可用 API、網站來源及配額。', public: true },
};

export function decodeJwt(value) {
  try {
    const parts = value.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const decode = (part) => {
      const bytes = Buffer.from(part, 'base64url');
      if (bytes.toString('base64url') !== part) throw new Error('Non-canonical encoding');
      return JSON.parse(bytes.toString('utf8'));
    };
    const header = decode(parts[0]);
    const payload = decode(parts[1]);
    if (!header || typeof header.alg !== 'string' || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload;
  } catch { return null; }
}

export function detectSecrets(text) {
  const found = [];
  const seen = new Set();
  const add = (type, value) => {
    const identity = `${type}:${value}`;
    if (!seen.has(identity)) { seen.add(identity); found.push({ type, value }); }
  };
  for (const rule of rules) {
    for (const match of text.matchAll(rule.expression)) add(rule.type, match[0]);
  }
  const jwtPattern = /(?<![A-Za-z0-9_.-])[A-Za-z0-9_-]{8,1024}\.[A-Za-z0-9_-]{8,8192}\.[A-Za-z0-9_-]{16,1024}(?![A-Za-z0-9_.-])/g;
  for (const match of text.matchAll(jwtPattern)) {
    const payload = decodeJwt(match[0]);
    if (payload?.role === 'service_role') add('supabase_service_role', match[0]);
    if (payload?.role === 'anon') add('supabase_anon', match[0]);
  }
  const pemPattern = /-----BEGIN ((?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----([\s\S]{1,16384}?)-----END \1-----/g;
  for (const match of text.matchAll(pemPattern)) {
    const body = match[2].replace(/\\[rn]|\s/g, '');
    if (body.length >= 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(body)) add('pem', match[0]);
  }
  return found;
}

export function maskSecret(value) {
  return value.length > 10 ? `${value.slice(0, 6)}…${value.slice(-4)}` : '已遮蓋';
}

export function redactText(value, knownSecrets = []) {
  let text = String(value);
  const secrets = [...new Set([...knownSecrets, ...detectSecrets(text).map((item) => item.value)])].sort((a, b) => b.length - a.length);
  for (const secret of secrets) {
    text = text.split(secret).join(maskSecret(secret));
    text = text.split(encodeURIComponent(secret)).join(maskSecret(secret));
  }
  return text;
}

export function redactObject(value, knownSecrets = []) {
  if (typeof value === 'string') return redactText(value, knownSecrets);
  if (Array.isArray(value)) return value.map((item) => redactObject(item, knownSecrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactObject(item, knownSecrets)]));
  return value;
}

export function displayUrl(value) {
  try {
    const url = new URL(value);
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { path = '/（路徑已隱藏）'; }
    // Query strings and fragments may contain credentials unrelated to known patterns.
    return redactText(`${url.origin}${path}`).slice(0, 2048);
  } catch { return '網站資源'; }
}

export function secretFinding(secret, source) {
  const meta = SECRET_TYPES[secret.type];
  const fix = meta.public
    ? (secret.type === 'google' ? '到雲端主控台限制網站來源、可用 API 及配額；確認資料庫規則。' : '逐一啟用資料表的 RLS，只授予必要權限，並以匿名身分測試讀寫政策。')
    : '立即撤銷並更換這個密鑰，檢查使用紀錄；把服務呼叫移到伺服器，從前端程式及建置變數移除密鑰。';
  return {
    type: `secret_${secret.type}`, severity: meta.severity, title: `${meta.name}${meta.public ? '需要確認限制' : '出現在公開資源'}`,
    description: meta.public ? '找到可公開的識別密鑰；這項資訊本身不代表資料已外洩。' : '訪客下載網站時，可以取得這段疑似私密憑證。此處只顯示遮蓋後的內容。',
    why: meta.why, fix,
    prompt: `請協助修復「${meta.name}」的設定。${fix}請列出修改的檔案及驗證步驟，不要在回覆、紀錄或前端輸出任何原始密鑰。`,
    source: displayUrl(source), evidence: maskSecret(secret.value),
  };
}
