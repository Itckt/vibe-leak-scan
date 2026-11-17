import { request } from './shared.js';

export async function showServiceStatus(notice, label, load = () => request('/api/status')) {
  if (!notice) return;
  try {
    const status = await load();
    if (label) label.textContent = status.hosted ? '免安裝線上試用版' : '本機安全檢查工具';
    notice.hidden = !status.hosted;
    if (status.hosted) notice.textContent = '線上報告最多暫存一小時，服務重啟或容量已滿時會提前移除。知道連結的人可以閱讀，請即時保存修復指令並謹慎分享。試用服務共用每分鐘五次掃描配額。';
  } catch { /* Status is informational; the scan flow handles request failures. */ }
}

if (typeof document !== 'undefined') showServiceStatus(document.querySelector('#service-notice'), document.querySelector('#service-kind'));
