import { randomBytes } from 'node:crypto';
import { REPORT_ID } from './storage.js';
import { redactObject } from './secrets.js';
import { AppError } from './errors.js';

export const HOSTED_REPORT_TTL_MS = 60 * 60 * 1000;

export class MemoryReportStore {
  #entries = new Map();
  #bytes = 0;
  constructor({ now = Date.now, ttlMs = HOSTED_REPORT_TTL_MS, maxReports = 100, maxBytes = 32 * 1024 * 1024, maxReportBytes = 8 * 1024 * 1024 } = {}) {
    if (![ttlMs, maxReports, maxBytes, maxReportBytes].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error('報告容量與保留時間必須是正整數。');
    Object.assign(this, { now, ttlMs, maxReports, maxBytes, maxReportBytes });
  }
  #remove(id) {
    const item = this.#entries.get(id);
    if (!item) return;
    this.#bytes -= item.bytes;
    this.#entries.delete(id);
  }
  #prune() {
    for (const [id, item] of this.#entries) if (item.expiresAt <= this.now()) this.#remove(id);
  }
  async save(report) {
    this.#prune();
    const id = randomBytes(24).toString('base64url');
    const expiresAt = this.now() + this.ttlMs;
    // Only a sanitized serialized report is retained; no hosted report touches disk.
    const clean = redactObject({ ...report, id, expiresAt: new Date(expiresAt).toISOString() });
    const json = JSON.stringify(clean);
    const bytes = Buffer.byteLength(json);
    if (bytes > this.maxReportBytes || bytes > this.maxBytes) throw new AppError('REPORT_TOO_LARGE', '報告超出線上版可保存的大小，請改用本機版。', 413);
    while (this.#entries.size >= this.maxReports || this.#bytes + bytes > this.maxBytes) this.#remove(this.#entries.keys().next().value);
    this.#entries.set(id, { json, bytes, expiresAt });
    this.#bytes += bytes;
    return JSON.parse(json);
  }
  async get(id) {
    this.#prune();
    const item = REPORT_ID.test(id) ? this.#entries.get(id) : null;
    if (!item) throw new AppError('NOT_FOUND', '找不到這份報告，可能已過期或因服務重啟而移除。請重新掃描。', 404);
    return JSON.parse(item.json);
  }
}
