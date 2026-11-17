import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { redactObject } from './secrets.js';
import { AppError } from './errors.js';

export const REPORT_ID = /^[A-Za-z0-9_-]{32}$/;

export class ReportStore {
  constructor(directory) { this.directory = directory; }
  async save(report) {
    const id = randomBytes(24).toString('base64url');
    const clean = redactObject({ ...report, id });
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(this.directory, `${id}.json`), JSON.stringify(clean, null, 2), { flag: 'wx', mode: 0o600 });
    return clean;
  }
  async get(id) {
    if (!REPORT_ID.test(id)) throw new AppError('NOT_FOUND', '找不到這份報告。', 404);
    try { return JSON.parse(await readFile(path.join(this.directory, `${id}.json`), 'utf8')); }
    catch { throw new AppError('NOT_FOUND', '找不到這份報告。', 404); }
  }
}
