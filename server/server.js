#!/usr/bin/env node
// KYRA AI Guardrail Free: management server.
//
// A small program an organisation runs itself, so that every browser with the extension
// downloads the same settings. It holds one settings document and hands it out; the
// extension sends it nothing about the person or what they do, and the server keeps no
// record of who asked. No dependencies beyond Node 20.
//
//   node server/server.js                    start (PORT, HOST and KYRA_DATA_DIR are read)
//   node server/server.js --reset-admin-key  make a new admin key and show it once

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_REFRESH_MINUTES, clampRefreshMinutes } from '../extension/lib/remote.js';
import { activeRules } from '../extension/lib/rules.js';
import { defaultSettings, effectiveServices, normalizeSettings } from '../extension/lib/settings.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 1024 * 1024;
// After this many wrong admin keys from one address, each further wrong key is answered late.
const FREE_WRONG_KEYS = 10;
const WRONG_KEY_WINDOW_MS = 10 * 60 * 1000;
const WRONG_KEY_DELAY_MS = 2000;
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
      save();
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

function readJson(req) {
  return new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
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

const bearer = (req) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';

/**
 * The server, not yet listening.
 *
 * @param {{dataDir: string, wrongKeyDelayMs?: number}} options where state.json is kept
 * @returns {{server: import('node:http').Server, firstAdminKey: string|null}} the admin key
 *   is returned only when this call created the state, so it can be shown once
 */
export function createManagementServer({ dataDir, wrongKeyDelayMs = WRONG_KEY_DELAY_MS }) {
  const store = openStore(resolve(dataDir));
  const failed = new Map(); // address -> { count, until }

  /**
   * The right admin key is always accepted, so nobody can lock the admin out by sending
   * wrong ones (behind a reverse proxy every visitor has the same address). Guessing is
   * slowed instead: past a few wrong keys, each further one waits before it is refused.
   */
  async function adminAllowed(req, res) {
    const key = bearer(req);
    if (key && sameText(sha256(key), store.get().adminKeyHash)) return true;
    const address = req.socket.remoteAddress ?? '';
    const entry = failed.get(address);
    const count = entry && entry.until > Date.now() ? entry.count + 1 : 1;
    failed.set(address, { count, until: Date.now() + WRONG_KEY_WINDOW_MS });
    if (failed.size > 10000) failed.clear(); // a flood of addresses must not grow the table for ever
    if (count > FREE_WRONG_KEYS) {
      await new Promise((done) => { setTimeout(done, wrongKeyDelayMs); });
      send(res, 429, { error: 'tooManyAttempts' });
    } else send(res, 401, { error: 'unauthorized' });
    return false;
  }

  /** What the extension asks for. Any web origin may read it with the enrolment key. */
  function settingsForBrowsers(req, res) {
    const cors = {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag', Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Authorization, If-None-Match',
        'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'method' }, cors);
    const state = store.get();
    if (state.enrollmentKey && !sameText(bearer(req), state.enrollmentKey)) return send(res, 401, { error: 'unauthorized' }, cors);
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
  return { server, firstAdminKey: store.firstAdminKey };
}

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
  const { server, firstAdminKey } = createManagementServer({ dataDir });
  server.listen(port, host, () => {
    const address = server.address();
    console.log(`KYRA AI Guardrail Free management server: http://${host}:${address.port}/`);
    console.log(`Data: ${resolve(dataDir)}`);
    if (firstAdminKey) console.log(`Admin key (shown once, keep it somewhere safe): ${firstAdminKey}`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
