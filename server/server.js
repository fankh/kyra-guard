#!/usr/bin/env node
// KYRA AI Guardrail Free: management server.
//
// A small program an organisation runs itself, so that every browser with the extension
// downloads the same settings, and so that the organisation can see which browsers are
// covered. It holds one settings document and hands it out, and it keeps the last check-in
// of each browser: a name, versions, whether the checks are on, and daily counts. It is never
// told a site, a rule, a file name or what was typed, and it does not keep network addresses.
// No dependencies beyond Node 20.
//
//   node server/server.js                    start (PORT, HOST and KYRA_DATA_DIR are read)
//   node server/server.js --reset-admin-key  make a new admin key and show it once

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHECKIN_DAYS, DEFAULT_REFRESH_MINUTES, MAX_LABEL_LENGTH, clampRefreshMinutes, cleanLabel } from '../extension/lib/remote.js';
import { activeRules } from '../extension/lib/rules.js';
import { defaultSettings, effectiveServices, normalizeSettings } from '../extension/lib/settings.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CHECKIN_BYTES = 16 * 1024;
const MAX_BROWSERS = 5000;
const MAX_COUNT = 100000;
// After this many wrong admin keys from one address, each further wrong key is answered late.
const FREE_WRONG_KEYS = 10;
const WRONG_KEY_WINDOW_MS = 10 * 60 * 1000;
const WRONG_KEY_DELAY_MS = 2000;
const MAX_TRACKED_ADDRESSES = 10000;
// Browsers seen for the first time, across all addresses (behind a reverse proxy every browser
// has the same address, so a limit per address would hold up a whole organisation).
const NEW_BROWSERS_PER_HOUR = 1000;
// Check-ins are written to disk together, at most this often.
const SAVE_DELAY_MS = 1000;
const STATIC = Object.freeze({
  '/': ['admin.html', 'text/html; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/admin.css': ['admin.css', 'text/css; charset=utf-8'],
});

const newKey = () => randomBytes(24).toString('base64url');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function sameText(a, b) {
  const left = Buffer.from(sha256(String(a)));
  const right = Buffer.from(sha256(String(b)));
  return timingSafeEqual(left, right);
}

/** The state kept on disk: one JSON file, replaced as a whole on every change. */
function openStore(dataDir) {
  const file = join(dataDir, 'state.json');
  mkdirSync(dataDir, { recursive: true });
  let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const save = () => {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(temporary, file);
  };
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    save();
  };
  let firstAdminKey = null;
  if (!state) {
    firstAdminKey = newKey();
    state = {
      adminKeyHash: sha256(firstAdminKey), enrollmentKey: newKey(), refreshMinutes: DEFAULT_REFRESH_MINUTES,
      settings: defaultSettings(), updatedAt: new Date().toISOString(),
    };
    save();
  }
  return {
    firstAdminKey,
    get: () => state,
    update(changes) {
      state = { ...state, ...changes };
      flush();
    },
    /** Like update, but written a moment later together with others: for check-ins, which come often. */
    updateSoon(changes) {
      state = { ...state, ...changes };
      timer ??= setTimeout(flush, SAVE_DELAY_MS);
      timer.unref?.();
    },
    flush: () => {
      if (timer) flush();
    },
  };
}

const versionOf = (settings) => sha256(JSON.stringify(settings)).slice(0, 16);

function summaryOf(settings) {
  const services = effectiveServices(settings);
  const count = (action) => services.filter((service) => service.action === action).length;
  return {
    services: services.length, blocked: count('block'), warned: count('alert'), allowed: count('allow'),
    ownServices: settings.customServices.length, rulesInForce: activeRules(settings).length, ownRules: settings.customRules.length,
  };
}

function adminView(state) {
  return {
    version: versionOf(state.settings), updatedAt: state.updatedAt, refreshMinutes: state.refreshMinutes,
    enrollmentKey: state.enrollmentKey, settings: state.settings, summary: summaryOf(state.settings),
  };
}

function send(res, status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
  });
  res.end(text);
}

function readJson(req, limit = MAX_BODY_BYTES) {
  return new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        fail(Object.assign(new Error('not JSON'), { status: 400 }));
      }
    });
    req.on('error', fail);
  });
}

const shortText = (value, length) => (typeof value === 'string' ? value.slice(0, length) : '');
const count = (value) => Math.min(MAX_COUNT, Math.max(0, Math.trunc(Number(value)) || 0));

/** A check-in with only the fields the server keeps, or null when it is not one. */
function cleanCheckIn(body) {
  if (!body || typeof body !== 'object' || typeof body.id !== 'string' || !/^[\w-]{8,64}$/.test(body.id)) return null;
  if (body.secret !== undefined && (typeof body.secret !== 'string' || !/^[\w-]{16,128}$/.test(body.secret))) return null;
  const days = Array.isArray(body.days) ? body.days.slice(-CHECKIN_DAYS)
    .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.day))
    .map((d) => ({ day: d.day, blocked: count(d.blocked), warned: count(d.warned), sentAfterWarning: count(d.sentAfterWarning) })) : null;
  return {
    id: body.id,
    label: cleanLabel(body.label).slice(0, MAX_LABEL_LENGTH),
    extensionVersion: shortText(body.extensionVersion, 32),
    settingsVersion: shortText(body.settingsVersion, 80) || null,
    checks: { prompts: body.checks?.prompts === true, files: body.checks?.files === true },
    pendingAccess: count(body.pendingAccess),
    days,
    secret: body.secret,
  };
}

