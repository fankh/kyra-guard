// Prompt and file inspection on AI sites. Registered by the service worker only for the
// catalog's domains, and only when the company has turned inspection on.
//
// Prompts: when the user sends one (Enter, or a click on the send button), the event is
// held, the text goes to the service worker, which asks KYRA, and then the prompt is either
// sent (the same key or click is replayed), stopped with a notice, or the user is asked.
// For a Redact rule the user may also choose "Mask and send": the text box is rewritten
// with the masked text KYRA returned, and that is sent.
//
// Files: when the user attaches, drops or pastes files, the event is held, each file's text
// is extracted here (file-core.js) and checked the same way, and then the files are handed
// to the page as if nothing had happened, or not at all. The file itself never leaves the
// browser for KYRA; only its text does.
//
// Nothing else on the page is read.

(() => {
  const core = self.KyraPromptCore;
  const fileCore = self.KyraFileCore;
  if (!core || self.kyraPromptInspection) return;
  self.kyraPromptInspection = true;

  const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;
  const SCAN_LIMIT = 100000; // the server's limit; longer text is checked up to here
  const MAX_FILES = 20; // per attach, drop or paste

  let lastEditable = null; // where the user last typed, for clicks on a send button
  let replaying = false; // our own replayed event: let it through
  let busy = false; // a prompt check is in progress: hold further sends
  let cleared = null; // text KYRA just allowed
  let prompts = true; // the worker answers "allow" at once when prompt inspection is off
  let files = false; // files are held only when the company turned file inspection on
  let images = false; // images and PDFs are sent for KYRA to read only when the company asks for it
  let imageMaxBytes = 8 * 1024 * 1024;

  async function message(body) {
    try {
      return await chrome.runtime.sendMessage(body);
    } catch {
      // The extension was reloaded or updated under this page: do not strand the user.
      return null;
    }
  }

  message({ type: 'inspectionSettings' }).then((settings) => {
    if (!settings) return;
    prompts = settings.prompts !== false;
    files = Boolean(settings.files) && Boolean(fileCore);
    images = files && settings.images === true;
    if (Number.isFinite(settings.imageMaxBytes) && settings.imageMaxBytes > 0) imageMaxBytes = settings.imageMaxBytes;
    if (settings.notice) showNotice(settings);
  });

  /** A short note, the first time and then monthly, that what is sent on this site is inspected. */
  function showNotice(settings) {
    const show = () => {
      const host = document.createElement('div');
      host.id = 'kyra-inspection-notice';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        .toast { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; max-width: 360px;
          background: #14306b; color: #fff; border-radius: 8px; padding: 12px 14px;
          font: 13px/1.5 "Segoe UI", "Malgun Gothic", system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0, 0, 0, .3); }
        b { display: block; margin-bottom: 2px; }
        button { all: unset; cursor: pointer; float: right; margin-left: 10px; font-size: 16px; line-height: 1; }
      `;
      const toast = element('div', 'toast');
      toast.setAttribute('role', 'status');
      const close = element('button', '', '\u00d7');
      close.setAttribute('aria-label', t('fileClose'));
      close.addEventListener('click', () => host.remove());
      toast.append(close, element('b', '', 'KYRA AI Guardrail'));
      toast.append(document.createTextNode(t(settings.prompts && settings.files ? 'noticeInspectionBoth'
        : settings.files ? 'noticeInspectionFiles' : 'noticeInspectionPrompts')));
      shadow.append(style, toast);
      document.documentElement.append(host);
      setTimeout(() => host.remove(), 12000);
    };
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  }

  function stop(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function replay(action) {
    replaying = true;
    try {
      action();
    } finally {
      replaying = false;
    }
  }

  // ---- prompts --------------------------------------------------------------------

  document.addEventListener('focusin', (event) => {
    const editable = core.editableFrom(event.target);
    if (editable) lastEditable = editable;
  }, true);

  window.addEventListener('keydown', (event) => {
    if (replaying || !prompts || !core.isSubmitKey(event)) return;
    const editable = core.editableFrom(event.target);
    if (!editable) return;
    lastEditable = editable;
    hold(event, editable, () => replayKey(editable, event));
  }, true);

  window.addEventListener('click', (event) => {
    if (replaying || !prompts) return;
    const button = core.submitButtonFrom(event.target);
    if (!button || !lastEditable || !lastEditable.isConnected) return;
    hold(event, lastEditable, () => button.click());
  }, true);

  function hold(event, editable, resend) {
    const text = core.readText(editable);
    if (!text.trim()) return;
    if (busy) {
      stop(event);
      return;
    }
    if (text === cleared) {
      cleared = null;
      return;
    }
    stop(event);
    check(text, editable, resend);
  }

  async function ask(text, proceed, masked = false) {
    return (await message({ type: 'scanPrompt', content: text.slice(0, SCAN_LIMIT), proceed, masked }))
      || { action: 'allow' };
  }

  /** Puts `value` in the text box the way typing would, so the page's own code notices. True if it took. */
  function setText(editable, value) {
    editable.focus();
    const tag = (editable.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      const prototype = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(editable, value);
      editable.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(editable);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand('insertText', false, value)) {
        editable.textContent = value;
        editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      }
    }
    return core.sameText(core.readText(editable), value);
  }

  async function check(text, editable, resend) {
    busy = true;
    let response;
    try {
      response = await ask(text, false);
    } finally {
      busy = false;
    }
    const action = core.decide(response);
    if (action === 'allow') {
      send(text, editable, resend);
      return;
    }
    const company = response.companyName || t('yourCompany');
    // The masked text covers what was scanned: not offered for text longer than the scan limit.
    const maskedText = action === 'warn' && typeof response.maskedContent === 'string'
      && response.maskedContent && text.length <= SCAN_LIMIT ? response.maskedContent : null;
    const mustMask = action === 'warn' && response.mustMask === true;
    const choice = await dialog({
      title: t(response.unavailable ? 'promptUnavailableTitle'
        : action === 'block' ? 'promptBlockedTitle' : 'promptWarnTitle'),
      body: response.unavailable ? t('promptUnavailableBody', [company])
        : t(action === 'block' ? 'promptBlockedBody' : 'promptWarnBody', [company]),
      lines: findingLines(response.findings),
      note: t(action !== 'warn' ? 'promptBlockedNote' : mustMask ? 'promptMustMaskNote' : 'promptWarnNote'),
      back: t('promptEdit'),
      proceed: action === 'warn' && !mustMask ? t('promptSendAnyway') : null,
      mask: maskedText ? t('promptMaskAndSend') : null,
    });
    if (action === 'warn' && choice === 'send') {
      await ask(text, true); // recorded as sent after the warning
      send(text, editable, resend);
    } else if (choice === 'mask' && maskedText && editable.isConnected) {
      if (!setText(editable, maskedText)) {
        // The page's editor did not take the change: never send the original by accident.
        await dialog({
          title: t('promptMaskFailedTitle'), body: t('promptMaskFailedBody'), lines: [], note: '',
          back: t('promptEdit'), proceed: null, mask: null,
        });
        editable.focus();
        return;
      }
      await ask(text, false, true); // recorded as sent masked
      // Give the page a moment to take in the new text before the send is replayed.
      setTimeout(() => send(core.readText(editable), editable, resend), 80);
    } else if (editable.isConnected) {
      editable.focus();
    }
  }

  function send(text, editable, resend) {
    cleared = text;
    replay(resend);
    // A replayed key does not trigger the browser's own form submission, so if the text
    // is still there, press the send button (or submit the form) instead.
    setTimeout(() => {
      cleared = null;
      if (!editable.isConnected || core.readText(editable) !== text) return;
      const form = editable.closest('form');
      const button = (form || document).querySelector(
        'button[data-testid*="send" i], button[aria-label*="send" i], button[type="submit"]');
      replay(() => {
        if (button && !button.disabled) button.click();
        else if (form) form.requestSubmit();
      });
    }, 400);
  }

  function replayKey(editable, original) {
    editable.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: original.code || 'Enter', keyCode: 13, which: 13,
      ctrlKey: original.ctrlKey, metaKey: original.metaKey,
      bubbles: true, cancelable: true, composed: true,
    }));
  }

  // ---- files ----------------------------------------------------------------------

  function transferOf(list, text) {
    const transfer = new DataTransfer();
    for (const file of list) transfer.items.add(file);
    if (text) transfer.setData('text/plain', text);
    return transfer;
  }

  function isFileInput(target) {
    return Boolean(target) && target.tagName === 'INPUT' && String(target.type).toLowerCase() === 'file';
  }

  // A file input fires "input" and then "change"; the page must see neither until the check is done.
  window.addEventListener('input', (event) => {
    if (!replaying && files && isFileInput(event.target) && event.target.files?.length) stop(event);
  }, true);

  window.addEventListener('change', (event) => {
    const input = event.target;
    if (replaying || !files || !isFileInput(input)) return;
    const list = [...(input.files || [])];
    if (!list.length) return;
    stop(event);
    input.value = ''; // the page must not find the files on the input meanwhile
    checkFiles(list, () => {
      input.files = transferOf(list).files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, true);

  window.addEventListener('drop', (event) => {
    if (replaying || !files) return;
    const list = [...(event.dataTransfer?.files || [])];
    if (!list.length) return;
    stop(event);
    const { target, clientX, clientY } = event;
    checkFiles(list, () => {
      target.dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, composed: true, dataTransfer: transferOf(list), clientX, clientY,
      }));
    });
  }, true);

  window.addEventListener('paste', (event) => {
    if (replaying || !files) return;
    const list = [...(event.clipboardData?.files || [])];
    if (!list.length) return;
    const text = event.clipboardData.getData('text/plain');
    stop(event);
    const { target } = event;
    checkFiles(list, () => {
      target.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, composed: true, clipboardData: transferOf(list, text),
      }));
    });
  }, true);

  function askFile(file, extracted, proceed) {
    return message({
      type: 'scanFile', fileName: file.name, proceed,
      unscannable: !extracted.scannable,
      content: extracted.scannable ? extracted.text : '',
      // An image or PDF: KYRA reads its text. An older server ignores the bytes.
      ...(extracted.bytes ? { contentBase64: extracted.bytes } : {}),
    });
  }

  /** Reads the file's text here, or its bytes for KYRA to read when it is an image or a PDF. */
  async function extractFile(file) {
    const extracted = await fileCore.extractText(file);
    if (!extracted.scannable && images && fileCore.serverReadable(file.name, file.type)) {
      try {
        const bytes = await fileCore.readBase64(file, imageMaxBytes);
        if (bytes) return { scannable: false, bytes };
      } catch {
        // Unreadable here too: it stays a file that cannot be inspected.
      }
    }
    return extracted;
  }

  /** The server could not read the file either (or was not asked to). */
  function notInspected(result) {
    if (result.extracted.scannable) return false;
    const findings = result.response.findings || [];
    return !result.extracted.bytes || !findings.length
      || findings.every((f) => /^File that c/.test(String(f.name || '')));
  }

  /** Checks every file; hands them all to the page, or none. */
  async function checkFiles(list, deliver) {
    if (list.length > MAX_FILES) {
      await dialog({
        title: t('fileBlockedTitle'), body: t('fileTooMany', [String(MAX_FILES)]), lines: [],
        note: '', back: t('fileClose'), proceed: null,
      });
      return;
    }
    const results = [];
    for (const file of list) {
      const extracted = await extractFile(file);
      const response = (await askFile(file, extracted, false)) || { action: 'allow' };
      results.push({ file, extracted, response, action: core.decide(response) });
    }
    const stopped = results.filter((r) => r.action === 'block');
    const warned = results.filter((r) => r.action === 'warn');
    if (!stopped.length && !warned.length) {
      replay(deliver);
      return;
    }
    const action = stopped.length ? 'block' : 'warn';
    const shown = stopped.length ? stopped : warned;
    const company = shown[0].response.companyName || t('yourCompany');
    const choice = await dialog({
      title: t(action === 'block' ? 'fileBlockedTitle' : 'fileWarnTitle'),
      body: t(action === 'block' ? 'fileBlockedBody' : 'fileWarnBody', [company]),
      lines: shown.map((r) => ({
        strong: r.file.name,
        rest: r.response.unavailable ? t('fileUnavailable')
          : notInspected(r) ? t('fileUnscannable')
            : findingLines(r.response.findings).map((line) => line.strong + (line.rest ? ` (${line.rest})` : '')).join(', '),
      })),
      note: t(action === 'warn' ? 'fileWarnNote' : 'fileBlockedNote'),
      back: t(action === 'warn' ? 'fileCancel' : 'fileClose'),
      proceed: action === 'warn' ? t('fileSendAnyway') : null,
    });
    if (action === 'warn' && choice === 'send') {
      for (const r of warned) await askFile(r.file, r.extracted, true); // recorded
      replay(deliver);
    }
  }

  // ---- the notice -----------------------------------------------------------------

  const CATEGORY_KEYS = {
    PII: 'promptCategoryPii', FINANCIAL: 'promptCategoryFinancial', CREDENTIALS: 'promptCategoryCredentials',
    HEALTHCARE: 'promptCategoryHealthcare', INTELLECTUAL_PROPERTY: 'promptCategoryIp', CUSTOM: 'promptCategoryCustom',
  };

  function findingLines(findings) {
    return (Array.isArray(findings) ? findings : []).slice(0, 8).map((f) => ({
      strong: t(CATEGORY_KEYS[f.category] || 'promptCategoryCustom'),
      rest: f.name || '',
    }));
  }

  const STYLE = `
    :host { all: initial; }
    .veil { position: fixed; inset: 0; background: rgba(15, 23, 42, .45); z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      font: 14px/1.5 "Segoe UI", "Malgun Gothic", system-ui, sans-serif; color: #1a1f29; }
    .box { background: #fff; border-radius: 10px; width: min(480px, calc(100vw - 32px)); padding: 22px 24px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, .25); }
    .brand { color: #14306b; font-weight: 600; font-size: 13px; margin-bottom: 10px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { margin: 0 0 10px; }
    ul { margin: 0 0 12px; padding: 10px 14px 10px 30px; background: #eef2fa; border-radius: 6px;
      overflow-wrap: anywhere; }
    li b { font-weight: 600; }
    .note { color: #5b6575; font-size: 12.5px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    button { font: inherit; padding: 7px 16px; border-radius: 6px; border: 1px solid #c9d0dc; background: #fff;
      color: #1a1f29; cursor: pointer; }
    button.primary { background: #14306b; border-color: #14306b; color: #fff; }
    button:focus-visible { outline: 2px solid #1f56c9; outline-offset: 2px; }
  `;

  /**
   * Shows the notice and resolves to 'edit', 'send' or 'mask'.
   * view: {title, body, lines: [{strong, rest}], note, back, proceed, mask (labels or null)}.
   */
  function dialog(view) {
    return new Promise((resolve) => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = STYLE;
      const veil = element('div', 'veil');
      const box = element('div', 'box');
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      box.append(element('div', 'brand', 'KYRA AI Guardrail'));
      box.append(element('h1', '', view.title));
      box.append(element('p', '', view.body));
      if (view.lines.length) {
        const list = element('ul');
        for (const line of view.lines) {
          const item = element('li');
          item.append(element('b', '', line.strong));
          if (line.rest) item.append(document.createTextNode(` · ${line.rest}`));
          list.append(item);
        }
        box.append(list);
      }
      if (view.note) box.append(element('p', 'note', view.note));
      const actions = element('div', 'actions');
      const done = (choice) => {
        host.remove();
        resolve(choice);
      };
      if (view.proceed) {
        const proceed = element('button', '', view.proceed);
        proceed.addEventListener('click', () => done('send'));
        actions.append(proceed);
      }
      if (view.mask) {
        const mask = element('button', '', view.mask);
        mask.addEventListener('click', () => done('mask'));
        actions.append(mask);
      }
      const back = element('button', 'primary', view.back);
      back.addEventListener('click', () => done('edit'));
      actions.append(back);
      box.append(actions);
      veil.append(box);
      veil.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') done('edit');
      });
      shadow.append(style, veil);
      document.documentElement.append(host);
      back.focus();
    });
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
})();
