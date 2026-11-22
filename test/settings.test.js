import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { CATALOG } from '../extension/lib/catalog.js';
import { buildDynamicRules, parsePolicy, promptMatchPatterns } from '../extension/lib/policy.js';
import { LOG_ACTIONS, MAX_LOG_ENTRIES, appendEntry, makeEntry, summarize, toCsv } from '../extension/lib/reporter.js';
import {
  defaultSettings, effectiveServices, loadSettings, normalizeSettings, originsFor, parseManaged, toPolicyJson,
} from '../extension/lib/settings.js';

const storage = (managed, local) => ({
  managed: { get: async () => managed ?? {} },
  local: { get: async () => (local ? { settings: local } : {}) },
});

describe('settings', () => {
  it('start with every known service allowed and both checks on', () => {
    const settings = defaultSettings();
    assert.deepEqual(normalizeSettings(settings), settings);
    const policy = parsePolicy(toPolicyJson(settings));
    assert.equal(policy.services.length, CATALOG.length);
    assert.ok(policy.services.every((s) => s.action === 'allow'));
    assert.equal(policy.promptInspection.enabled, true);
    assert.equal(policy.promptInspection.files, true);
    assert.equal(policy.promptInspection.images, false, 'the free edition never sends file bytes anywhere');
    assert.equal(buildDynamicRules(policy, { extensionOrigin: 'chrome-extension://x' }).rules.length, 0);
    assert.ok(promptMatchPatterns(policy).includes('*://*.chatgpt.com/*'));
  });

  it('drop what is unknown or wrong, whatever was stored or imported', () => {
    const settings = normalizeSettings({
      organisation: `  ${'A'.repeat(200)}  `, defaultAction: 'explode', hacked: true,
      services: { chatgpt: 'block', nosuch: 'block', claude: 'maybe' },
      customServices: [
        { name: 'Internal LLM', domains: 'LLM.Corp.Example, https://chat.corp.example/x, not a domain', action: 'allow' },
        { name: '', domains: ['x.example'] },
        { name: 'No domains', domains: [] },
      ],
      inspection: { prompts: false, unscannableFiles: 'delete' },
      rules: { 'payment-card': 'warn', 'no-such-rule': 'block', 'private-key': 'explode' },
      customRules: [
        { id: 'custom-1', name: 'Project', type: 'regex', pattern: 'PRJ-\\d{4}', action: 'block' },
        { id: 'custom-1', name: 'Same id', type: 'keyword', pattern: 'x' },
        { name: 'Slow', type: 'regex', pattern: '(a+)+$' },
      ],
      log: 'yes',
    });
    assert.equal(settings.organisation.length, 80);
    assert.equal(settings.defaultAction, 'allow');
    assert.equal('hacked' in settings, false);
    assert.deepEqual(settings.services, { chatgpt: 'block' });
    assert.deepEqual(settings.customServices, [
      { id: 'custom-llm-corp-example', name: 'Internal LLM', domains: ['llm.corp.example', 'chat.corp.example'], action: 'allow' },
    ]);
    assert.deepEqual(settings.inspection, { prompts: false, files: true, unscannableFiles: 'allow' });
    assert.deepEqual(settings.rules, { 'payment-card': 'warn' });
    assert.deepEqual(settings.customRules, [{ id: 'custom-1', name: 'Project', type: 'regex', pattern: 'PRJ-\\d{4}', action: 'block' }]);
    assert.equal(settings.log, true);
    assert.deepEqual(normalizeSettings(null), defaultSettings());
    assert.deepEqual(normalizeSettings([]), defaultSettings());
  });

  it('give each service its own choice, the default for the rest, and add own services', () => {
    const settings = normalizeSettings({
      defaultAction: 'alert', services: { claude: 'allow', deepseek: 'block' },
      customServices: [{ name: 'Internal LLM', domains: ['llm.corp.example'], action: 'block' }],
    });
    const byId = Object.fromEntries(effectiveServices(settings).map((s) => [s.id, s.action]));
    assert.equal(byId.claude, 'allow');
    assert.equal(byId.deepseek, 'block');
    assert.equal(byId.chatgpt, 'alert');
    assert.equal(byId['custom-llm-corp-example'], 'block');

    const policy = parsePolicy(toPolicyJson(settings));
    const { rules, stats } = buildDynamicRules(policy, { extensionOrigin: 'chrome-extension://x' });
    assert.equal(stats.blockedServices, 2);
    assert.ok(rules.some((r) => r.action.type === 'redirect' && r.condition.requestDomains.includes('llm.corp.example')));
    assert.ok(!promptMatchPatterns(policy).includes('*://*.deepseek.com/*'), 'a blocked site gets no page script');
  });

  it('change the policy version when anything changes', () => {
    const a = toPolicyJson(defaultSettings()).version;
    const b = toPolicyJson(normalizeSettings({ services: { chatgpt: 'block' } })).version;
    assert.match(a, /^local-[0-9a-f]{8}$/);
    assert.notEqual(a, b);
  });

  it('come from the administrator as a whole when pushed, else from this browser', async () => {
    const pushed = JSON.stringify({ organisation: 'Acme', services: { chatgpt: 'block' } });
    const managed = await loadSettings(storage({ settingsJson: pushed }, { organisation: 'Mine', services: { claude: 'block' } }));
    assert.equal(managed.source, 'managed');
    assert.equal(managed.settings.organisation, 'Acme');
    assert.deepEqual(managed.settings.services, { chatgpt: 'block' });

    const local = await loadSettings(storage({}, { organisation: 'Mine' }));
    assert.deepEqual([local.source, local.settings.organisation], ['local', 'Mine']);
    assert.equal((await loadSettings(storage({ settingsJson: 'not json' }, null))).source, 'default');
    assert.equal(parseManaged({ settingsJson: '[1]' }), null);
    assert.equal(parseManaged({}), null);
  });
});