/** A browser as the admin page sees it: without the hash of its secret. */
const listed = ({ secretHash, ...browser }) => browser;

const bearer = (req) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';

/**
 * Counts wrong admin keys per address. The table has a size limit, so a flood of addresses
 * cannot grow it for ever, and it is never emptied at once: when full, expired entries go
 * first, then the ones not heard from the longest. An address keeps guessing moves to the end.
 *
 * @returns {(address: string, now?: number) => number} notes one wrong key, returns the count in the window
 */
export function wrongKeyTable({ limit = MAX_TRACKED_ADDRESSES, windowMs = WRONG_KEY_WINDOW_MS } = {}) {
  const failed = new Map(); // address -> { count, until }, oldest first
  return (address, now = Date.now()) => {
    const entry = failed.get(address);
    const count = entry && entry.until > now ? entry.count + 1 : 1;
    failed.delete(address);
    if (failed.size >= limit) {
      for (const [known, held] of failed) if (held.until <= now) failed.delete(known);
      for (const known of failed.keys()) {
        if (failed.size < limit) break;
        failed.delete(known);
      }
    }
    failed.set(address, { count, until: now + windowMs });
    return count;
  };
}

/**
 * The server, not yet listening.
 *
 * @param {{dataDir: string, wrongKeyDelayMs?: number, newBrowsersPerHour?: number}} options where state.json is kept
 * @returns {{server: import('node:http').Server, firstAdminKey: string|null}} the admin key
 *   is returned only when this call created the state, so it can be shown once
 */
