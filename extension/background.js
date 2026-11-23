// Service worker of the free edition. The settings are turned into declarativeNetRequest
// rules, and what is sent to AI sites is checked here with the rules in lib/rules.js.
// What is typed never leaves the browser. Only when an organisation set up a management
// server does the worker talk to a network address: it downloads the settings and checks in
// with its versions and daily counts (lib/remote.js says exactly what).

import { buildDomainIndex, findService, normalizeDomain } from './lib/matching.js';
import { continueUrl } from './lib/pageparams.js';
import {
  buildDynamicRules, buildSessionRules, countByAction, parsePolicy, policyFingerprint, promptMatchPatterns,
} from './lib/policy.js';
import { MAX_REASON_LENGTH, createLog, makeEntry, summarize } from './lib/reporter.js';
import { DEFAULT_REFRESH_MINUTES, buildCheckIn, fetchServerSettings, sendCheckIn } from './lib/remote.js';
import { activeRules, maskText, scanText } from './lib/rules.js';
import {
  DEVICE_KEY, SERVER_CACHE_KEY, SERVER_KEY, SERVER_STATUS_KEY, SETTINGS_KEY, loadSettings, originsFor, serverConfig, toPolicyJson,
} from './lib/settings.js';

const MINUTE_MS = 60 * 1000;
const ALARM_ALLOWS = 'allow-expiry';
const ALARM_SERVER = 'server-sync';
const PROCEED_ALLOW_MS = 60 * MINUTE_MS;

// chrome.storage.local
const POLICY_KEY = 'policy'; // { policy, fetchedAt }: the policy built from the settings
const APPLIED_KEY = 'appliedRules'; // { fingerprint, stats } of the dynamic rules in force
const LANGUAGE_KEY = 'uiLanguage'; // the language chosen in the settings; absent when it follows the browser
// chrome.storage.session (cleared with the browser session, like session rules)
const ALLOWS_KEY = 'proceedAllows'; // service id -> expiry (epoch ms)

const dnr = chrome.declarativeNetRequest;
const local = chrome.storage.local;
const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
const log = createLog({ storage: local });

// ---------------------------------------------------------------- settings and policy

// Loaded once per worker start and again when the settings change. Compiling a person's
// own rules includes a speed trial, so it is not repeated for every message.
let current = null;
function state() {
  current ??= (async () => {
    const { source, settings } = await loadSettings(chrome.storage);
    // A person's own service works only once the browser has been given access to its
    // sites. Until then it is left out, so it cannot hold up the services that do work.
    const granted = [];
    const pending = [];
    for (const service of settings.customServices) {
      const has = await chrome.permissions.contains({ origins: originsFor(service) }).catch(() => false);
      (has ? granted : pending).push(service);
    }
    const inForce = { ...settings, customServices: granted };
    return {
      source, settings, pending: pending.map((s) => s.id),
      policy: parsePolicy(toPolicyJson(inForce)), rules: activeRules(settings),
    };
  })();
  return current;
}

async function applyRules(policy) {
  const fingerprint = policyFingerprint(policy, extensionOrigin);
  const { rules, stats } = buildDynamicRules(policy, { extensionOrigin });
  const existing = await dnr.getDynamicRules();
  const applied = (await local.get(APPLIED_KEY))[APPLIED_KEY];
  if (applied?.fingerprint === fingerprint && existing.length === rules.length) return;
  await dnr.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: rules });
  await local.set({ [APPLIED_KEY]: { fingerprint, stats, appliedAt: Date.now() } });
}

const PROMPT_SCRIPT_ID = 'kyra-prompt-inspection';
const PROMPT_SCRIPT_FILES = ['content/language.js', 'content/prompt-core.js', 'content/file-core.js', 'content/prompt.js'];

/** Registers the page script for the AI sites that are not blocked, or removes it when checks are off. */
async function syncPromptScript(policy) {
  const matches = promptMatchPatterns(policy);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [PROMPT_SCRIPT_ID] });
  if (!matches.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [PROMPT_SCRIPT_ID] });
    return;
  }
  const script = {
    id: PROMPT_SCRIPT_ID, matches, js: PROMPT_SCRIPT_FILES,
    runAt: 'document_start', allFrames: false, persistAcrossSessions: true,
  };
  if (existing.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
  await coverOpenTabs(matches);
}

/**
 * A registered page script reaches only pages loaded after it. AI tabs that were already open
 * (at install, or when a service was just added or allowed) get it here; the script itself
 * ignores a second load.
 */
