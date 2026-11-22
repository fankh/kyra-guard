// options.html: every setting of the free edition. A change is saved at once to this
// browser's storage and the worker puts it in force. When an administrator pushed the
// settings through browser policy, the page only shows them.

import { LOG_KEY, toCsv } from '../lib/reporter.js';
import { BUILTIN_RULES, activeRules, compileCustomRule, maskText, scanText } from '../lib/rules.js';
import {
  SETTINGS_KEY, defaultSettings, effectiveServices, loadSettings, normalizeSettings, originsFor,
} from '../lib/settings.js';
import { formatTime, localize, setText, t } from './common.js';

localize();

const korean = chrome.i18n.getUILanguage().toLowerCase().startsWith('ko');
const ruleName = (rule) => (korean ? rule.nameKo || rule.name : rule.name);
const $ = (id) => document.getElementById(id);

let settings = defaultSettings();
let managed = false;

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

function select(options, value, onChange, label) {
  const node = el('select', { disabled: managed });
  node.setAttribute('aria-label', label);
  for (const [optionValue, text] of options) node.append(el('option', { value: optionValue, textContent: text }));
  node.value = value;
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

function showError(text) {
  $('error').textContent = text;
  $('error').hidden = !text;
}

/** Saves the settings; the worker reacts to the storage change. */
async function save(next) {
  if (managed) return;
  settings = normalizeSettings(next);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  showError('');
  render();
}

// ---------------------------------------------------------------- services

/** Whether the browser has given access to the sites of an own service. */
const hasAccess = (service) => chrome.permissions.contains({ origins: originsFor(service) }).catch(() => false);

/** Asks the browser for access to a service's sites. Must run straight from a click. */
const askAccess = (service) => chrome.permissions.request({ origins: originsFor(service) }).catch(() => false);

let servicesRendered = 0;
async function renderServices() {
  const turn = ++servicesRendered;
  const access = new Map(await Promise.all(settings.customServices.map(async (s) => [s.id, await hasAccess(s)])));
  if (turn !== servicesRendered) return; // a newer call is already drawing the table
  const filter = $('service-filter').value.trim().toLowerCase();
  const body = $('services').tBodies[0];
  body.replaceChildren();
  const actions = [['', t('actDefault')], ['allow', t('actAllow')], ['alert', t('actWarn')], ['block', t('actBlock')]];
  for (const service of effectiveServices(settings)) {
    const haystack = `${service.name} ${service.vendor} ${service.domains.join(' ')}`.toLowerCase();
    if (filter && !haystack.includes(filter)) continue;
    const name = el('td', {}, [service.name]);
    if (service.vendor) name.append(el('small', { textContent: service.vendor }));
    if (service.custom) name.append(el('small', { textContent: t('ownService') }));
    const waiting = service.custom && access.get(service.id) === false;
    if (waiting) name.append(el('span', { className: 'tag warn', textContent: t('needsAccess') }));
    const chosen = service.custom ? service.action : settings.services[service.id] ?? '';
    const picker = select(service.custom ? actions.slice(1) : actions, chosen, (value) => {
      if (service.custom) {
        save({ ...settings, customServices: settings.customServices.map((s) => (s.id === service.id ? { ...s, action: value } : s)) });
      } else {
        const services = { ...settings.services };
        if (value) services[service.id] = value;
        else delete services[service.id];
        save({ ...settings, services });
      }
    }, `${service.name}: ${t('colAction')}`);
    const remove = el('td');
    if (waiting) {
      const grant = el('button', { type: 'button', className: 'primary', textContent: t('optGrant') });
      grant.addEventListener('click', async () => {
        await askAccess(service);
        renderServices();
      });
      remove.append(grant, ' ');
    }
    if (service.custom && !managed) {
      const button = el('button', { type: 'button', textContent: t('optRemove') });
      button.addEventListener('click', () => save({ ...settings, customServices: settings.customServices.filter((s) => s.id !== service.id) }));
      remove.append(button);
    }
    body.append(el('tr', {}, [name, el('td', { className: 'domains', textContent: service.domains.join(', ') }), el('td', {}, [picker]), remove]));
  }
}

$('service-filter').addEventListener('input', renderServices);

$('service-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const candidate = { name: $('service-name').value, domains: $('service-domains').value, action: $('service-action').value };
  const before = settings.customServices.length;
  const next = normalizeSettings({ ...settings, customServices: [...settings.customServices, candidate] });
  if (next.customServices.length === before) return showError(t('errService'));
  // The browser asks the person here; nothing before this line waits, so the click still counts.
  if (!(await askAccess(next.customServices[before]))) return showError(t('errAccess'));
  $('service-name').value = '';
  $('service-domains').value = '';
  await save(next);
});

