// Prompt inspection: the decisions that need no browser API, so they can be unit-tested
// in Node. A classic script (content scripts cannot be modules); it puts one object on the
// global and prompt.js, loaded after it, uses that.

(function (root) {
  const SEND_WORDS = /send|submit|보내기|전송/i;
  const NOT_SEND_WORDS = /stop|cancel|attach|upload|voice|dictat|microphone|중지|취소|첨부|음성/i;
  const TEXT_INPUT_TYPES = new Set(['', 'text', 'search']);

  /**
   * Enter without Shift sends on AI sites. Not while an IME is composing (Korean, Japanese,
   * Chinese: Enter then confirms the syllable; keyCode 229 covers browsers that do not set
   * isComposing).
   */
  function isSubmitKey(event) {
    return event.key === 'Enter' && !event.shiftKey && !event.altKey
      && !event.isComposing && event.keyCode !== 229;
  }

  /** The text box an event target belongs to: a textarea, a text input or a contenteditable root. */
  function editableFrom(target) {
    if (!target || typeof target.closest !== 'function') return null;
    const tag = (target.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA') return target;
    if (tag === 'INPUT') {
      return TEXT_INPUT_TYPES.has(String(target.getAttribute('type') || '').toLowerCase()) ? target : null;
    }
    const host = target.closest('[contenteditable]');
    if (!host) return null;
    const value = String(host.getAttribute('contenteditable') ?? '').toLowerCase();
    return value === 'false' ? null : host;
  }

  function readText(element) {
    if (!element) return '';
    const tag = (element.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT') return String(element.value ?? '');
    return String(element.innerText ?? element.textContent ?? '');
  }

  /** The send button a click landed on (or inside), or null. */
  function submitButtonFrom(target) {
    if (!target || typeof target.closest !== 'function') return null;
    const button = target.closest('button, [role="button"], input[type="submit"]');
    if (!button || button.disabled) return null;
    const label = ['aria-label', 'data-testid', 'title', 'id', 'name']
      .map((name) => button.getAttribute(name) || '').join(' ');
    if (NOT_SEND_WORDS.test(label)) return null;
    if (SEND_WORDS.test(label)) return button;
    const type = String(button.getAttribute('type') || '').toLowerCase();
    // An unlabelled button counts only as the submit button of a form.
    return type === 'submit' && button.closest('form') ? button : null;
  }

  /** What to do with the server's (or the worker's) answer. */
  function decide(response) {
    const action = response && response.action;
    if (action === 'block' || action === 'warn') return action;
    return 'allow';
  }

  /** Whether two texts are the same apart from white space (editors add and drop line ends). */
  function sameText(a, b) {
    const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
    return squash(a) === squash(b);
  }

  root.KyraPromptCore = { isSubmitKey, editableFrom, readText, submitButtonFrom, decide, sameText };
})(typeof self !== 'undefined' ? self : globalThis);
