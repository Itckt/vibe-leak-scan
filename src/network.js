import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import { AppError, networkError, timeoutError } from './errors.js';

export const MAX_RESOURCE_BYTES = 5_000_000;
export const MAX_TOTAL_BYTES = 25_000_000;
export const USER_AGENT = 'LaumLau-Security-Scanner/1.0 (read-only owner security audit)';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const CONNECTION_FAILURE = Symbol('connectionFailure');
const CONNECTION_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EPIPE']);

export function parseTarget(input) {
  if (typeof input !== 'string' || input.length > 2048 || /[\u0000-\u0020\u007f]/u.test(input)) {
    throw new AppError('INVALID_URL', '請輸入完整的 HTTP 或 HTTPS 網址。');
  }
  let url;
  try { url = new URL(input); } catch { throw new AppError('INVALID_URL', '網址格式不正確。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) {
    throw new AppError('INVALID_URL', '只接受不含帳號或密碼的 HTTP 或 HTTPS 網址。');
  }
  url.hash = '';
  return url;
}

export function isPublicAddress(address) {
  try {
    let parsed = ipaddr.parse(address.replace(/^\[|\]$/g, ''));
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    if (parsed.range() !== 'unicast') return false;
    if (parsed.kind() === 'ipv6') {
      // Only globally routed IPv6 is eligible. Exclude transition and special-use space.
      if (!parsed.match(ipaddr.parse('2000::'), 3)) return false;
      for (const cidr of ['2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20']) {
        const [network, prefix] = ipaddr.parseCIDR(cidr);
        if (parsed.match(network, prefix)) return false;
      }
    }
    return true;
  } catch { return false; }
}

export async function validateTarget(input, { resolver = lookup, timeoutMs = 10000 } = {}) {
  const url = input instanceof URL ? parseTarget(input.href) : parseTarget(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname.includes('%')) throw new AppError('SSRF_BLOCKED', '不允許掃描這個網路位址。', 403);
  let timer;
  let addresses;
  try {
    addresses = await Promise.race([
      isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : resolver(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError()), timeoutMs); }),
    ]);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('DNS_ERROR', '無法解析網站的網路位址。', 422);
  } finally { clearTimeout(timer); }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(({ address }) => !isIP(address))) {
    throw new AppError('DNS_ERROR', '網站沒有可用的網路位址。', 422);
  }
  if (process.env.ALLOW_PRIVATE_TARGETS !== '1' && addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new AppError('SSRF_BLOCKED', '已阻擋本機、私有網路、保留位址或雲端中繼資料位址。', 403);
  }
  return { url, addresses };
}

export function createBudget({ maxBytes = MAX_TOTAL_BYTES, durationMs = 120000 } = {}) {
  return { used: 0, maxBytes, deadline: Date.now() + durationMs };
}

function sizeError() {
  return new AppError('SIZE_LIMIT', '資源超出大小或掃描總流量上限，已停止下載。', 422);
}

async function requestOnce(url, addresses, options) {
  // All attempts share the remaining request deadline, including the scan budget.
  const deadline = Math.min(Date.now() + options.timeoutMs, options.budget.deadline);
  for (const [index, address] of addresses.entries()) {
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) throw timeoutError();
    try {
      return await requestAddress(url, address, { ...options, timeoutMs, hasNext: index < addresses.length - 1 });
    } catch (error) {
      if (error !== CONNECTION_FAILURE) throw error;
    }
  }
  throw networkError();
}

