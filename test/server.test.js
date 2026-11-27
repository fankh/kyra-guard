import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  buildCheckIn, clampRefreshMinutes, fetchServerSettings, isUnprotectedAddress, normalizeServerUrl, sendCheckIn,
} from '../extension/lib/remote.js';
import {
  SERVER_CACHE_KEY, SERVER_KEY, defaultSettings, loadSettings, normalizeSettings, serverConfig,
} from '../extension/lib/settings.js';
import { createManagementServer, loopbackOnly, wrongKeyTable } from '../server/server.js';

const storage = ({ managed = {}, local = {} } = {}) => ({
  managed: { get: async () => managed },
  local: { get: async (key) => (key in local ? { [key]: local[key] } : {}) },
});

describe('the server address', () => {
  it('is kept in one form, and refused when it is not a web address', () => {
    assert.equal(normalizeServerUrl(' https://guardrail.example.com '), 'https://guardrail.example.com/');
    assert.equal(normalizeServerUrl('http://10.0.0.5:8787/kyra'), 'http://10.0.0.5:8787/kyra/');
    for (const bad of ['', 'guardrail.example.com', 'ftp://x.example', 'https://user:pw@x.example/', 'javascript:alert(1)', null]) {
      assert.equal(normalizeServerUrl(bad), null, String(bad));
    }
  });

  it('keeps the check interval between five minutes and a day', () => {
    assert.deepEqual([1, 30, 99999, 'x'].map(clampRefreshMinutes), [5, 30, 1440, 30]);
  });

  it('comes from browser policy before the settings page', async () => {
    const typed = { [SERVER_KEY]: { url: 'https://typed.example', key: ' k1 ', label: '  Kim   PC \n' } };
    assert.deepEqual(await serverConfig(storage({ local: typed })), { url: 'https://typed.example/', key: 'k1', label: 'Kim PC', managed: false });
    assert.deepEqual(await serverConfig(storage({ managed: { serverUrl: 'https://pushed.example', serverKey: 'k2', deviceLabel: 'PC-07' }, local: typed })),
      { url: 'https://pushed.example/', key: 'k2', label: 'PC-07', managed: true });
    assert.equal(await serverConfig(storage()), null);
  });
});

describe('settings from a server', () => {
  const server = { [SERVER_KEY]: { url: 'https://s.example/', key: 'k' } };
  const cached = (url) => ({ [SERVER_CACHE_KEY]: { url, version: 'v1', settings: { organisation: 'Acme', defaultAction: 'block', nonsense: 1 } } });

  it('are used as a whole once downloaded, and checked like any other settings', async () => {
    const loaded = await loadSettings(storage({ local: { ...server, ...cached('https://s.example/'), settings: { organisation: 'Mine' } } }));
    assert.equal(loaded.source, 'server');
    assert.equal(loaded.settings.organisation, 'Acme');
    assert.equal(loaded.settings.defaultAction, 'block');
    assert.equal('nonsense' in loaded.settings, false);
  });

  it('leave this browser on its own settings until the first download, or after the server changed', async () => {
    assert.equal((await loadSettings(storage({ local: { ...server, settings: { organisation: 'Mine' } } }))).source, 'local');
    assert.equal((await loadSettings(storage({ local: { ...server, ...cached('https://other.example/') } }))).source, 'default');
    assert.equal((await loadSettings(storage({ local: cached('https://s.example/') }))).source, 'default');
  });

  it('give way to settings pushed through browser policy', async () => {
    const loaded = await loadSettings(storage({
      managed: { settingsJson: '{"organisation":"Policy"}' }, local: { ...server, ...cached('https://s.example/') },
    }));
    assert.equal(loaded.source, 'managed');
    assert.equal(loaded.settings.organisation, 'Policy');
  });
});

