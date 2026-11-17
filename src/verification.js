import { randomBytes } from 'node:crypto';
import { AppError } from './errors.js';
import { parseTarget, safeFetch, createBudget } from './network.js';
import { hasVerificationMeta, isHtml } from './html.js';

export class VerificationStore {
  #challenges = new Map();
  #now;
  constructor({ now = Date.now } = {}) { this.#now = now; }

  issue(input) {
    const url = parseTarget(input);
    for (const [id, item] of this.#challenges) {
      if (item.expiresAt <= this.#now()) this.#challenges.delete(id);
    }
    if (this.#challenges.size >= 1000) throw new AppError('BUSY', '驗證請求過多，請稍後再試。', 503);
    const challenge = {
      id: randomBytes(24).toString('base64url'), token: randomBytes(32).toString('hex'),
      origin: url.origin, expiresAt: this.#now() + 15 * 60 * 1000, verified: false,
    };
    this.#challenges.set(challenge.id, challenge);
    return { id: challenge.id, token: challenge.token, origin: challenge.origin, expiresAt: new Date(challenge.expiresAt).toISOString() };
  }

  #get(id, target) {
    const challenge = this.#challenges.get(id);
    if (!challenge || challenge.expiresAt <= this.#now() || (target && challenge.origin !== parseTarget(target).origin)) {
      throw new AppError('OWNERSHIP_REQUIRED', '請先完成這個網站的擁有權驗證；驗證有效期為十五分鐘。', 403);
    }
    return challenge;
  }

  async #readProof(challenge, budget) {
    const options = { budget, allowedOrigin: challenge.origin, maxBytes: 1024 * 1024 };
    try {
      const home = await safeFetch(`${challenge.origin}/`, options);
      if (home.status === 200 && isHtml(home.body, home.headers['content-type']) && hasVerificationMeta(home.body, challenge.token)) return true;
    } catch { /* The file method remains available when the homepage cannot be read. */ }
    try {
      const file = await safeFetch(`${challenge.origin}/.well-known/laumlau-verify.txt`, { ...options, maxRedirects: 0, maxBytes: 4096 });
      if (file.status === 200 && !isHtml(file.body, file.headers['content-type']) && file.body.trim() === challenge.token) return true;
    } catch { /* A failed proof never grants access. */ }
    return false;
  }

  async check(id) {
    const challenge = this.#get(id);
    const verified = await this.#readProof(challenge, createBudget({ durationMs: 25000 }));
    if (challenge.expiresAt <= this.#now()) throw new AppError('OWNERSHIP_REQUIRED', '驗證已過期，請重新取得驗證碼。', 403);
    challenge.verified = verified;
    if (!verified) throw new AppError('OWNERSHIP_NOT_FOUND', '未找到有效的驗證標記。請確認首頁標記或驗證檔內容，然後重試。', 403);
    return { verified: true, message: '擁有權驗證成功，可以開始深度掃描。', expiresAt: new Date(challenge.expiresAt).toISOString() };
  }

  async authorize(input, id, budget) {
    const challenge = this.#get(id, input);
    if (!challenge.verified) throw new AppError('OWNERSHIP_REQUIRED', '深度掃描前必須先完成擁有權驗證。', 403);
    // Re-read proof for every deep scan; neither a submitted flag nor a stale check is sufficient.
    if (!await this.#readProof(challenge, budget) || challenge.expiresAt <= this.#now()) {
      challenge.verified = false;
      throw new AppError('OWNERSHIP_REQUIRED', '擁有權標記已失效，請重新驗證。', 403);
    }
    return challenge.origin;
  }
}