describe('activity log', () => {
  const entry = (fields, at) => makeEntry({ action: 'prompt_warned', serviceId: 'chatgpt', serviceName: 'ChatGPT', host: 'chatgpt.com', ...fields }, at);

  it('keeps what happened, never more than its own fields', () => {
    const e = entry({ rules: ['Payment card number'], content: '4111 1111 1111 1111', reason: 'r'.repeat(900) }, 1000);
    assert.deepEqual(Object.keys(e).sort(), ['action', 'at', 'host', 'reason', 'rules', 'serviceId', 'serviceName']);
    assert.equal(e.reason.length, 500);
    assert.throws(() => makeEntry({ action: 'uploaded' }));
    assert.equal(LOG_ACTIONS.length, 9);
  });

  it('is newest first, capped, and does not repeat a blocked page within a minute', () => {
    let log = [];
    for (let i = 0; i < MAX_LOG_ENTRIES + 20; i += 1) log = appendEntry(log, entry({}, i * 1000));
    assert.equal(log.length, MAX_LOG_ENTRIES);
    assert.equal(log[0].at, (MAX_LOG_ENTRIES + 19) * 1000);

    const blocked = (at) => makeEntry({ action: 'blocked', host: 'deepseek.com' }, at);
    let visits = appendEntry([], blocked(0), { dedupe: true });
    visits = appendEntry(visits, blocked(30_000), { dedupe: true });
    assert.equal(visits.length, 1);
    visits = appendEntry(visits, blocked(90_000), { dedupe: true });
    assert.equal(visits.length, 2);
    assert.deepEqual(summarize(visits, 60_000), { blocked: 1 });
  });

  it('exports as CSV that a spreadsheet reads as text', () => {
    const csv = toCsv([entry({ rules: ['A', 'B'], fileName: '=cmd|x.txt', reason: 'said "ok",\nthen left' }, 0)]);
    const [header, row] = [csv.split('\r\n')[0], csv.slice(csv.indexOf('\r\n') + 2)];
    assert.equal(header, 'time,action,service,site,rules,file,reason');
    assert.equal(row, '1970-01-01T00:00:00.000Z,prompt_warned,ChatGPT,chatgpt.com,A; B,\'=cmd|x.txt,"said ""ok"",\nthen left"');
  });
});

