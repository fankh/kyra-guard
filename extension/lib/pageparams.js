// Reads the parameters the redirect rules put on blocked.html and warn.html.
//
// The warning rule appends the original URL unencoded and last ("...&url=\0"), so it may
// contain its own "?", "&" and "#". Everything after the first "&url=" is therefore the
// original URL; service and host come before it and never contain "&".

import { normalizeDomain } from './matching.js';

/**
 * @param {string} href the page's location.href
 * @returns {{serviceId: string, host: string|null, url: string|null}}
 */
export function parseRedirectParams(href) {
  const query = href.indexOf('?');
  if (query < 0) return { serviceId: '', host: null, url: null };
  const marker = href.indexOf('&url=', query);
  const head = marker < 0 ? href.slice(query + 1) : href.slice(query + 1, marker);
  const params = new URLSearchParams(head.split('#')[0]);
  let url = marker < 0 ? params.get('url') : href.slice(marker + '&url='.length);
  // Accept an encoded URL too, in case the page is opened by a link rather than a rule.
  if (url && /^https?%3A/i.test(url)) {
    try {
      url = decodeURIComponent(url);
    } catch {
      url = null;
    }
  }
  return {
    serviceId: params.get('service') ?? '',
    host: normalizeDomain(params.get('host') ?? ''),
    url: url || null,
  };
}

/**
 * The URL to continue to: the original URL when it is http(s) and on the warned host,
 * otherwise the host's home page. Returns null when there is no usable host.
 */
export function continueUrl(url, host) {
  if (!host) return null;
  try {
    const parsed = new URL(url);
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && normalizeDomain(parsed.hostname) === host) {
      return parsed.href;
    }
  } catch {
    // fall through
  }
  return `https://${host}/`;
}