export function createManagementServer({ dataDir, wrongKeyDelayMs = WRONG_KEY_DELAY_MS, newBrowsersPerHour = NEW_BROWSERS_PER_HOUR }) {
  const store = openStore(resolve(dataDir));
  const noteWrongKey = wrongKeyTable();
  let newBrowsers = { hour: 0, count: 0 };

  /**
   * The right admin key is always accepted, so nobody can lock the admin out by sending
   * wrong ones (behind a reverse proxy every visitor has the same address). Guessing is
   * slowed instead: past a few wrong keys, each further one waits before it is refused.
   */
  async function adminAllowed(req, res) {
    const key = bearer(req);
    if (key && sameText(sha256(key), store.get().adminKeyHash)) return true;
    const count = noteWrongKey(req.socket.remoteAddress ?? '');
    if (count > FREE_WRONG_KEYS) {
      await new Promise((done) => { setTimeout(done, wrongKeyDelayMs); });
      send(res, 429, { error: 'tooManyAttempts' });
    } else send(res, 401, { error: 'unauthorized' });
    return false;
  }

  const cors = {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag', Vary: 'Origin',
  };

  /** Answers a browser's preflight, or refuses a request without the enrolment key. True when handled. */
  function browserGate(req, res, method) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors, 'Access-Control-Allow-Methods': method, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
        'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600',
      });
      res.end();
      return true;
    }
    if (req.method !== method) {
      send(res, 405, { error: 'method' }, cors);
      return true;
    }
    const { enrollmentKey } = store.get();
    if (enrollmentKey && !sameText(bearer(req), enrollmentKey)) {
      send(res, 401, { error: 'unauthorized' }, cors);
      return true;
    }
    return false;
  }

  /**
   * A browser says it is covered. The last check-in of each browser is kept, nothing older.
   * The enrolment key is shared by every browser, so each browser also sends a secret of its
   * own: the first check-in of an id keeps its hash, and later check-ins for that id must
   * send the same secret. Someone holding the enrolment key cannot write over another
   * browser's line.
   */
  async function checkIn(req, res) {
    if (browserGate(req, res, 'POST')) return undefined;
    const report = cleanCheckIn(await readJson(req, MAX_CHECKIN_BYTES));
    if (!report) return send(res, 400, { error: 'checkIn' }, cors);
    const { secret, ...fields } = report;
    const browsers = { ...(store.get().browsers ?? {}) };
    const known = browsers[report.id];
    const secretHash = secret ? sha256(secret) : null;
    if (known?.secretHash && !(secretHash && sameText(secretHash, known.secretHash))) {
      return send(res, 403, { error: 'notThisBrowser' }, cors);
    }
    if (!known) {
      if (Object.keys(browsers).length >= MAX_BROWSERS) return send(res, 507, { error: 'full' }, cors);
      const hour = Math.floor(Date.now() / 3600000);
      if (newBrowsers.hour !== hour) newBrowsers = { hour, count: 0 };
      if (newBrowsers.count >= newBrowsersPerHour) return send(res, 429, { error: 'tooManyNewBrowsers' }, cors);
      newBrowsers.count += 1;
    }
    const now = new Date().toISOString();
    // A browser from before secrets were sent keeps no hash until it sends one.
    browsers[report.id] = {
      ...fields, firstSeen: known?.firstSeen ?? now, lastSeen: now, secretHash: known?.secretHash ?? secretHash,
    };
    store.updateSoon({ browsers });
    return send(res, 200, { ok: true }, cors);
  }

  /** What the extension asks for. Any web origin may read it with the enrolment key. */
  function settingsForBrowsers(req, res) {
    if (browserGate(req, res, 'GET')) return undefined;
    const state = store.get();
    const version = versionOf(state.settings);
    const etag = `"${version}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ...cors, ETag: etag, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    return send(res, 200, { version, refreshMinutes: state.refreshMinutes, settings: state.settings }, { ...cors, ETag: etag });
  }

  async function admin(req, res, path) {
    if (!(await adminAllowed(req, res))) return;
    if (path === '/api/admin/state' && req.method === 'GET') return send(res, 200, adminView(store.get()));
    if (path === '/api/admin/settings' && req.method === 'PUT') {
      const body = await readJson(req);
      const raw = body?.settings;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return send(res, 400, { error: 'settings' });
      const settings = normalizeSettings(raw);
      const given = (list) => (Array.isArray(list) ? list.length : 0);
      store.update({
        settings, updatedAt: new Date().toISOString(),
        refreshMinutes: body.refreshMinutes === undefined ? store.get().refreshMinutes : clampRefreshMinutes(body.refreshMinutes),
      });
      return send(res, 200, {
        ...adminView(store.get()),
        // What was in the document but could not be used, so the admin page can say so.
        dropped: {
          ownServices: given(raw.customServices) - settings.customServices.length,
          ownRules: given(raw.customRules) - settings.customRules.length,
        },
      });
    }
    if (path === '/api/admin/browsers' && req.method === 'GET') {
      const browsers = Object.values(store.get().browsers ?? {}).sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1)).map(listed);
      return send(res, 200, { version: versionOf(store.get().settings), browsers });
    }
    if (path.startsWith('/api/admin/browsers/') && req.method === 'DELETE') {
      const browsers = { ...(store.get().browsers ?? {}) };
      delete browsers[decodeURIComponent(path.slice('/api/admin/browsers/'.length))];
      store.update({ browsers });
      return send(res, 200, { ok: true });
    }
    if (path === '/api/admin/enrollment-key' && req.method === 'POST') {
      store.update({ enrollmentKey: newKey() });
      return send(res, 200, adminView(store.get()));
    }
    return send(res, 404, { error: 'notFound' });
  }

  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/healthz') return send(res, 200, { ok: true });
      if (path === '/api/settings') return settingsForBrowsers(req, res);
      if (path === '/api/checkin') return await checkIn(req, res);
      if (path.startsWith('/api/admin/')) return await admin(req, res, path);
      const page = req.method === 'GET' ? STATIC[path] : null;
      if (!page) return send(res, 404, { error: 'notFound' });
      res.writeHead(200, {
        'Content-Type': page[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      });
      return res.end(readFileSync(join(HERE, page[0])));
    } catch (error) {
      if (!res.headersSent) send(res, error.status ?? 500, { error: error.status ? error.message : 'server' });
      else res.end();
      if (!error.status) console.error(error);
      return undefined;
    }
  });
  server.on('close', () => store.flush());
  return { server, firstAdminKey: store.firstAdminKey, flush: store.flush };
}

/** Whether an address to listen on is reachable only from this machine. */
export const loopbackOnly = (host) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host).toLowerCase());

function main() {
  const dataDir = process.env.KYRA_DATA_DIR || join(process.cwd(), 'data');
  if (process.argv.includes('--reset-admin-key')) {
    const store = openStore(resolve(dataDir));
    const key = store.firstAdminKey ?? newKey();
    store.update({ adminKeyHash: sha256(key) });
    console.log(`New admin key (shown once): ${key}`);
    return;
  }
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT ?? 8787);
  const { server, firstAdminKey, flush } = createManagementServer({ dataDir });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      flush();
      process.exit(0);
    });
  }
  server.listen(port, host, () => {
    const address = server.address();
    console.log(`KYRA AI Guardrail Free management server: http://${host}:${address.port}/`);
    console.log(`Data: ${resolve(dataDir)}`);
    if (firstAdminKey) console.log(`Admin key (shown once, keep it somewhere safe): ${firstAdminKey}`);
    if (!loopbackOnly(host)) {
      // This server speaks plain HTTP: the admin key and the enrolment key would cross the
      // network readable by anyone on the way, and the extension refuses such an address.
      console.warn('Warning: listening beyond this machine over plain HTTP. Put an HTTPS reverse proxy in front'
        + ' and give browsers and admins only its https:// address.');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
