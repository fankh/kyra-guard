// The settings, all of them kept in this browser. Where they come from:
//  - an administrator may push them through browser policy (chrome.storage.managed,
//    `settingsJson`), and then they cannot be changed here;
//  - an organisation may run a small management server (see lib/remote.js); the settings
//    downloaded from it are then used as a whole, the same way;
//  - otherwise the options page stores them in chrome.storage.local.
// Pure functions apart from serverConfig and loadSettings; unit-tested in Node.

import { CATALOG } from './catalog.js';
import { normalizeDomain } from './matching.js';
import { ACTIONS } from './policy.js';
import { normalizeServerUrl } from './remote.js';
import { BUILTIN_RULES, MAX_CUSTOM_RULES, RULE_ACTIONS, compileCustomRule } from './rules.js';

export const SETTINGS_KEY = 'settings';
export const SETTINGS_FORMAT = 1;
export const UNSCANNABLE = Object.freeze(['allow', 'warn', 'block']);
export const MAX_CUSTOM_SERVICES = 200;
// 'auto' follows the browser; the others are the languages in _locales/.
export const LANGUAGES = Object.freeze(['auto', 'en', 'ko']);
// chrome.storage.local
export const SERVER_KEY = 'server'; // { url, key }: the management server typed in the settings page
export const SERVER_CACHE_KEY = 'serverSettings'; // { url, version, fetchedAt, settings }: the last download
export const SERVER_STATUS_KEY = 'serverStatus'; // { url, at, ok, error, version }: how the last download went
const MAX_DOMAINS_PER_SERVICE = 30;

/** What a new install does: every known AI service opens, and what is sent to it is checked. */
export function defaultSettings() {
  return {
    format: SETTINGS_FORMAT,
    organisation: '',
    language: 'auto',
    defaultAction: 'allow',
    services: {},
    customServices: [],
    inspection: { prompts: true, files: true, unscannableFiles: 'allow' },
    rules: {},
    customRules: [],
    log: true,
  };
}

function cleanCustomService(raw, taken) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : '';
  const domains = [...new Set((Array.isArray(raw.domains) ? raw.domains : String(raw.domains ?? '').split(/[\s,]+/))
    .map(normalizeDomain).filter((d) => d && d.includes('.')))].slice(0, MAX_DOMAINS_PER_SERVICE);
  if (!name || !domains.length) return null;
  let id = typeof raw.id === 'string' && /^custom-[a-z0-9-]{1,60}$/.test(raw.id) ? raw.id
    : `custom-${domains[0].replace(/[^a-z0-9]+/g, '-')}`;
  while (taken.has(id)) id = `${id}-2`;
  taken.add(id);
  return { id, name, domains, action: ACTIONS.includes(raw.action) ? raw.action : 'alert' };
}

/**
 * Returns settings that are safe to use, whatever was stored or imported: unknown keys are
 * dropped, wrong values fall back to the defaults, and rules that do not compile are left out.
 */
export function normalizeSettings(raw, options) {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

  const known = new Set(CATALOG.map((s) => s.id));
  const services = {};
  for (const [id, action] of Object.entries(raw.services ?? {})) {
    if (known.has(id) && ACTIONS.includes(action)) services[id] = action;
  }
  const taken = new Set(known);
  const customServices = (Array.isArray(raw.customServices) ? raw.customServices : [])
    .slice(0, MAX_CUSTOM_SERVICES).map((s) => cleanCustomService(s, taken)).filter(Boolean);

  const builtin = new Set(BUILTIN_RULES.map((r) => r.id));
  const rules = {};
  for (const [id, action] of Object.entries(raw.rules ?? {})) {
    if (builtin.has(id) && RULE_ACTIONS.includes(action)) rules[id] = action;
  }
  const ruleIds = new Set();
  const customRules = [];
  for (const candidate of (Array.isArray(raw.customRules) ? raw.customRules : []).slice(0, MAX_CUSTOM_RULES)) {
    const compiled = compileCustomRule(candidate, options);
    if (!compiled.ok || ruleIds.has(compiled.rule.id)) continue;
    ruleIds.add(compiled.rule.id);
    const { id, name, type, pattern, action } = compiled.rule;
    customRules.push({ id, name, type, pattern, action });
  }

  return {
    format: SETTINGS_FORMAT,
    organisation: typeof raw.organisation === 'string' ? raw.organisation.trim().slice(0, 80) : '',
    language: LANGUAGES.includes(raw.language) ? raw.language : base.language,
    defaultAction: ACTIONS.includes(raw.defaultAction) ? raw.defaultAction : base.defaultAction,
    services,
    customServices,
    inspection: {
      prompts: raw.inspection?.prompts !== false,
      files: raw.inspection?.files !== false,
      unscannableFiles: UNSCANNABLE.includes(raw.inspection?.unscannableFiles) ? raw.inspection.unscannableFiles : 'allow',
    },
    rules,
    customRules,
    log: raw.log !== false,
  };
}

