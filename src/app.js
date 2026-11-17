import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';
import { validateTarget } from './network.js';
import { scan } from './scanner.js';
import { VerificationStore } from './verification.js';
import { ReportStore, REPORT_ID } from './storage.js';
import { MemoryReportStore, HOSTED_REPORT_TTL_MS } from './memory-reports.js';
import { validatePublicOrigin } from './runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));

export class WindowLimiter {
  constructor(limit = 5, now = Date.now) { this.limit = limit; this.now = now; this.entries = new Map(); }
  take(ip) {
    const time = this.now();
    for (const [key, values] of this.entries) if (values.at(-1) <= time - 60000) this.entries.delete(key);
    const active = (this.entries.get(ip) || []).filter((stamp) => stamp > time - 60000);
    if (active.length >= this.limit || (this.entries.size >= 5000 && !this.entries.has(ip))) return false;
    this.entries.set(ip, [...active, time]);
    return true;
  }
}

export function createApp({ dataDirectory = path.join(root, 'data'), verifications = new VerificationStore(), publicOrigin = null } = {}) {
  const origin = publicOrigin === null ? null : validatePublicOrigin(publicOrigin);
  if (origin && process.env.ALLOW_PRIVATE_TARGETS === '1') throw new Error('線上模式不可啟用 ALLOW_PRIVATE_TARGETS。');
  const app = express();
  const reports = origin ? new MemoryReportStore() : new ReportStore(dataDirectory);
  const scans = new WindowLimiter(5);
  const proofs = new WindowLimiter(20);
  let activeScans = 0;
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.set('json escape', true);
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
    });
    if (origin) {
      res.set({ 'Strict-Transport-Security': 'max-age=31536000', 'X-Robots-Tag': 'noindex, nofollow' });
      if (process.env.ALLOW_PRIVATE_TARGETS === '1') return next(new AppError('UNSAFE_CONFIGURATION', '服務設定錯誤，暫停接受請求。', 503));
    }
    // Health checks return no report data and may use an internal proxy Host.
    if (req.method === 'GET' && req.path === '/healthz') return res.json({ status: 'ok' });
    const hostname = req.hostname.toLowerCase();
    const validHost = origin ? req.headers.host?.toLowerCase() === new URL(origin).host : ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
    if (!validHost) return next(new AppError('INVALID_HOST', '不接受這個服務網址。', 403));
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== (origin || `http://${req.headers.host}`)) {
      return next(new AppError('INVALID_ORIGIN', '不接受來自其他網站的操作請求。', 403));
    }
    if (req.method === 'POST' && !req.is('application/json')) return next(new AppError('INVALID_BODY', '請以 JSON 格式提交請求。', 415));
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  const limit = (limiter) => (req, res, next) => {
    // Hosted visitors share a conservative quota; forwarded headers cannot bypass it.
    if (!limiter.take(origin ? 'hosted-service' : req.socket.remoteAddress || 'unknown')) {
      res.set('Retry-After', '60');
      return next(new AppError('RATE_LIMIT', origin ? '試用服務的請求次數已達上限，請稍候一分鐘再試。' : '請求過於頻繁；每個 IP 每分鐘最多五次掃描，請稍後再試。', 429));
    }
    next();
  };
  app.get('/api/status', (_req, res) => res.json({ hosted: Boolean(origin), reportRetentionMinutes: origin ? HOSTED_REPORT_TTL_MS / 60000 : null }));
  app.post('/api/verifications', limit(proofs), async (req, res) => {
    const { url } = await validateTarget(req.body?.url);
    res.status(201).json(verifications.issue(url.href));
  });
  app.post('/api/verifications/:id/check', limit(proofs), async (req, res) => {
    res.json(await verifications.check(req.params.id));
  });
  app.post('/api/scans', limit(scans), async (req, res) => {
    if (activeScans >= 2) throw new AppError('BUSY', '目前正在處理其他掃描，請稍後再試。', 503);
    activeScans += 1;
    try {
      const report = await scan({ url: req.body?.url, mode: req.body?.mode ?? 'passive', verificationId: req.body?.verificationId }, verifications);
      const saved = await reports.save(report);
      res.status(201).json({ id: saved.id, reportUrl: `/report/${saved.id}` });
    } finally { activeScans -= 1; }
  });
  app.get('/api/reports/:id', async (req, res) => res.json(await reports.get(req.params.id)));
  app.get('/report/:id', async (req, res) => {
    if (!REPORT_ID.test(req.params.id)) throw new AppError('NOT_FOUND', '找不到這份報告。', 404);
    await reports.get(req.params.id);
    res.sendFile(path.join(root, 'public', 'report.html'));
  });
  app.get('/src/prompts.js', (_req, res) => res.sendFile(path.join(root, 'src', 'prompts.js')));
  app.use(express.static(path.join(root, 'public'), { index: 'index.html', etag: false, maxAge: 0 }));
  app.use((_req, _res, next) => next(new AppError('NOT_FOUND', '找不到這個頁面。', 404)));
  app.use((error, _req, res, _next) => {
    // Never send or log upstream errors, bodies, URLs, or credential-bearing headers.
    const known = error instanceof AppError;
    const malformed = error.type === 'entity.parse.failed' || error.type === 'entity.too.large';
    res.status(known ? error.status : malformed ? 400 : 500).json({
      error: { code: known ? error.code : malformed ? 'INVALID_BODY' : 'INTERNAL_ERROR', message: known ? error.message : malformed ? '請求內容不是有效的 JSON，或超出大小限制。' : '暫時無法完成操作，請稍後再試。' },
    });
  });
  return app;
}