function requestAddress(url, chosen, { timeoutMs, maxBytes, budget, headers, hasNext }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let response;
    let decoder;
    let timer;
    let connectionTimer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(connectionTimer);
      if (error) reject(error === CONNECTION_FAILURE || error instanceof AppError ? error : networkError());
      else resolve(result);
      decoder?.destroy();
      response?.destroy();
      request.destroy();
    };
    // Pin the socket to the validated address; never resolve the hostname a second time.
    const pinnedLookup = (_hostname, options, callback) => {
      if (options?.all) callback(null, [chosen]);
      else callback(null, chosen.address, chosen.family);
    };
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: 'GET', agent: false, lookup: pinnedLookup, family: chosen.family,
      headers: { Accept: '*/*', 'Accept-Encoding': 'identity', ...headers, 'User-Agent': USER_AGENT },
    }, (incoming) => {
      clearTimeout(connectionTimer);
      response = incoming;
      const status = incoming.statusCode;
      const result = { url: url.href, status, headers: incoming.headers, body: '', bytes: 0 };
      if (REDIRECTS.has(status)) return finish(null, result);
      if (Number(incoming.headers['content-length']) > maxBytes) return finish(sizeError());
      const encoding = (incoming.headers['content-encoding'] || 'identity').toLowerCase();
      const decompressors = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress };
      if (encoding !== 'identity' && !decompressors[encoding]) return finish(networkError());
      const stream = encoding === 'identity' ? incoming : (decoder = decompressors[encoding]());
      const chunks = [];
      let wireBytes = 0;
      let decodedBytes = 0;
      incoming.on('data', (chunk) => {
        wireBytes += chunk.length;
        if (wireBytes > maxBytes) finish(sizeError());
      });
      incoming.on('aborted', () => finish(networkError()));
      incoming.on('error', () => finish(networkError()));
      stream.on('error', () => finish(networkError()));
      stream.on('data', (chunk) => {
        if (settled) return;
        decodedBytes += chunk.length;
        budget.used += chunk.length;
        if (decodedBytes > maxBytes || budget.used > budget.maxBytes) return finish(sizeError());
        chunks.push(chunk);
      });
      stream.on('end', () => finish(null, { ...result, body: Buffer.concat(chunks).toString('utf8'), bytes: decodedBytes }));
      if (decoder) incoming.pipe(decoder);
    });
    request.on('error', (error) => finish(!response && CONNECTION_ERRORS.has(error.code) ? CONNECTION_FAILURE : networkError()));
    timer = setTimeout(() => finish(timeoutError()), timeoutMs);
    // Only the connection phase gets a per-address cap; response reads keep the shared deadline.
    if (hasNext && timeoutMs > 3000) {
      connectionTimer = setTimeout(() => finish(CONNECTION_FAILURE), 3000);
      request.on('socket', (socket) => {
        const connected = () => clearTimeout(connectionTimer);
        if (url.protocol === 'https:') socket.once('secureConnect', connected);
        else if (!socket.connecting) connected();
        else socket.once('connect', connected);
      });
    }
    request.end();
  });
}

export async function safeFetch(input, {
  budget = createBudget(), maxBytes = MAX_RESOURCE_BYTES, timeoutMs = 10000,
  maxRedirects = 5, allowedOrigin, headers = {}, resolver = lookup,
} = {}) {
  let current = parseTarget(input instanceof URL ? input.href : input);
  for (let redirects = 0; ; redirects += 1) {
    if (allowedOrigin && current.origin !== allowedOrigin) {
      throw new AppError('ORIGIN_CHANGED', '此項檢查不允許重新導向至其他網站，請使用最終網址重新驗證。', 403);
    }
    const remaining = budget.deadline - Date.now();
    if (remaining <= 0) throw new AppError('SCAN_TIMEOUT', '掃描已達時間上限，部分檢查未完成。', 422);
    if (budget.used >= budget.maxBytes) throw sizeError();
    const started = Date.now();
    const requestTimeout = Math.min(10000, timeoutMs, remaining);
    const { url, addresses } = await validateTarget(current, { resolver, timeoutMs: requestTimeout });
    const timeLeft = requestTimeout - (Date.now() - started);
    if (timeLeft <= 0) throw timeoutError();
    const result = await requestOnce(url, addresses, {
      timeoutMs: timeLeft, maxBytes: Math.min(MAX_RESOURCE_BYTES, maxBytes, budget.maxBytes - budget.used), budget, headers,
    });
    if (!REDIRECTS.has(result.status)) return result;
    if (redirects >= Math.min(5, maxRedirects)) throw new AppError('REDIRECT_LIMIT', '重新導向次數超出限制。', 422);
    if (!result.headers.location) throw networkError();
    try { current = parseTarget(new URL(result.headers.location, current).href); } catch { throw networkError(); }
  }
}
