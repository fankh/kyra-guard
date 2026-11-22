// Policy parsing and declarativeNetRequest rule building. Everything here is pure so it
// can be unit-tested in Node; background.js applies the result to the browser.

import { buildDomainIndex, domainDepth, hostSuffixes, normalizeDomain } from './matching.js';

export const ACTIONS = Object.freeze(['allow', 'alert', 'block']);
export const DEFAULT_REFRESH_SECONDS = 300;
export const MIN_REFRESH_SECONDS = 60;
export const MAX_REFRESH_SECONDS = 86400;
/** Never send a larger image or PDF for its text to be read, whatever the server says. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Bump when the shape of generated rules changes, so an updated extension rebuilds them.
export const RULES_FORMAT = 1;

// Chrome allows 1,000 regex rules per extension; leave room for future use.
export const REGEX_RULE_BUDGET = 800;
// Chrome allows 5,000 dynamic "unsafe" (redirect) rules and 30,000 dynamic rules in total
// (5,000 before Chrome 121); stay under the lower figure.
export const MAX_DYNAMIC_RULES = 4500;

// Priorities grow with domain depth so the longest matching domain wins, like findService.
// A session allow for a proceeded service sits between its own depth and the next one, so
// it beats the warning but not a more specific blocked service nested under it.
const PRIORITY_STEP = 10;
const SESSION_ALLOW_OFFSET = 5;
const SERVER_ALLOW_PRIORITY = 100000;

// Every resource type, for rules that must also cover main_frame (Chrome otherwise
// excludes main_frame when no types are listed).
export const ALL_RESOURCE_TYPES = Object.freeze([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport',
  'webbundle', 'other',
]);
const FRAME_TYPES = ['main_frame', 'sub_frame'];

// Matches any URL; group 1 is the host. The redirect keeps the whole URL as \0.
export const URL_REGEX = '^[a-z][a-z0-9+.-]*://(?:[^/?#]*@)?([^/?#:]+).*$';

export class PolicyError extends Error {}

/** Validates the server's policy JSON and returns a normalised copy. Throws PolicyError. */
export function parsePolicy(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new PolicyError('policy is not an object');
  }
  if (!Array.isArray(json.services)) throw new PolicyError('policy.services is not an array');

  const seen = new Set();
  const services = [];
  for (const raw of json.services) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const domains = [...new Set((Array.isArray(raw.domains) ? raw.domains : [])
      .map(normalizeDomain).filter(Boolean))].sort();
    services.push({
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
      vendor: typeof raw.vendor === 'string' ? raw.vendor.trim() : '',
      domains,
      // A service the company has not reviewed is alerted on, as on the server.
      action: ACTIONS.includes(raw.action) ? raw.action : 'alert',
    });
  }
  services.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const refresh = Number(json.refreshSeconds);
  return {
    companyName: typeof json.companyName === 'string' ? json.companyName.trim() : '',
    version: json.version == null ? '' : String(json.version),
    refreshSeconds: Number.isFinite(refresh)
      ? Math.min(MAX_REFRESH_SECONDS, Math.max(MIN_REFRESH_SECONDS, Math.round(refresh)))
      : DEFAULT_REFRESH_SECONDS,
    services,
    // Off unless the server says otherwise (older servers do not send it).
    promptInspection: {
      enabled: json.promptInspection?.enabled === true,
      failClosed: json.promptInspection?.failClosed === true,
      // Attached, dropped and pasted files; separate from prompts.
      files: json.promptInspection?.files === true,
      // Images and PDFs are sent as bytes for KYRA to read their text, up to this size.
      images: json.promptInspection?.files === true && json.promptInspection?.images === true
        && Number.isFinite(json.promptInspection?.imageMaxBytes) && json.promptInspection.imageMaxBytes > 0,
      imageMaxBytes: Number.isFinite(json.promptInspection?.imageMaxBytes)
        ? Math.max(0, Math.min(MAX_IMAGE_BYTES, Math.floor(json.promptInspection.imageMaxBytes))) : 0,
      // The server records 'unchecked' events; an older one would refuse the whole batch.
      reportUnchecked: json.promptInspection?.reportUnchecked === true,
    },
  };
}

