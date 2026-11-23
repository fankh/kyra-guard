// popup.html: what the extension is doing in this browser right now.

import { ask, localize, setText, t } from './common.js';

localize();

function render(snapshot) {
  if (!snapshot?.ok) return;
  setText('company', snapshot.organisation || '');
  setText('services', String(snapshot.services));
  setText('blocked-count', String(snapshot.counts.block));
  setText('warned-count', String(snapshot.counts.alert));
  const { prompts, files } = snapshot.inspection;
  setText('checks', prompts && files ? t('popupChecksBoth') : prompts ? t('popupChecksPrompts')
    : files ? t('popupChecksFiles') : t('popupChecksOff'));
  document.getElementById('checks').className = prompts || files ? 'status-ok' : 'status-warn';
  setText('rules', String(snapshot.activeRules));
  const today = snapshot.today ?? {};
  const stopped = (today.blocked ?? 0) + (today.prompt_blocked ?? 0) + (today.file_blocked ?? 0);
  const warned = (today.warned ?? 0) + (today.prompt_warned ?? 0) + (today.file_warned ?? 0);
  setText('today', snapshot.logging ? t('popupTodayCounts', [String(stopped), String(warned)]) : t('popupLogOff'));
  const note = document.getElementById('managed-note');
  note.hidden = snapshot.source !== 'managed' && snapshot.source !== 'server';
  if (snapshot.source === 'server') note.textContent = t('optionsServerManaged');
  if (snapshot.server) setText('local-notice', t('serverNotice', [snapshot.server]));
}

document.getElementById('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

render(await ask({ type: 'status' }));
