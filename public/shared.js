export async function request(url, body) {
  const options = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(url, { ...options, cache: 'no-store' });
  let data;
  try { data = await response.json(); } catch { throw new Error('服務暫時無法回應，請稍後再試。'); }
  if (!response.ok) throw new Error(data.error?.message || '操作未能完成，請稍後再試。');
  return data;
}

export async function copyText(text, button) {
  const previous = button.textContent;
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch { /* A denied Clipboard API request can still use the legacy fallback. */ }
  if (!copied) {
    let input;
    const previousFocus = document.activeElement;
    try {
      input = document.createElement('textarea');
      input.value = text;
      input.className = 'clipboard-input';
      document.body.append(input);
      input.focus();
      input.select();
      copied = document.execCommand('copy') === true;
    } catch { /* The caller will expose selectable text when both methods fail. */ }
    finally {
      input?.remove();
      previousFocus?.focus();
    }
  }
  button.textContent = copied ? '已複製 ✓' : '無法自動複製，請選取文字複製';
  setTimeout(() => { button.textContent = previous; }, 2500);
  return copied;
}
