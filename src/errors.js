export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export const networkError = () => new AppError('NETWORK_ERROR', '無法讀取網站資源，請確認網址及網站狀態。', 422);
export const timeoutError = () => new AppError('TIMEOUT', '讀取資源逾時，已停止這次請求。', 422);