// ---------------------------------------------------------------- rules

const RULE_ERRORS = {
  name: 'errRuleName', pattern: 'errRulePattern', tooLong: 'errRuleTooLong', invalid: 'errRuleInvalid',
  slow: 'errRuleSlow', empty: 'errRuleEmpty',
};
const CATEGORY_KEYS = {
  PII: 'promptCategoryPii', FINANCIAL: 'promptCategoryFinancial', CREDENTIALS: 'promptCategoryCredentials', CUSTOM: 'promptCategoryCustom',
};

function renderRules() {
  const body = $('rules').tBodies[0];
  body.replaceChildren();
  const actions = [['off', t('actOff')], ['warn', t('actWarn')], ['block', t('actBlock')]];
  for (const rule of BUILTIN_RULES) {
    const picker = select(actions, settings.rules[rule.id] ?? rule.action,
      (value) => save({ ...settings, rules: { ...settings.rules, [rule.id]: value } }), `${ruleName(rule)}: ${t('colAction')}`);
    body.append(el('tr', {}, [el('td', { textContent: ruleName(rule) }), el('td', { textContent: t(CATEGORY_KEYS[rule.category]) }), el('td', {}, [picker]), el('td')]));
  }
  for (const rule of settings.customRules) {
    const name = el('td', {}, [rule.name, el('small', { className: 'mono', textContent: rule.pattern })]);
    const picker = select(actions, rule.action,
      (value) => save({ ...settings, customRules: settings.customRules.map((r) => (r.id === rule.id ? { ...r, action: value } : r)) }),
      `${rule.name}: ${t('colAction')}`);
    const remove = el('td');
    if (!managed) {
      const button = el('button', { type: 'button', textContent: t('optRemove') });
      button.addEventListener('click', () => save({ ...settings, customRules: settings.customRules.filter((r) => r.id !== rule.id) }));
      remove.append(button);
    }
    body.append(el('tr', {}, [name, el('td', { textContent: t(rule.type === 'regex' ? 'kindRegex' : 'kindKeyword') }), el('td', {}, [picker]), remove]));
  }
}

$('rule-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const candidate = {
    id: `custom-${Date.now().toString(36)}`, name: $('rule-name').value, type: $('rule-type').value,
    pattern: $('rule-pattern').value, action: $('rule-action').value,
  };
  const compiled = compileCustomRule(candidate);
  if (!compiled.ok) return showError(t(RULE_ERRORS[compiled.error]));
  $('rule-name').value = '';
  $('rule-pattern').value = '';
  await save({ ...settings, customRules: [...settings.customRules, candidate] });
});

/** Tries the rules in force on the text in the box. Nothing is saved or logged. */
function renderTry() {
  const text = $('try-text').value;
  const masked = $('try-masked');
  if (!text.trim()) {
    setText('try-result', '');
    masked.hidden = true;
    return;
  }
  const result = scanText(text, activeRules(settings));
  if (result.action === 'allow') {
    setText('try-result', t('tryNothing'));
    masked.hidden = true;
    return;
  }
  const found = result.findings.map((f) => `${korean ? f.nameKo || f.name : f.name} × ${f.count}`).join(', ');
  setText('try-result', `${t(result.action === 'block' ? 'tryBlock' : 'tryWarn')} ${found}`);
  masked.textContent = maskText(text, result.spans, ruleName);
  masked.hidden = false;
}
$('try-text').addEventListener('input', renderTry);

// ---------------------------------------------------------------- activity log

const LOG_TONE = {
  blocked: 'block', prompt_blocked: 'block', file_blocked: 'block',
  warned: 'warn', prompt_warned: 'warn', file_warned: 'warn',
};

