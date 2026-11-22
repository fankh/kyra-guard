// The activity log. It stays in this browser (chrome.storage.local): nothing is sent
// anywhere. An entry says what happened, on which site and which rules matched; it never
// holds the text of a message or the contents of a file.

export const MAX_REASON_LENGTH = 500;
export const LOG_KEY = 'activityLog';
export const MAX_LOG_ENTRIES = 500;
export const LOG_ACTIONS = Object.freeze([
  'blocked', 'warned', 'proceeded',
  'prompt_blocked', 'prompt_warned', 'prompt_sent_after_warning',
  'file_blocked', 'file_warned', 'file_sent_after_warning',
]);
const DEDUPE_MS = 60 * 1000;

/** One log entry, with only the fields the log keeps. */
export function makeEntry({ action, serviceId, serviceName, host, rules, fileName, reason }, now = Date.now()) {
  if (!LOG_ACTIONS.includes(action)) throw new Error(`unknown action: ${action}`);
  return {
    at: now,
    action,
    serviceId: serviceId ?? null,
    serviceName: serviceName ?? '',
    host: host ?? '',
    rules: Array.isArray(rules) ? rules.slice(0, 8).map((r) => String(r).slice(0, 80)) : [],
    ...(fileName ? { fileName: String(fileName).slice(0, 255) } : {}),
    ...(reason ? { reason: String(reason).slice(0, MAX_REASON_LENGTH) } : {}),
  };
}

/**
 * The log with one entry added, newest first, at most MAX_LOG_ENTRIES long. A reload of a
 * blocked page within a minute adds nothing.
 */
export function appendEntry(log, entry, { dedupe = false } = {}) {
  const entries = Array.isArray(log) ? log : [];
  if (dedupe && entries.some((e) => e.action === entry.action && e.host === entry.host && entry.at - e.at < DEDUPE_MS)) {
    return entries;
  }
  return [entry, ...entries].slice(0, MAX_LOG_ENTRIES);
}

/** Counts by action over the entries since `since` (epoch ms), for the popup. */
export function summarize(log, since = 0) {
  const counts = {};
  for (const entry of Array.isArray(log) ? log : []) {
    if (entry.at >= since) counts[entry.action] = (counts[entry.action] ?? 0) + 1;
  }
  return counts;
}

const csvCell = (value) => {
  let text = String(value ?? '');
  // A cell that a spreadsheet would read as a formula is written as text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The log as CSV text, for saving to a file. */
export function toCsv(log) {
  const rows = [['time', 'action', 'service', 'site', 'rules', 'file', 'reason']];
  for (const e of Array.isArray(log) ? log : []) {
    rows.push([new Date(e.at).toISOString(), e.action, e.serviceName, e.host, (e.rules ?? []).join('; '), e.fileName ?? '', e.reason ?? '']);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** Storage wrapper used by the worker; writes are serialised so entries are not lost. */
export function createLog({ storage }) {
  let chain = Promise.resolve();
  const read = async () => (await storage.get(LOG_KEY))[LOG_KEY] ?? [];
  return {
    read,
    add(entry, options) {
      const run = chain.then(async () => {
        const next = appendEntry(await read(), entry, options);
        await storage.set({ [LOG_KEY]: next });
      });
      chain = run.catch(() => {});
      return run;
    },
    clear() {
      const run = chain.then(() => storage.remove(LOG_KEY));
      chain = run.catch(() => {});
      return run;
    },
  };
}
