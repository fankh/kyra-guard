// Host and domain matching shared by the rule builder, the service worker and the pages.
// A catalog domain covers itself and every subdomain; when several domains cover a host,
// the longest one wins (the same rule the network sensor and the server use), so
// "api.openai.com" (OpenAI API) is told apart from "openai.com" (ChatGPT).

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

// Strictest first: when two services list the exact same domain, the stricter one owns it.
const STRICTNESS = { block: 3, alert: 2, allow: 1 };

/** Lower-cases and validates a domain or host name; returns null when it is not usable. */
export function normalizeDomain(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.replace(/[/?#].*$/, '');
  s = s.replace(/^.*@/, '');
  s = s.replace(/^\*\./, '').replace(/^\.+/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (!s || s.startsWith('[')) return null;
  try {
    // Converts internationalised names to punycode, as Chrome compares them.
    s = new URL(`http://${s}`).hostname;
  } catch {
    return null;
  }
  if (s.length > 253) return null;
  return s.split('.').every((label) => LABEL.test(label)) ? s : null;
}

/** Number of labels: "openai.com" is 2, "chat.openai.com" is 3. */
export function domainDepth(domain) {
  return domain.split('.').length;
}

/** True when `domain` covers `host` (itself or a subdomain). */
export function hostCoveredBy(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Every suffix of a host that could be a catalog domain, longest first. */
export function hostSuffixes(host) {
  const labels = host.split('.');
  return labels.map((_, i) => labels.slice(i).join('.'));
}

function stricter(a, b) {
  const diff = (STRICTNESS[a.action] ?? 0) - (STRICTNESS[b.action] ?? 0);
  if (diff !== 0) return diff > 0;
  return a.id < b.id;
}

/**
 * Maps each domain to the one service that owns it. Services must already be normalised
 * (see parsePolicy). Iteration order is sorted by domain so callers get stable output.
 */
export function buildDomainIndex(services) {
  const owners = new Map();
  for (const service of services) {
    for (const domain of service.domains) {
      const current = owners.get(domain);
      if (!current || stricter(service, current)) owners.set(domain, service);
    }
  }
  return new Map([...owners.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The service governing a host (longest matching domain), or null. */
export function findService(index, host) {
  const normalized = normalizeDomain(host);
  if (!normalized) return null;
  for (const suffix of hostSuffixes(normalized)) {
    const service = index.get(suffix);
    if (service) return service;
  }
  return null;
}