/**
 * Match patterns for the prompt-inspection content script: every domain of a service that
 * is not blocked (a blocked service never loads), or none when both prompt and file
 * inspection are off.
 */
export function promptMatchPatterns(policy) {
  if (!policy?.promptInspection?.enabled && !policy?.promptInspection?.files) return [];
  const domains = new Set();
  for (const service of policy.services) {
    if (service.action === 'block') continue;
    for (const domain of service.domains) domains.add(domain);
  }
  return [...domains].sort().map((domain) => `*://*.${domain}/*`);
}

/** Short stable hash (FNV-1a) of the parts of a policy that affect rules. */
export function policyFingerprint(policy, extra = '') {
  const text = JSON.stringify([RULES_FORMAT, extra, policy.version,
    policy.services.map((s) => [s.id, s.action, s.domains])]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${RULES_FORMAT}-${hash.toString(16).padStart(8, '0')}`;
}

/** Counts services by action, for the popup. */
export function countByAction(policy) {
  const counts = { allow: 0, alert: 0, block: 0 };
  for (const service of policy?.services ?? []) counts[service.action] += 1;
  return counts;
}

/**
 * Groups the domains each service owns by depth: [{ service, depth, domains }], sorted by
 * service id then depth, so rule ids are stable for the same policy.
 */
function ownedGroups(index) {
  const groups = new Map();
  for (const [domain, service] of index) {
    const key = `${service.id}\u0000${domainDepth(domain)}`;
    if (!groups.has(key)) groups.set(key, { service, depth: domainDepth(domain), domains: [] });
    groups.get(key).domains.push(domain);
  }
  return [...groups.values()].sort((a, b) => (a.service.id < b.service.id ? -1
    : a.service.id > b.service.id ? 1 : a.depth - b.depth));
}

/** True when a stricter service owns a parent domain, so an allow rule is needed to win. */
function nestedUnderEnforced(domain, index) {
  return hostSuffixes(domain).slice(1).some((parent) => {
    const owner = index.get(parent);
    return owner && owner.action !== 'allow';
  });
}

function warnRedirect(origin, serviceId) {
  const service = serviceId ? encodeURIComponent(serviceId) : '';
  return { regexSubstitution: `${origin}/warn.html?service=${service}&host=\\1&url=\\0` };
}

function blockedRedirect(origin, serviceId) {
  const service = serviceId ? encodeURIComponent(serviceId) : '';
  return { regexSubstitution: `${origin}/blocked.html?service=${service}&host=\\1` };
}

/**
 * Builds the dynamic rules for a policy.
 *
 * - block: main_frame/sub_frame navigations redirect to blocked.html; every other request
 *   to the service's domains is blocked.
 * - alert: main_frame navigations redirect to warn.html with the original URL appended.
 * - allow: no rule, except where a stricter service owns a parent domain.
 *
 * Normally one redirect rule per service and depth carries the service id. If that would
 * exceed the regex budget the rules are merged per action and depth and the pages find the
 * service from the host instead.
 *
 * @param {object} policy parsed policy
 * @param {{extensionOrigin: string, serverHost?: string, regexBudget?: number}} options
 * @returns {{rules: object[], stats: object}}
 */
export function buildDynamicRules(policy, { extensionOrigin, serverHost, regexBudget = REGEX_RULE_BUDGET }) {
  const origin = extensionOrigin.replace(/\/+$/, '');
  const index = buildDomainIndex(policy.services);
  const groups = ownedGroups(index);

  const enforcedGroups = groups.filter((g) => g.service.action !== 'allow');
  const perService = enforcedGroups.length <= regexBudget;
  const redirectGroups = perService
    ? enforcedGroups.map((g) => ({ action: g.service.action, depth: g.depth, domains: g.domains, serviceId: g.service.id }))
    : mergeByActionAndDepth(enforcedGroups);

  const rules = [];
  const add = (rule) => rules.push({ id: rules.length + 1, ...rule });

  // The KYRA server must stay reachable whatever the catalog says.
  const server = serverHost ? normalizeDomain(serverHost) : null;
  if (server) {
    add({
      priority: SERVER_ALLOW_PRIORITY,
      action: { type: 'allow' },
      condition: { requestDomains: [server], resourceTypes: [...ALL_RESOURCE_TYPES] },
    });
  }

  for (const group of redirectGroups) {
    const priority = group.depth * PRIORITY_STEP;
    const serviceId = group.serviceId ?? null;
    if (group.action === 'block') {
      add({
        priority,
        action: { type: 'redirect', redirect: blockedRedirect(origin, serviceId) },
        condition: { regexFilter: URL_REGEX, requestDomains: group.domains, resourceTypes: [...FRAME_TYPES] },
      });
    } else {
      add({
        priority,
        action: { type: 'redirect', redirect: warnRedirect(origin, serviceId) },
        condition: { regexFilter: URL_REGEX, requestDomains: group.domains, resourceTypes: ['main_frame'] },
      });
    }
  }

  // Subresources of blocked services are blocked outright; one rule per depth is enough.
  for (const group of mergeByActionAndDepth(enforcedGroups).filter((g) => g.action === 'block')) {
    add({
      priority: group.depth * PRIORITY_STEP,
      action: { type: 'block' },
      condition: { requestDomains: group.domains, excludedResourceTypes: [...FRAME_TYPES] },
    });
  }

  for (const group of groups.filter((g) => g.service.action === 'allow')) {
    const domains = group.domains.filter((d) => nestedUnderEnforced(d, index));
    if (domains.length === 0) continue;
    add({
      priority: group.depth * PRIORITY_STEP,
      action: { type: 'allow' },
      condition: { requestDomains: domains, resourceTypes: [...ALL_RESOURCE_TYPES] },
    });
  }

  if (rules.length > MAX_DYNAMIC_RULES) {
    throw new PolicyError(`policy needs ${rules.length} rules, more than ${MAX_DYNAMIC_RULES}`);
  }

  const counts = countByAction(policy);
  return {
    rules,
    stats: {
      mode: perService ? 'per-service' : 'merged',
      total: rules.length,
      regex: rules.filter((r) => r.condition.regexFilter).length,
      blockedServices: counts.block,
      warnedServices: counts.alert,
    },
  };
}

function mergeByActionAndDepth(groups) {
  const merged = new Map();
  for (const group of groups) {
    const key = `${group.service.action}\u0000${group.depth}`;
    if (!merged.has(key)) merged.set(key, { action: group.service.action, depth: group.depth, domains: [] });
    merged.get(key).domains.push(...group.domains);
  }
  return [...merged.values()]
    .map((g) => ({ ...g, domains: [...g.domains].sort() }))
    .sort((a, b) => (a.action < b.action ? -1 : a.action > b.action ? 1 : a.depth - b.depth));
}

/**
 * Session rules that let the user through to alert services they proceeded to.
 *
 * @param {object|null} policy parsed policy
 * @param {Record<string, number>} allows service id -> expiry (epoch ms)
 * @param {number} now epoch ms
 * @returns {{rules: object[], active: Record<string, number>, nextExpiry: number|null}}
 *   `active` drops expired entries and services that are no longer alert.
 */
export function buildSessionRules(policy, allows, now) {
  const active = {};
  let nextExpiry = null;
  if (!policy) return { rules: [], active, nextExpiry };

  const live = new Set();
  for (const service of policy.services) {
    const expiresAt = allows?.[service.id];
    if (service.action === 'alert' && Number.isFinite(expiresAt) && expiresAt > now) {
      active[service.id] = expiresAt;
      live.add(service.id);
      nextExpiry = nextExpiry === null ? expiresAt : Math.min(nextExpiry, expiresAt);
    }
  }

  const rules = [];
  for (const group of ownedGroups(buildDomainIndex(policy.services))) {
    if (!live.has(group.service.id)) continue;
    rules.push({
      id: rules.length + 1,
      priority: group.depth * PRIORITY_STEP + SESSION_ALLOW_OFFSET,
      action: { type: 'allow' },
      condition: { requestDomains: group.domains, resourceTypes: [...ALL_RESOURCE_TYPES] },
    });
  }
  return { rules, active, nextExpiry };
}