async function coverOpenTabs(matches) {
  const tabs = await chrome.tabs.query({ url: matches }).catch(() => []);
  await Promise.all(tabs.map((tab) => chrome.scripting.executeScript({
    target: { tabId: tab.id }, files: PROMPT_SCRIPT_FILES,
  }).catch(() => null))); // a tab that is closing or showing an error page
}

let sessionChain = Promise.resolve();
/** Rebuilds the "continue for an hour" allow rules, optionally adding one. */
function syncSessionRules(policy, addAllow = null) {
  const run = sessionChain.then(async () => {
    const allows = (await chrome.storage.session.get(ALLOWS_KEY))[ALLOWS_KEY] ?? {};
    if (addAllow) allows[addAllow.serviceId] = addAllow.expiresAt;
    const { rules, active, nextExpiry } = buildSessionRules(policy, allows, Date.now());
    const existing = await dnr.getSessionRules();
    await dnr.updateSessionRules({ removeRuleIds: existing.map((r) => r.id), addRules: rules });
    await chrome.storage.session.set({ [ALLOWS_KEY]: active });
    if (nextExpiry) await chrome.alarms.create(ALARM_ALLOWS, { when: nextExpiry });
    else await chrome.alarms.clear(ALARM_ALLOWS);
  });
  sessionChain = run.catch((error) => console.error('session rules', error));
  return run;
}

let applying = Promise.resolve();
/** Puts the current settings in force. One at a time, so a quick second change is not lost. */
function apply() {
  const run = applying.then(async () => {
    const { policy, settings } = await state();
    // The pages read this; they are drawn again when it changes.
    const held = (await local.get(LANGUAGE_KEY))[LANGUAGE_KEY];
    if (settings.language === 'auto') {
      if (held) await local.remove(LANGUAGE_KEY);
    } else if (held !== settings.language) await local.set({ [LANGUAGE_KEY]: settings.language });
    await applyRules(policy);
    await local.set({ [POLICY_KEY]: { policy, fetchedAt: Date.now() } });
    await syncSessionRules(policy);
    await syncPromptScript(policy);
    await chrome.action.setBadgeText({ text: '' });
  });
  applying = run.catch(async (error) => {
    console.error('applying settings', error);
    await chrome.action.setBadgeBackgroundColor({ color: '#B42318' });
    await chrome.action.setBadgeText({ text: '!' });
  });
  return applying;
}

// ---------------------------------------------------------------- lookups and the log

async function serviceForHost(host) {
  const { settings, policy, rules } = await state();
  const normalized = normalizeDomain(host);
  const service = normalized ? findService(buildDomainIndex(policy.services), normalized) : null;
  return { settings, policy, rules, service, host: normalized };
}

function record(found, fields, options) {
  if (!found.settings.log) return Promise.resolve();
  const entry = makeEntry({ serviceId: found.service?.id, serviceName: found.service?.name, host: found.host, ...fields });
  return log.add(entry, options).catch((error) => console.error('log', error));
}

const browserLanguage = () => chrome.i18n.getUILanguage().toLowerCase();
const korean = (settings) => (settings.language === 'auto' ? browserLanguage() : settings.language).startsWith('ko');
const ruleLabel = (settings) => (rule) => (korean(settings) ? rule.nameKo || rule.name : rule.name);

