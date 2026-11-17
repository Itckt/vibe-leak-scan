import { defaultTool, promptFor, buildFixPlan } from '../src/prompts.js';

// Dependencies are supplied by the page so storage failures and copy behavior can be tested.
export function setupPromptControls(report, { select, copyPlan, planFallback, planText, cards, copy, getStorage }) {
  let saved;
  try { saved = getStorage().getItem('laumlau-tool'); } catch { /* Storage is optional. */ }
  select.value = defaultTool(report.platforms, saved);
  const update = () => {
    if (!planFallback.hidden) planText.value = buildFixPlan(report, select.value);
    report.findings.forEach((finding, index) => {
      const card = cards[index];
      card.querySelector('.prompt-text').textContent = promptFor(finding, select.value);
      const notice = card.querySelector('.manual-step');
      notice.textContent = finding.manualStep || '';
      notice.hidden = !finding.manualStep;
    });
  };
  select.addEventListener('change', () => {
    try { getStorage().setItem('laumlau-tool', select.value); } catch { /* Continue without persistence. */ }
    update();
  });
  report.findings.forEach((finding, index) => {
    cards[index].querySelector('.copy-prompt').addEventListener('click', async (event) => {
      if (await copy(promptFor(finding, select.value), event.currentTarget) !== false) return;
      const card = cards[index];
      card.querySelector('.prompt-panel').open = true;
      const text = card.querySelector('.prompt-text');
      text.focus();
      try {
        const range = text.ownerDocument.createRange();
        range.selectNodeContents(text);
        const selection = text.ownerDocument.defaultView.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      } catch { /* The expanded prompt remains available for manual selection. */ }
    });
  });
  copyPlan.addEventListener('click', async (event) => {
    const copied = await copy(buildFixPlan(report, select.value), event.currentTarget);
    if (copied === false) {
      // Selection may have changed while the Clipboard API was awaiting permission.
      planText.value = buildFixPlan(report, select.value);
      planFallback.hidden = false;
      planText.focus();
      planText.select();
    } else if (copied === true) planFallback.hidden = true;
  });
  update();
}