async function renderLog() {
  const entries = (await chrome.storage.local.get(LOG_KEY))[LOG_KEY] ?? [];
  const body = $('log').tBodies[0];
  body.replaceChildren();
  for (const entry of entries.slice(0, 100)) {
    const tag = el('span', { className: `tag ${LOG_TONE[entry.action] ?? 'note'}`, textContent: t(`log_${entry.action}`) });
    const detail = [entry.fileName, (entry.rules ?? []).join(', '), entry.reason].filter(Boolean).join(' · ');
    const service = el('td', {}, [entry.serviceName || '—']);
    if (entry.host) service.append(el('small', { textContent: entry.host }));
    body.append(el('tr', {}, [el('td', { textContent: formatTime(entry.at) }), el('td', {}, [tag]), service, el('td', { className: 'detail', textContent: detail })]));
  }
  $('log').parentElement.hidden = entries.length === 0;
  $('log-empty').hidden = entries.length !== 0;
  $('log-export').disabled = entries.length === 0;
  $('log-clear').disabled = entries.length === 0;
}

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

$('log-export').addEventListener('click', async () => {
  const entries = (await chrome.storage.local.get(LOG_KEY))[LOG_KEY] ?? [];
  // The mark at the start lets spreadsheet programs read Korean text.
  download(`kyra-guardrail-free-log-${stamp()}.csv`, 'text/csv;charset=utf-8', `﻿${toCsv(entries)}`);
});

$('log-clear').addEventListener('click', async () => {
  if (!confirm(t('confirmClearLog'))) return;
  await chrome.storage.local.remove(LOG_KEY);
  await renderLog();
});

// ---------------------------------------------------------------- backup

$('settings-export').addEventListener('click', () => {
  download(`kyra-guardrail-free-settings-${stamp()}.json`, 'application/json', JSON.stringify(settings, null, 2));
});

$('settings-import').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file || managed) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return showError(t('errImport'));
  await save(parsed);
  setText('message', t('msgImported'));
});

$('settings-reset').addEventListener('click', async () => {
  if (managed || !confirm(t('confirmReset'))) return;
  await chrome.storage.local.remove(SETTINGS_KEY);
  settings = defaultSettings();
  render();
  setText('message', t('msgReset'));
});

// ---------------------------------------------------------------- general and checks

const bind = (id, event, change) => $(id).addEventListener(event, () => save(change($(id))));
bind('organisation', 'change', (node) => ({ ...settings, organisation: node.value }));
bind('defaultAction', 'change', (node) => ({ ...settings, defaultAction: node.value }));
bind('check-prompts', 'change', (node) => ({ ...settings, inspection: { ...settings.inspection, prompts: node.checked } }));
bind('check-files', 'change', (node) => ({ ...settings, inspection: { ...settings.inspection, files: node.checked } }));
bind('unscannable', 'change', (node) => ({ ...settings, inspection: { ...settings.inspection, unscannableFiles: node.value } }));
bind('log-enabled', 'change', (node) => ({ ...settings, log: node.checked }));

function render() {
  $('managed-banner').hidden = !managed;
  $('organisation').value = settings.organisation;
  $('defaultAction').value = settings.defaultAction;
  $('check-prompts').checked = settings.inspection.prompts;
  $('check-files').checked = settings.inspection.files;
  $('unscannable').value = settings.inspection.unscannableFiles;
  $('log-enabled').checked = settings.log;
  for (const id of ['organisation', 'defaultAction', 'check-prompts', 'check-files', 'unscannable', 'log-enabled',
    'settings-import', 'settings-reset']) $(id).disabled = managed;
  for (const id of ['service-form', 'rule-form']) $(id).hidden = managed;
  renderServices();
  renderRules();
  renderTry();
}

async function load() {
  const loaded = await loadSettings(chrome.storage);
  managed = loaded.source === 'managed';
  settings = loaded.settings;
  render();
  await renderLog();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'managed') load();
  else if (area === 'local' && LOG_KEY in changes) renderLog();
});

setText('version', chrome.runtime.getManifest().version);
await load();