describe('the package', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('asks for no account or network permission beyond what it needs', () => {
    const manifest = JSON.parse(read('../extension/manifest.json'));
    assert.deepEqual(manifest.permissions, ['declarativeNetRequest', 'declarativeNetRequestWithHostAccess', 'scripting', 'storage', 'alarms']);
    assert.equal('key' in manifest, false);
  });

  it('asks at install for the known AI sites only, and for any other site when it is added', () => {
    const manifest = JSON.parse(read('../extension/manifest.json'));
    const known = [...new Set(CATALOG.flatMap((s) => originsFor(s)))].sort();
    assert.deepEqual([...manifest.host_permissions].sort(), known, 'a service added to the catalog must be added to the manifest');
    assert.deepEqual(manifest.optional_host_permissions, ['*://*/*']);
    assert.ok(!JSON.stringify(manifest.host_permissions).includes('<all_urls>'));
    assert.deepEqual(originsFor({ domains: ['llm.corp.example'] }), ['*://*.llm.corp.example/*']);
  });

  it('makes no network request from its own code', () => {
    const dirs = ['../extension/', '../extension/lib/', '../extension/ui/', '../extension/content/'];
    for (const dir of dirs) {
      for (const name of readdirSync(new URL(dir, import.meta.url)).filter((n) => n.endsWith('.js'))) {
        const source = read(dir + name);
        assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(|sendBeacon|EventSource/, `${dir}${name}`);
      }
    }
  });

  it('has every text in both languages, and every text the pages ask for', () => {
    const en = JSON.parse(read('../extension/_locales/en/messages.json'));
    const ko = JSON.parse(read('../extension/_locales/ko/messages.json'));
    assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
    const used = new Set();
    for (const page of ['options.html', 'popup.html', 'blocked.html', 'warn.html']) {
      for (const m of read(`../extension/${page}`).matchAll(/data-i18n(?:-placeholder|-aria-label)?="([^"]+)"/g)) used.add(m[1]);
    }
    for (const file of ['ui/options.js', 'ui/popup.js', 'ui/blocked.js', 'ui/warn.js', 'content/prompt.js']) {
      for (const m of read(`../extension/${file}`).matchAll(/\bt\(\s*'([A-Za-z_]+)'/g)) used.add(m[1]);
      for (const m of read(`../extension/${file}`).matchAll(/: '((?:err|prompt|file)[A-Za-z]+)'/g)) used.add(m[1]);
    }
    for (const action of LOG_ACTIONS) used.add(`log_${action}`);
    const missing = [...used].filter((key) => !(key in en));
    assert.deepEqual(missing, []);
  });

  // In the product repository the page-side files are shared with the commercial extension
  // and must stay identical. A copy of this folder on its own skips the check.
  it('keeps the files shared with the commercial extension identical', { skip: !existsSync(new URL('../../browser-extension/extension/manifest.json', import.meta.url)) }, () => {
    const shared = ['lib/matching.js', 'lib/policy.js', 'lib/pageparams.js', 'content/prompt-core.js', 'content/file-core.js',
      'content/prompt.js', 'ui/common.js', 'ui/blocked.js', 'ui/warn.js', 'ui/style.css', 'blocked.html', 'warn.html'];
    for (const file of shared) {
      // A checkout may give the two copies different line endings; the content is what counts.
      const text = (path) => read(path).replace(/\r\n/g, '\n');
      assert.equal(text(`../extension/${file}`), text(`../../browser-extension/extension/${file}`), file);
    }
  });
});
