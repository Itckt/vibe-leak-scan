import { request, copyText } from './shared.js';

const form = document.querySelector('#scan-form');
const urlInput = document.querySelector('#target-url');
const scanButton = document.querySelector('#scan-button');
const errorBox = document.querySelector('#form-error');
const proofBox = document.querySelector('#verification');
const proofStatus = document.querySelector('#verification-status');
const issueButton = document.querySelector('#issue-token');
const checkButton = document.querySelector('#check-token');
let challenge;
let verified = false;
let busy = false;
const mode = () => form.elements.mode.value;
const showError = (message) => { errorBox.textContent = message; errorBox.hidden = false; };
function update() {
  proofBox.hidden = mode() !== 'deep';
  scanButton.textContent = busy ? '正在處理…' : mode() === 'deep' ? '開始深度掃描 ↗' : '開始被動掃描 ↗';
  scanButton.disabled = busy || (mode() === 'deep' && !verified);
  issueButton.disabled = busy;
  checkButton.disabled = busy;
}
function invalidate() {
  challenge = undefined;
  verified = false;
  document.querySelector('#proof-instructions').hidden = true;
  proofStatus.textContent = '';
  update();
}
urlInput.addEventListener('input', invalidate);
form.querySelectorAll('[name="mode"]').forEach((radio) => radio.addEventListener('change', update));
issueButton.addEventListener('click', async () => {
  if (!urlInput.reportValidity()) return;
  errorBox.hidden = true;
  verified = false;
  busy = true;
  update();
  const target = urlInput.value.trim();
  try {
    const result = await request('/api/verifications', { url: target });
    if (urlInput.value.trim() !== target) return;
    challenge = result;
    document.querySelector('#meta-snippet').textContent = `<meta name="laumlau-verify" content="${challenge.token}">`;
    document.querySelector('#token-value').textContent = challenge.token;
    document.querySelector('#proof-expiry').textContent = `驗證網站：${challenge.origin}；有效至 ${new Date(challenge.expiresAt).toLocaleTimeString('zh-Hant')}。`;
    document.querySelector('#proof-instructions').hidden = false;
    proofStatus.textContent = '取得驗證碼後，請到網站放置標記或檔案。';
  } catch (error) { showError(error.message); }
  finally { busy = false; update(); }
});
checkButton.addEventListener('click', async () => {
  if (!challenge) return;
  const current = challenge;
  errorBox.hidden = true;
  busy = true;
  update();
  proofStatus.textContent = '正在讀取網站的驗證標記…';
  try {
    const result = await request(`/api/verifications/${current.id}/check`, {});
    if (challenge !== current) return;
    verified = result.verified === true;
    proofStatus.textContent = result.message;
  } catch (error) { verified = false; proofStatus.textContent = ''; showError(error.message); }
  finally { busy = false; update(); }
});
document.querySelector('#copy-meta').addEventListener('click', (event) => copyText(document.querySelector('#meta-snippet').textContent, event.currentTarget));
document.querySelector('#copy-token').addEventListener('click', (event) => copyText(document.querySelector('#token-value').textContent, event.currentTarget));
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || (mode() === 'deep' && !verified)) return;
  errorBox.hidden = true;
  busy = true;
  update();
  const payload = { url: urlInput.value.trim(), mode: mode(), verificationId: challenge?.id };
  const controls = [...form.querySelectorAll('input')];
  controls.forEach((input) => { input.disabled = true; });
  form.setAttribute('aria-busy', 'true');
  document.querySelector('#scan-progress').hidden = false;
  try {
    const result = await request('/api/scans', payload);
    if (!/^[A-Za-z0-9_-]{32}$/.test(result.id)) throw new Error('報告格式不正確，請重新掃描。');
    location.assign(`/report/${result.id}`);
  } catch (error) { showError(error.message); }
  finally {
    busy = false;
    controls.forEach((input) => { input.disabled = false; });
    form.removeAttribute('aria-busy');
    document.querySelector('#scan-progress').hidden = true;
    update();
  }
});
update();
