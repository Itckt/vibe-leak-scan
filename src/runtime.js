export function validatePublicOrigin(value) {
  const invalid = () => new Error('線上模式需要有效的 HTTPS PUBLIC_ORIGIN，只可包含網域，不可包含路徑或登入資料。');
  if (typeof value !== 'string' || value !== value.trim()) throw invalid();
  let url;
  try { url = new URL(value); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port || !url.hostname.includes('.') || url.hostname.endsWith('.') || url.hostname.includes(':')) throw invalid();
  if (/^(?:localhost|.*\.localhost|\d+\.\d+\.\d+\.\d+)$/.test(url.hostname)) throw invalid();
  return url.origin;
}

export function readRuntimeConfig(env = process.env) {
  if (env.HOSTED && !['0', '1'].includes(env.HOSTED)) throw new Error('HOSTED 只接受 0 或 1。');
  const hosted = env.HOSTED === '1';
  if (hosted && env.ALLOW_PRIVATE_TARGETS === '1') throw new Error('線上模式不可啟用 ALLOW_PRIVATE_TARGETS。');
  const publicOrigin = hosted ? validatePublicOrigin(env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL) : null;
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必須是 1 至 65535 的整數。');
  return { publicOrigin, port, host: hosted ? '0.0.0.0' : '127.0.0.1' };
}