/** Every service with the action in force: the catalog, then the person's own services. */
export function effectiveServices(settings) {
  const fromCatalog = CATALOG.map((s) => ({
    id: s.id, name: s.name, vendor: s.vendor, category: s.category, domains: s.domains,
    action: settings.services[s.id] ?? settings.defaultAction, custom: false,
  }));
  const own = settings.customServices.map((s) => ({ ...s, vendor: '', category: 'custom', custom: true }));
  return [...fromCatalog, ...own];
}

/**
 * The site access a service needs: its domains and their sub-domains. The known services
 * have it from the install; for a person's own service the browser asks when it is added.
 */
export function originsFor(service) {
  return service.domains.map((domain) => `*://*.${domain}/*`);
}

/** Short stable hash of the settings, used as the policy version. */
function fingerprint(settings) {
  const text = JSON.stringify(settings);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The settings in the shape the rule builder and the pages read (the same shape the
 * commercial extension receives from its server).
 */
export function toPolicyJson(settings) {
  return {
    companyName: settings.organisation,
    version: `local-${fingerprint(settings)}`,
    refreshSeconds: 86400,
    services: effectiveServices(settings).map(({ id, name, vendor, domains, action }) => ({ id, name, vendor, domains, action })),
    promptInspection: { enabled: settings.inspection.prompts, files: settings.inspection.files },
  };
}

/** Reads settings pushed by an administrator; null when there are none or they are not JSON. */
export function parseManaged(managed) {
  const text = typeof managed?.settingsJson === 'string' ? managed.settingsJson.trim() : '';
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The management server to download settings from, or null. An address pushed through
 * browser policy wins over one typed in the settings page, and cannot be changed there.
 *
 * @returns {Promise<{url: string, key: string, managed: boolean}|null>}
 */
export async function serverConfig(storage) {
  try {
    const pushed = await storage.managed.get(['serverUrl', 'serverKey']);
    const url = normalizeServerUrl(pushed?.serverUrl);
    if (url) return { url, key: typeof pushed.serverKey === 'string' ? pushed.serverKey.trim() : '', managed: true };
  } catch {
    // No managed storage on this platform.
  }
  const typed = (await storage.local.get(SERVER_KEY))[SERVER_KEY];
  const url = normalizeServerUrl(typed?.url);
  return url ? { url, key: typeof typed.key === 'string' ? typed.key.trim() : '', managed: false } : null;
}

/**
 * The settings to use and where they came from. Pushed or downloaded settings win as a
 * whole, so a person cannot change part of a managed setup. Until the first download from
 * a management server succeeds, the settings of this browser stay in force.
 *
 * @returns {Promise<{source: 'managed'|'server'|'local'|'default', settings: object}>}
 */
export async function loadSettings(storage, options) {
  let managed = null;
  try {
    managed = parseManaged(await storage.managed.get(['settingsJson']));
  } catch {
    // No managed storage on this platform: use the local settings.
  }
  if (managed) return { source: 'managed', settings: normalizeSettings(managed, options) };
  const server = await serverConfig(storage);
  if (server) {
    const cached = (await storage.local.get(SERVER_CACHE_KEY))[SERVER_CACHE_KEY];
    if (cached?.url === server.url && cached.settings) return { source: 'server', settings: normalizeSettings(cached.settings, options) };
  }
  const local = (await storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  return local ? { source: 'local', settings: normalizeSettings(local, options) }
    : { source: 'default', settings: defaultSettings() };
}
