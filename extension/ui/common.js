// Helpers shared by the extension pages: localisation, the cached policy, navigation.

import { buildDomainIndex, findService } from '../lib/matching.js';

// The language chosen in the settings, where the edition offers that choice: the worker then
// keeps its code under `uiLanguage`. Without it the pages follow the browser's language.
const chosen = await (async () => {
  try {
    const code = (await chrome.storage.local.get('uiLanguage')).uiLanguage;
    if (typeof code !== 'string' || !/^[a-z]{2}(_[A-Z]{2})?$/.test(code)) return null;
    const packaged = await fetch(chrome.runtime.getURL(`_locales/${code}/messages.json`));
    return { code: code.replace('_', '-'), messages: await packaged.json() };
  } catch {
    return null;
  }
})();

/** The language the pages are shown in, as a BCP 47 code. */
export function language() {
  return chosen?.code ?? chrome.i18n.getUILanguage();
}

/** Fills $1..$9 and named placeholders the way the browser does for its own language. */
function fill(entry, substitutions) {
  const values = substitutions === undefined ? [] : [substitutions].flat().map(String);
  const numbered = (text) => text.replace(/\$([1-9])/g, (_, n) => values[n - 1] ?? '');
  const names = Object.fromEntries(Object.entries(entry.placeholders ?? {}).map(([name, p]) => [name.toLowerCase(), p.content ?? '']));
  return numbered(String(entry.message ?? '').replace(/\$([A-Za-z0-9_@]+)\$/g, (whole, name) => numbered(names[name.toLowerCase()] ?? whole)));
}

/** Localised string; falls back to the key so a missing message is visible, not blank. */
export function t(key, substitutions) {
  const entry = chosen?.messages[key];
  if (entry) return fill(entry, substitutions);
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/** Fills elements marked with data-i18n, data-i18n-placeholder and data-i18n-aria-label. */
export function localize(root = document) {
  document.documentElement.lang = language();
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
}

export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * The company name and the service governing `host`, from the cached policy. The host
 * decides; the service id from the URL is used only if the host is unknown.
 */
export async function lookupService(serviceId, host) {
  const cached = (await chrome.storage.local.get('policy')).policy;
  const policy = cached?.policy;
  if (!policy) return { companyName: '', service: null };
  const service = (host && findService(buildDomainIndex(policy.services), host))
    || policy.services.find((s) => s.id === serviceId)
    || null;
  return { companyName: policy.companyName, service };
}

/** Sends a message to the service worker; resolves to null instead of throwing. */
export async function ask(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return null;
  }
}

/** Leaves the interstitial: back in history if possible, otherwise to a new tab page. */
export async function goBack() {
  if (history.length > 1) {
    history.back();
    return;
  }
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) {
      await chrome.tabs.update(tab.id, { url: 'chrome://newtab/' });
      return;
    }
  } catch {
    // fall through
  }
  location.replace('about:blank');
}

export function formatTime(epochMs) {
  return new Intl.DateTimeFormat(language(), {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(epochMs));
}
