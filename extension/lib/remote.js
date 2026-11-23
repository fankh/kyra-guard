// The optional management server: a small program an organisation runs itself (see server/).
// The extension only downloads the settings document from it. Nothing about the person or
// what they do is sent; the request carries the enrolment key and nothing else.
// This is the only file of the extension that talks to a network address.

export const SETTINGS_PATH = 'api/settings';
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