const packagedTexts = new Map();
/** The texts of the chosen language for the page script, or null when it follows the browser. */
async function uiStrings() {
  const { language } = (await state()).settings;
  if (language === 'auto') return null;
  if (!packagedTexts.has(language)) {
    const packaged = await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`));
    packagedTexts.set(language, await packaged.json());
  }
  return { language, messages: packagedTexts.get(language) };
}

// ---------------------------------------------------------------- the management server

/** Tells the management server that this browser is covered, and how its checks are doing. */
async function checkIn(server, settingsVersion) {
  // The settings just downloaded are put in force first, so the report describes them.
  current = null;
  const { settings, pending } = await state();
  let device = (await local.get(DEVICE_KEY))[DEVICE_KEY];
  if (!device?.id) {
    device = { id: crypto.randomUUID() };
    await local.set({ [DEVICE_KEY]: device });
  }
  await sendCheckIn(server, buildCheckIn({
    id: device.id, label: server.label, extensionVersion: chrome.runtime.getManifest().version, settingsVersion,
    settings, pendingAccess: pending.length, log: settings.log ? await log.read() : null,
  }));
}

let syncing = Promise.resolve();
/** Downloads the settings from the management server, if there is one. One at a time. */
function syncServer() {
  const run = syncing.then(async () => {
    const server = await serverConfig(chrome.storage);
    if (!server) {
      await chrome.alarms.clear(ALARM_SERVER);
      await local.remove([SERVER_CACHE_KEY, SERVER_STATUS_KEY, DEVICE_KEY]);
      return { ok: true, connected: false };
    }
    const cached = (await local.get(SERVER_CACHE_KEY))[SERVER_CACHE_KEY];
    const held = cached?.url === server.url ? cached : null;
    const result = await fetchServerSettings({ ...server, version: held?.version });
    const now = Date.now();
    let minutes = held?.refreshMinutes ?? DEFAULT_REFRESH_MINUTES;
    if (result.ok && !result.unchanged) {
      minutes = result.refreshMinutes;
      await local.set({ [SERVER_CACHE_KEY]: {
        url: server.url, version: result.version, refreshMinutes: minutes, fetchedAt: now, settings: result.settings,
      } });
    }
    // A download that failed changes nothing: the settings held from before stay in force.
    const status = {
      url: server.url, at: now, ok: result.ok, error: result.ok ? null : result.error,
      version: result.ok && !result.unchanged ? result.version : held?.version ?? null,
    };
    await local.set({ [SERVER_STATUS_KEY]: status });
    await chrome.alarms.create(ALARM_SERVER, { periodInMinutes: minutes });
    if (result.ok) await checkIn(server, status.version);
    return { ...status, connected: true };
  });
  syncing = run.catch((error) => console.error('management server', error));
  return run;
}

// ---------------------------------------------------------------- messages from extension pages

async function snapshot() {
  const { source, settings, policy, rules, pending } = await state();
  const applied = (await local.get(APPLIED_KEY))[APPLIED_KEY] ?? null;
  return {
    ok: true,
    version: chrome.runtime.getManifest().version,
    source,
    server: (await serverConfig(chrome.storage))?.url ?? null,
    pending,
    organisation: settings.organisation,
    counts: countByAction(policy),
    services: policy.services.length,
    inspection: { prompts: settings.inspection.prompts, files: settings.inspection.files },
    activeRules: rules.length,
    logging: settings.log,
    today: summarize(await log.read(), Date.now() - 24 * 60 * MINUTE_MS),
    rules: applied?.stats ?? null,
  };
}

const handlers = {
  status: () => snapshot(),

  syncServer: () => syncServer(),

  async blocked({ host }) {
    const found = await serviceForHost(host);
    if (found.service?.action !== 'block') return { ok: false, error: 'not a blocked service' };
    await record(found, { action: 'blocked' }, { dedupe: true });
    return { ok: true };
  },

  async warned({ host }) {
    const found = await serviceForHost(host);
    if (found.service?.action !== 'alert') return { ok: false, error: 'not a warned service' };
    await record(found, { action: 'warned' }, { dedupe: true });
    return { ok: true };
  },

  async proceed({ host, url, reason }) {
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (!text || text.length > MAX_REASON_LENGTH) return { ok: false, error: 'reason' };
    const found = await serviceForHost(host);
    if (found.service?.action !== 'alert') return { ok: false, error: 'not a warned service' };
    await syncSessionRules(found.policy, { serviceId: found.service.id, expiresAt: Date.now() + PROCEED_ALLOW_MS });
    await record(found, { action: 'proceeded', reason: text });
    return { ok: true, url: continueUrl(url, found.host) };
  },
};

const NOTICE_KEY = 'inspectionNoticeAt';
const NOTICE_EVERY_MS = 30 * 24 * 60 * MINUTE_MS;

/** Whether to say, on the page, that what is sent here is checked: once, then every 30 days. */
async function noticeDue() {
  const last = (await local.get(NOTICE_KEY))[NOTICE_KEY] ?? 0;
  if (Date.now() - last < NOTICE_EVERY_MS) return false;
  await local.set({ [NOTICE_KEY]: Date.now() });
  return true;
}

function hostOf(sender) {
  try {
    return new URL(sender.url).hostname;
  } catch {
    return null;
  }
}

/** What the page script on this tab should hold: messages, files, both or neither. */
async function inspectionSettings(sender) {
  const host = hostOf(sender);
  if (!host) return { prompts: false, files: false };
  const found = await serviceForHost(host);
  const covered = Boolean(found.service) && found.service.action !== 'block';
  const prompts = covered && found.settings.inspection.prompts;
  const files = covered && found.settings.inspection.files;
  return {
    prompts, files, images: false, imageMaxBytes: 0,
    notice: (prompts || files) && await noticeDue(), companyName: found.settings.organisation,
  };
}

/**
 * A message, or the text of a file, from the page script. The site comes from the tab's own
 * address, never from the message. The text is checked here and then dropped.
 */
async function inspect(message, sender) {
  const file = message.type === 'scanFile';
  const host = hostOf(sender);
  if (!host) return { action: 'allow' };
  const found = await serviceForHost(host);
  const { inspection, organisation } = found.settings;
  const enabled = file ? inspection.files : inspection.prompts;
  if (!enabled || !found.service || found.service.action === 'block') return { action: 'allow' };
  const kind = file ? 'file' : 'prompt';
  const fileName = file && typeof message.fileName === 'string' ? message.fileName : undefined;

  if (file && message.unscannable === true) {
    const action = inspection.unscannableFiles;
    if (action === 'allow' || message.proceed === true) {
      if (action !== 'allow') await record(found, { action: 'file_sent_after_warning', fileName, rules: ['File that cannot be checked'] });
      return { action: 'allow' };
    }
    await record(found, { action: action === 'block' ? 'file_blocked' : 'file_warned', fileName, rules: ['File that cannot be checked'] });
    // The page script recognises this finding by its name and shows its own wording.
    return { action, findings: [{ category: 'CUSTOM', name: 'File that cannot be checked' }], companyName: organisation };
  }

  const content = typeof message.content === 'string' ? message.content : '';
  if (!content.trim()) return { action: 'allow' };
  const result = scanText(content, found.rules);
  if (result.action === 'allow') return { action: 'allow' };
  const ruleNames = result.findings.map((f) => f.name);

  // Sent after the warning: let it go, and note that it was.
  if (message.proceed === true && result.action === 'warn') {
    await record(found, { action: `${kind}_sent_after_warning`, fileName, rules: ruleNames });
    return { action: 'allow' };
  }
  await record(found, { action: `${kind}_${result.action === 'block' ? 'blocked' : 'warned'}`, fileName, rules: ruleNames });
  return {
    action: result.action,
    findings: result.findings.map((f) => ({ category: f.category, name: korean(found.settings) ? f.nameKo || f.name : f.name })),
    maskedContent: !file && result.action === 'warn' ? maskText(content, result.spans, ruleLabel(found.settings)) : null,
    mustMask: false,
    companyName: organisation,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  // The page script on an AI site may ask these things only.
  if (sender.tab && !sender.url?.startsWith(extensionOrigin)) {
    if (message?.type === 'scanPrompt' || message?.type === 'scanFile') {
      inspect(message, sender).then(sendResponse, (error) => {
        console.error('check', error);
        sendResponse({ action: 'allow' });
      });
      return true;
    }
    if (message?.type === 'uiStrings') {
      uiStrings().then(sendResponse, () => sendResponse(null));
      return true;
    }
    if (message?.type === 'inspectionSettings') {
      inspectionSettings(sender).then(sendResponse, () => sendResponse({ prompts: false, files: false }));
      return true;
    }
    return false;
  }
  // Everything else is for this extension's own pages.
  if (!sender.url?.startsWith(extensionOrigin)) return false;
  const handler = handlers[message?.type];
  if (!handler) return false;
  handler(message).then(sendResponse, (error) => {
    console.error(message.type, error);
    sendResponse({ ok: false, error: String(error?.message ?? error) });
  });
  return true;
});

// ---------------------------------------------------------------- lifecycle

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await apply();
  syncServer();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  apply();
  syncServer();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_ALLOWS) await syncSessionRules((await state()).policy);
  else if (alarm.name === ALARM_SERVER) await syncServer();
});

function reload() {
  current = null;
  apply();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'managed' || (area === 'local' && (SETTINGS_KEY in changes || SERVER_CACHE_KEY in changes))) reload();
  // The server was set, changed or removed: download from it, or go back to this browser's settings.
  if (area === 'managed' || (area === 'local' && SERVER_KEY in changes)) syncServer();
});

// Access to a site was given or taken away: an own service starts or stops working.
chrome.permissions.onAdded.addListener(reload);
chrome.permissions.onRemoved.addListener(reload);