describe('what a browser reports', () => {
  const now = new Date(2026, 10, 23, 15, 0).getTime();
  const at = (daysBack, action, extra = {}) => ({ at: now - daysBack * 86400000, action, host: 'chatgpt.com', serviceName: 'ChatGPT', ...extra });
  const report = buildCheckIn({
    id: 'browser-0001', label: '  Kim   PC ', extensionVersion: '1.0.0', settingsVersion: 'v1', settings: defaultSettings(), pendingAccess: 2, now,
    log: [
      at(0, 'prompt_blocked', { rules: ['Payment card number'] }), at(0, 'file_blocked', { fileName: 'customers.xlsx' }), at(0, 'blocked'),
      at(0, 'prompt_warned'), at(1, 'warned'), at(1, 'proceeded', { reason: 'checking the public docs' }), at(1, 'prompt_sent_after_warning'),
      at(6, 'file_warned'), at(7, 'prompt_blocked'), at(40, 'blocked'),
    ],
  });

  it('is a name, versions, whether the checks are on, and counts per day', () => {
    assert.deepEqual(Object.keys(report), ['id', 'label', 'extensionVersion', 'settingsVersion', 'checks', 'pendingAccess', 'days']);
    assert.equal(report.label, 'Kim PC');
    assert.deepEqual(report.checks, { prompts: true, files: true });
    assert.equal(report.days.length, 7);
    assert.deepEqual(report.days.at(-1), { day: '2026-11-23', blocked: 3, warned: 1, sentAfterWarning: 0 });
    assert.deepEqual(report.days.at(-2), { day: '2026-11-22', blocked: 0, warned: 1, sentAfterWarning: 2 });
    assert.deepEqual(report.days[0], { day: '2026-11-17', blocked: 0, warned: 1, sentAfterWarning: 0 });
  });

  it('never carries a site, a rule, a file name or a typed reason', () => {
    const sent = JSON.stringify(report);
    for (const secret of ['chatgpt', 'ChatGPT', 'Payment card', 'customers.xlsx', 'public docs', 'rules', 'host', 'reason', 'fileName']) {
      assert.equal(sent.includes(secret), false, secret);
    }
  });

  it('has no counts when the activity log is off', () => {
    assert.equal(buildCheckIn({ id: 'browser-0001', extensionVersion: '1.0.0', settingsVersion: null, settings: defaultSettings(), pendingAccess: 0, log: null }).days, null);
  });
});

describe('the language setting', () => {
  it('follows the browser unless one of the packaged languages is chosen', () => {
    assert.equal(defaultSettings().language, 'auto');
    assert.equal(normalizeSettings({ language: 'ko' }).language, 'ko');
    assert.equal(normalizeSettings({ language: 'en' }).language, 'en');
    assert.equal(normalizeSettings({ language: 'fr' }).language, 'auto');
  });
});

