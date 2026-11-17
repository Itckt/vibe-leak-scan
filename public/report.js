import { request, copyText } from './shared.js';
import { setupPromptControls } from './prompt-controls.js';

const severityNames = ['嚴重', '高', '中', '低', '資訊'];
const severityClasses = ['critical', 'high', 'medium', 'low', 'info'];
const text = (id, value) => { document.getElementById(id).textContent = value; };
const create = (tag, value, className) => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};

function renderFindings(findings) {
  const holder = document.querySelector('#findings');
  const nodes = findings.map((item, index) => {
    const card = document.querySelector('#finding-template').content.firstElementChild.cloneNode(true);
    card.dataset.severity = item.severity;
    const badge = card.querySelector('.severity-badge');
    badge.textContent = item.severity;
    badge.classList.add(severityClasses[severityNames.indexOf(item.severity)] || 'info');
    if (item.platformLimit) {
      card.querySelector('.finding-top').append(create('span', '平台限制', 'severity-badge medium'));
      card.querySelector('.finding-top').title = item.platformLimit;
    }
    card.querySelector('.finding-index').textContent = `問題 ${String(index + 1).padStart(2, '0')}`;
    card.querySelector('h3').textContent = item.title;
    card.querySelector('.finding-description').textContent = item.description;
    card.querySelector('.finding-why').textContent = item.why;
    card.querySelector('.finding-fix').textContent = item.fix;
    card.querySelector('.finding-source').textContent = item.source ? `發現位置：${item.source}` : '檢查位置：網頁回應標頭';
    const evidence = card.querySelector('.finding-evidence');
    if (item.evidence) { evidence.append(create('span', '已遮蓋的密鑰'), create('code', item.evidence)); evidence.hidden = false; }
    if (item.table) { evidence.append(create('span', `資料表：${item.table}`), create('code', `欄位：${item.columns.join('、') || '沒有可顯示的欄位名稱'}`)); evidence.hidden = false; }
    return card;
  });
  holder.replaceChildren(...nodes);
  const filters = document.querySelector('#filters');
  const options = ['全部', ...severityNames];
  for (const name of options) {
    const count = name === '全部' ? findings.length : findings.filter((item) => item.severity === name).length;
    const button = create('button', `${name} ${count}`, 'filter-button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(name === '全部'));
    button.addEventListener('click', () => {
      filters.querySelectorAll('button').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      nodes.forEach((node) => { node.hidden = name !== '全部' && node.dataset.severity !== name; });
      document.querySelector('#empty-findings').hidden = count > 0;
    });
    filters.append(button);
  }
  document.querySelector('#empty-findings').hidden = findings.length > 0;
  return nodes;
}

async function main() {
  try {
    const id = location.pathname.split('/').filter(Boolean).at(-1);
    if (!/^[A-Za-z0-9_-]{32}$/.test(id)) throw new Error('報告網址不正確。');
    const report = await request(`/api/reports/${id}`);
    text('report-target', report.target);
    text('grade', report.grade);
    text('summary-heading', report.summary);
    text('report-meta', `${report.mode} · ${new Date(report.createdAt).toLocaleString('zh-Hant')} · ${report.ownershipVerified ? '已驗證擁有權' : '公開資源檢查'}`);
    text('report-coverage', `已讀取 ${report.coverage.scripts} 個外部程式檔案（其中 ${report.coverage.importedScripts ?? 0} 個經匯入或模組預載發現）、${report.coverage.inlineScripts} 段內嵌程式及 ${report.coverage.sourceMaps} 個來源對照檔，合共 ${(report.coverage.bytes / 1_000_000).toFixed(2)} MB。`);
    for (const severity of severityNames) {
      const count = report.findings.filter((item) => item.severity === severity).length;
      const block = create('div', '', 'count-block');
      block.append(create('strong', String(count)), create('span', severity));
      document.querySelector('#severity-counts').append(block);
    }
    for (const platform of report.platforms.length ? report.platforms : ['未辨識']) document.querySelector('#platforms').append(create('span', platform, 'chip'));
    const notices = [...report.notices];
    if (!report.ownershipVerified) notices.unshift('本次只進行被動掃描，尚未檢查敏感檔案及 Supabase 資料權限。');
    if (notices.length) {
      document.querySelector('#report-notices').hidden = false;
      notices.forEach((notice) => document.querySelector('#notice-list').append(create('li', notice)));
    }
    const cards = renderFindings(report.findings);
    setupPromptControls(report, {
      select: document.querySelector('#prompt-tool'), copyPlan: document.querySelector('#copy-plan'),
      planFallback: document.querySelector('#plan-fallback'), planText: document.querySelector('#plan-text'),
      cards, copy: copyText, getStorage: () => localStorage,
    });
    if (report.databaseChecks.length) {
      document.querySelector('#database-section').hidden = false;
      for (const check of report.databaseChecks) {
        const row = document.createElement('tr');
        for (const value of [check.project, check.table, check.result]) row.append(create('td', value));
        document.querySelector('#database-checks').append(row);
      }
    }
    text('limitations', report.limitations);
    document.querySelector('#copy-link').addEventListener('click', (event) => copyText(location.href, event.currentTarget));
    document.querySelector('#report-status').hidden = true;
    document.querySelector('#report-content').hidden = false;
  } catch (error) {
    text('report-status', error.message || '未能讀取報告，請稍後再試。');
    document.querySelector('#report-status').setAttribute('role', 'alert');
  }
}
main();
