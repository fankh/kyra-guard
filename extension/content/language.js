// Runs before the page script on AI sites. When a language was chosen in the settings, the
// texts the page script shows come from that language instead of the browser's: the worker
// hands them over and the page script's own lookup is pointed at them. With the choice left
// on "browser language" this does nothing.

(() => {
  if (self.kyraLanguage) return;
  self.kyraLanguage = true;

  /** Fills $1..$9 and named placeholders the way the browser does for its own language. */
  function fill(entry, substitutions) {
    const values = substitutions === undefined ? [] : [substitutions].flat().map(String);
    const numbered = (text) => text.replace(/\$([1-9])/g, (_, n) => values[n - 1] ?? '');
    const names = Object.fromEntries(Object.entries(entry.placeholders ?? {}).map(([name, p]) => [name.toLowerCase(), p.content ?? '']));
    return numbered(String(entry.message ?? '').replace(/\$([A-Za-z0-9_@]+)\$/g, (whole, name) => numbered(names[name.toLowerCase()] ?? whole)));
  }

  chrome.runtime.sendMessage({ type: 'uiStrings' }).then((strings) => {
    if (!strings?.messages) return;
    const browserText = chrome.i18n.getMessage.bind(chrome.i18n);
    chrome.i18n.getMessage = (key, substitutions) => {
      const entry = strings.messages[key];
      return entry ? fill(entry, substitutions) : browserText(key, substitutions);
    };
  }).catch(() => {}); // the worker is restarting: the browser's language is used
})();