describe('the management server', () => {
  let dataDir;
  let app;
  let base;
  let adminKey;
  const asAdmin = () => ({ Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' });
  const state = async () => (await fetch(`${base}api/admin/state`, { headers: asAdmin() })).json();

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'kyra-server-'));
    app = createManagementServer({ dataDir, wrongKeyDelayMs: 150 });
    adminKey = app.firstAdminKey;
    await new Promise((done) => { app.server.listen(0, '127.0.0.1', done); });
    base = `http://127.0.0.1:${app.server.address().port}/`;
  });

  after(async () => {
    await new Promise((done) => { app.server.close(done); });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('starts with the default settings, an enrolment key, and the admin key kept only as a hash', async () => {
    assert.match(adminKey, /^[\w-]{30,}$/);
    const stored = readFileSync(join(dataDir, 'state.json'), 'utf8');
    assert.equal(stored.includes(adminKey), false);
    const view = await state();
    assert.deepEqual(view.settings, defaultSettings());
    assert.match(view.enrollmentKey, /^[\w-]{30,}$/);
    assert.equal(createManagementServer({ dataDir }).firstAdminKey, null, 'a second start does not make a new admin key');
  });

  it('hands the settings to a browser that has the enrolment key, and to no one else', async () => {
    const { enrollmentKey, version } = await state();
    const got = await fetchServerSettings({ url: base, key: enrollmentKey });
    assert.equal(got.ok, true);
    assert.equal(got.version, version);
    assert.deepEqual(got.settings, defaultSettings());
    assert.deepEqual(await fetchServerSettings({ url: base, key: 'wrong' }), { ok: false, error: 'unauthorized' });
    assert.deepEqual(await fetchServerSettings({ url: base }), { ok: false, error: 'unauthorized' });
    assert.deepEqual(await fetchServerSettings({ url: base, key: enrollmentKey, version }), { ok: true, unchanged: true });
  });

  it('keeps the last check-in of each browser, and only the fields it knows', async () => {
    const { enrollmentKey, version } = await state();
    const mine = buildCheckIn({ id: 'browser-0001', label: 'Kim PC', extensionVersion: '1.0.0', settingsVersion: version, settings: defaultSettings(), pendingAccess: 0, log: [] });
    assert.deepEqual(await sendCheckIn({ url: base, key: 'wrong' }, mine), { ok: false });
    assert.deepEqual(await sendCheckIn({ url: base, key: enrollmentKey }, { ...mine, host: 'chatgpt.com', rules: ['x'], extra: 'y'.repeat(50) }), { ok: true });
    assert.deepEqual(await sendCheckIn({ url: base, key: enrollmentKey }, { ...mine, label: 'Kim PC (new)' }), { ok: true });
    assert.deepEqual(await sendCheckIn({ url: base, key: enrollmentKey }, { ...mine, id: 'short' }), { ok: false });
    assert.deepEqual(await sendCheckIn({ url: base, key: enrollmentKey }, { ...mine, id: 'browser-0002', label: '', settingsVersion: 'old', days: null }), { ok: true });

    const listed = await (await fetch(`${base}api/admin/browsers`, { headers: asAdmin() })).json();
    assert.equal(listed.version, version);
    assert.equal(listed.browsers.length, 2);
    const first = listed.browsers.find((b) => b.id === 'browser-0001');
    assert.deepEqual(Object.keys(first).sort(),
      ['checks', 'days', 'extensionVersion', 'firstSeen', 'id', 'label', 'lastSeen', 'pendingAccess', 'settingsVersion']);
    assert.equal(first.label, 'Kim PC (new)');
    assert.equal(first.days.length, 7);
    assert.equal(readFileSync(join(dataDir, 'state.json'), 'utf8').includes('127.0.0.1'), false, 'no network address is kept');
    assert.equal((await fetch(`${base}api/admin/browsers`)).status, 401);

    await fetch(`${base}api/admin/browsers/browser-0002`, { method: 'DELETE', headers: asAdmin() });
    const after = await (await fetch(`${base}api/admin/browsers`, { headers: asAdmin() })).json();
    assert.deepEqual(after.browsers.map((b) => b.id), ['browser-0001']);
  });

  it('refuses a check-in that is too large', async () => {
    const { enrollmentKey } = await state();
    const big = await fetch(`${base}api/checkin`, {
      method: 'POST', headers: { Authorization: `Bearer ${enrollmentKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'browser-0003', label: 'x'.repeat(40000) }),
    }).then((r) => r.status, () => 'closed');
    assert.ok(big === 413 || big === 'closed', String(big));
    const listed = await (await fetch(`${base}api/admin/browsers`, { headers: asAdmin() })).json();
    assert.equal(listed.browsers.some((b) => b.id === 'browser-0003'), false);
  });

  it('lets no one else check in under a browser\'s id once it has sent its own secret', async () => {
    const { enrollmentKey } = await state();
    const server = { url: base, key: enrollmentKey };
    const report = (secret, label) => buildCheckIn({
      id: 'browser-0010', secret, label, extensionVersion: '1.1.1', settingsVersion: null, settings: defaultSettings(), pendingAccess: 0, log: null,
    });
    const mine = 'a'.repeat(48);
    assert.deepEqual(await sendCheckIn(server, report(mine, 'Lee PC')), { ok: true });
    // Before: anyone with the shared enrolment key could write over this line.
    assert.deepEqual(await sendCheckIn(server, report('b'.repeat(48), 'forged')), { ok: false });
    assert.deepEqual(await sendCheckIn(server, report(undefined, 'forged')), { ok: false });
    assert.deepEqual(await sendCheckIn(server, report('short', 'forged')), { ok: false });
    assert.deepEqual(await sendCheckIn(server, report(mine, 'Lee PC (2)')), { ok: true });
    const listed = await (await fetch(`${base}api/admin/browsers`, { headers: asAdmin() })).json();
    const line = listed.browsers.find((b) => b.id === 'browser-0010');
    assert.equal(line.label, 'Lee PC (2)');
    assert.equal('secretHash' in line, false, 'the admin page is not given the hash');
    assert.equal(JSON.stringify(listed).includes(mine), false);
  });

  it('takes only so many new browsers an hour, and writes check-ins to disk together', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kyra-server-'));
    const small = createManagementServer({ dataDir: dir, newBrowsersPerHour: 2 });
    await new Promise((done) => { small.server.listen(0, '127.0.0.1', done); });
    const url = `http://127.0.0.1:${small.server.address().port}/`;
    const key = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).enrollmentKey;
    const report = (id) => buildCheckIn({ id, extensionVersion: '1.1.1', settingsVersion: null, settings: defaultSettings(), pendingAccess: 0, log: null });
    assert.deepEqual(await sendCheckIn({ url, key }, report('browser-new-1')), { ok: true });
    assert.deepEqual(await sendCheckIn({ url, key }, report('browser-new-2')), { ok: true });
    assert.deepEqual(await sendCheckIn({ url, key }, report('browser-new-3')), { ok: false }, 'the third new one this hour waits');
    assert.deepEqual(await sendCheckIn({ url, key }, report('browser-new-1')), { ok: true }, 'a known browser is not held up');
    await new Promise((done) => { small.server.close(done); });
    const saved = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved.browsers).sort(), ['browser-new-1', 'browser-new-2'], 'written out when the server stops');
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers the browser from any origin, as an extension needs', async () => {
    const preflight = await fetch(`${base}api/settings`, {
      method: 'OPTIONS', headers: { Origin: 'chrome-extension://abc', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
    const admin = await fetch(`${base}api/admin/state`, { method: 'OPTIONS', headers: { Origin: 'https://elsewhere.example' } });
    assert.equal(admin.headers.get('access-control-allow-origin'), null, 'the admin API is for the admin page only');
  });

  it('lets only the admin change the settings, and checks what is saved', async () => {
    const body = JSON.stringify({
      refreshMinutes: 1,
      settings: {
        organisation: 'Acme', language: 'ko', services: { deepseek: 'block', nothing: 'block' },
        customServices: [{ name: 'Internal', domains: ['llm.corp.example'], action: 'allow' }, { name: '', domains: [] }],
        customRules: [{ name: 'Slow', type: 'regex', pattern: '(a+)+$', action: 'block' }],
      },
    });
    const refused = await fetch(`${base}api/admin/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(refused.status, 401);
    const before = (await state()).version;
    const saved = await (await fetch(`${base}api/admin/settings`, { method: 'PUT', headers: asAdmin(), body })).json();
    assert.notEqual(saved.version, before);
    assert.equal(saved.refreshMinutes, 5);
    assert.deepEqual(saved.settings.services, { deepseek: 'block' });
    assert.equal(saved.settings.customServices.length, 1);
    assert.deepEqual(saved.dropped, { ownServices: 1, ownRules: 1 });
    assert.equal(saved.summary.blocked, 1);

    const got = await fetchServerSettings({ url: base, key: saved.enrollmentKey, version: before });
    assert.equal(got.unchanged, false);
    assert.equal(got.settings.organisation, 'Acme');
    assert.equal(got.refreshMinutes, 5);
    const bad = await fetch(`${base}api/admin/settings`, { method: 'PUT', headers: asAdmin(), body: '{"settings": []}' });
    assert.equal(bad.status, 400);
  });

  it('stops handing out to the old enrolment key after a new one is made', async () => {
    const old = (await state()).enrollmentKey;
    const renewed = await (await fetch(`${base}api/admin/enrollment-key`, { method: 'POST', headers: asAdmin() })).json();
    assert.notEqual(renewed.enrollmentKey, old);
    assert.equal((await fetchServerSettings({ url: base, key: old })).error, 'unauthorized');
    assert.equal((await fetchServerSettings({ url: base, key: renewed.enrollmentKey })).ok, true);
  });

  it('serves the admin page and nothing else from disk', async () => {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await page.text(), /admin\.js/);
    for (const path of ['state.json', '../server.js', 'server.js', 'data/state.json']) {
      assert.equal((await fetch(`${base}${path}`)).status, 404, path);
    }
    assert.deepEqual(await (await fetch(`${base}healthz`)).json(), { ok: true });
  });

  it('reports what went wrong when a download fails', async () => {
    assert.equal((await fetchServerSettings({ url: 'http://127.0.0.1:9/' })).error, 'network');
    assert.equal((await fetchServerSettings({ url: `${base}nowhere/`, key: 'k' })).error, 'notFound');
    assert.equal((await fetchServerSettings({ url: 'not an address' })).error, 'address');
    const answer = (body, status = 200) => async () => new Response(body, { status });
    assert.equal((await fetchServerSettings({ url: base }, answer('<html>'))).error, 'invalid');
    assert.equal((await fetchServerSettings({ url: base }, answer('{"version":"v","settings":[]}'))).error, 'invalid');
    assert.equal((await fetchServerSettings({ url: base }, answer('{}', 500))).error, 'server');
  });

  it('slows down repeated wrong admin keys without ever locking out the right one', async () => {
    const attempt = () => fetch(`${base}api/admin/state`, { headers: { Authorization: 'Bearer wrong' } });
    // Earlier tests already sent a wrong key or two from this address.
    const statuses = [];
    for (let i = 0; i < 10; i += 1) statuses.push((await attempt()).status);
    assert.equal(statuses[0], 401);
    const started = Date.now();
    assert.equal((await attempt()).status, 429);
    assert.ok(Date.now() - started >= 140, 'a further wrong key is answered late');
    const quick = Date.now();
    assert.equal((await fetch(`${base}api/admin/state`, { headers: asAdmin() })).status, 200, 'the right key still works');
    assert.ok(Date.now() - quick < 140, 'and is not delayed');
  });

  it('keeps a table of wrong keys with a size limit, without forgetting an address that keeps guessing', () => {
    const note = wrongKeyTable({ limit: 3, windowMs: 1000 });
    assert.equal(note('guesser', 0), 1);
    assert.equal(note('guesser', 1), 2);
    // Before: past the limit the whole table was emptied, and the guesser started again at 1.
    for (const [i, other] of ['a', 'b'].entries()) note(other, 2 + i);
    assert.equal(note('guesser', 5), 3);
    note('c', 6);
    assert.equal(note('guesser', 7), 4, 'the address heard from least recently goes, not the guesser');
    assert.equal(note('a', 8), 1, 'a was dropped to make room');
    assert.equal(note('guesser', 2000), 1, 'an expired count starts again');
    assert.equal(loopbackOnly('127.0.0.1'), true);
    assert.equal(loopbackOnly('0.0.0.0'), false);
  });

  it('keeps every address of the admin page relative, so it works under a path prefix', () => {
    const page = readFileSync(new URL('../server/admin.js', import.meta.url), 'utf8') + readFileSync(new URL('../server/admin.html', import.meta.url), 'utf8');
    assert.doesNotMatch(page, /['"]\/(api|admin)/);
    assert.doesNotMatch(page, /location\.origin/);
    // The admin key is not sent over plain HTTP to another machine (it was before).
    assert.match(page, /location\.protocol === 'http:' && !\['localhost', '127\.0\.0\.1', '\[::1\]'\]\.includes\(location\.hostname\)/);
  });

  it('says when a server address is plain HTTP to another machine', () => {
    assert.equal(isUnprotectedAddress('http://10.0.0.5:8787/'), true);
    assert.equal(isUnprotectedAddress('http://guardrail.example.com'), true);
    for (const fine of ['https://guardrail.example.com/', 'http://localhost:8787/', 'http://127.0.0.1:8787/', 'not an address']) {
      assert.equal(isUnprotectedAddress(fine), false, fine);
    }
  });

  it('never downloads from or reports to plain HTTP on another machine', async () => {
    const calls = [];
    const fake = async (url) => {
      calls.push(url);
      return new Response(JSON.stringify({ version: 'v1', settings: {} }), { status: 200 });
    };
    assert.deepEqual(await fetchServerSettings({ url: 'http://10.0.0.5:8787/', key: 'k' }, fake), { ok: false, error: 'insecure' });
    assert.deepEqual(await sendCheckIn({ url: 'http://guardrail.example.com/', key: 'k' }, { id: 'x' }, fake), { ok: false });
    assert.deepEqual(calls, []);
    assert.equal((await fetchServerSettings({ url: 'http://127.0.0.1:8787/', key: 'k' }, fake)).ok, true);
    assert.equal(calls.length, 1);
  });
});
