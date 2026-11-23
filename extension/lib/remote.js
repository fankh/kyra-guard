// The optional management server: a small program an organisation runs itself (see server/).
// A connected browser does two things, and only these:
//  - it downloads the settings document;
//  - it checks in, so the organisation can see which browsers are covered: a name, the
//    extension and settings versions, whether the checks are on, and daily counts of blocked
//    and warned events. Never a site, a rule, a file name or anything that was typed.
// This is the only file of the extension that talks to a network address.

export const SETTINGS_PATH = 'api/settings';
export const CHECKIN_PATH = 'api/checkin';
export const CHECKIN_DAYS = 7;
export const MAX_LABEL_LENGTH = 80;
export const DEFAULT_REFRESH_MINUTES = 30;
export const MIN_REFRESH_MINUTES = 5;
export const MAX_REFRESH_MINUTES = 1440;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 1024 * 1024;

/** The server address in one form ("https://host/path/"), or null when it is not usable. */
export function normalizeServerUrl(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${path}`;
}

/** True when the address is plain HTTP to another machine: what is downloaded can be read on the way. */
export function isUnprotectedAddress(input) {
  const base = normalizeServerUrl(input);
  if (!base) return false;
  const url = new URL(base);
  return url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function clampRefreshMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return DEFAULT_REFRESH_MINUTES;
  return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, Math.round(minutes)));
}

/**
 * Downloads the settings document.
 *
 * @param {{url: string, key?: string, version?: string}} server `version` is what is held already
 * @returns {Promise<{ok: true, unchanged: boolean, version?: string, refreshMinutes?: number, settings?: object}
 *   | {ok: false, error: 'address'|'network'|'unauthorized'|'notFound'|'server'|'invalid'}>}
 */
export async function fetchServerSettings(server, fetchImpl = fetch) {
  const base = normalizeServerUrl(server?.url);
  if (!base) return { ok: false, error: 'address' };
  const headers = { Accept: 'application/json' };
  if (server.key) headers.Authorization = `Bearer ${server.key}`;
  if (server.version) headers['If-None-Match'] = `"${server.version}"`;
  let response;
  let text = '';
  try {
    response = await fetchImpl(`${base}${SETTINGS_PATH}`, {
      method: 'GET', headers, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 304) return { ok: true, unchanged: true };
    if (response.ok) text = await response.text();
  } catch {
    return { ok: false, error: 'network' };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, error: 'unauthorized' };
  if (response.status === 404) return { ok: false, error: 'notFound' };
  if (!response.ok) return { ok: false, error: 'server' };
  if (text.length > MAX_BYTES) return { ok: false, error: 'invalid' };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const { version, settings } = body ?? {};
  if (typeof version !== 'string' || !/^[\w.-]{1,80}$/.test(version)) return { ok: false, error: 'invalid' };
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { ok: false, error: 'invalid' };
  return { ok: true, unchanged: false, version, refreshMinutes: clampRefreshMinutes(body.refreshMinutes), settings };
}

const DAY_MS = 86400000;
const COUNTED = Object.freeze({
  blocked: 'blocked', prompt_blocked: 'blocked', file_blocked: 'blocked',
  warned: 'warned', prompt_warned: 'warned', file_warned: 'warned',
  proceeded: 'sentAfterWarning', prompt_sent_after_warning: 'sentAfterWarning', file_sent_after_warning: 'sentAfterWarning',
});

const dayOf = (time) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A name for this browser in the organisation's list: trimmed, one line, not too long. */
export function cleanLabel(input) {
  return typeof input === 'string' ? input.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH) : '';
}

/**
 * What a browser tells the management server about itself. Built here, in one place, so that
 * what leaves the browser is easy to read: numbers per day, no sites, no rules, no text.
 *
 * @param {{id: string, label?: string, extensionVersion: string, settingsVersion: string|null,
 *   settings: object, pendingAccess: number, log: object[]|null, now?: number}} input
 *   `log` is the activity log, or null when the person or the settings turned it off
 */
export function buildCheckIn({ id, label, extensionVersion, settingsVersion, settings, pendingAccess, log, now = Date.now() }) {
  let days = null;
  if (Array.isArray(log)) {
    const byDay = new Map();
    for (let back = CHECKIN_DAYS - 1; back >= 0; back -= 1) byDay.set(dayOf(now - back * DAY_MS), { blocked: 0, warned: 0, sentAfterWarning: 0 });
    for (const entry of log) {
      const kind = COUNTED[entry?.action];
      const day = byDay.get(dayOf(entry?.at));
      if (kind && day) day[kind] += 1;
    }
    days = [...byDay].map(([day, counts]) => ({ day, ...counts }));
  }
  return {
    id,
    label: cleanLabel(label),
    extensionVersion: String(extensionVersion),
    settingsVersion: settingsVersion ?? null,
    checks: { prompts: settings.inspection.prompts === true, files: settings.inspection.files === true },
    pendingAccess: Number(pendingAccess) || 0,
    days,
  };
}

/** Sends the check-in. A failure changes nothing in the browser; it is tried again at the next download. */
export async function sendCheckIn(server, report, fetchImpl = fetch) {
  const base = normalizeServerUrl(server?.url);
  if (!base) return { ok: false };
  const headers = { 'Content-Type': 'application/json' };
  if (server.key) headers.Authorization = `Bearer ${server.key}`;
  try {
    const response = await fetchImpl(`${base}${CHECKIN_PATH}`, {
      method: 'POST', headers, body: JSON.stringify(report), cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}
