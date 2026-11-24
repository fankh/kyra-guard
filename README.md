# KYRA AI Guardrail Free

A Chrome/Edge (Manifest V3) extension that keeps sensitive data out of AI services, with
**every setting kept in the browser**. What you type is checked on your machine and then
dropped; what you send never leaves the browser. Out of the box the extension makes no
network request at all. An organisation that wants one set of settings for everyone, and to see
which browsers are covered, can run the small management server in `server/`. A connected
browser downloads its settings from that server and checks in with its name, versions and daily
counts; it never reports a site, a rule, a file name or anything typed.

- **AI services**: 51 known services (ChatGPT, Claude, Gemini, Copilot, DeepSeek and others).
  Each can be allowed, warned about (a reason is asked first) or blocked. You can add your own.
- **Messages**: before a message is sent on an AI site it is checked against the data rules.
  A finding either blocks the message or shows a warning with three choices: edit, send with
  the finding masked, or send anyway.
- **Files**: the text of attached text, Word, Excel and PowerPoint files is checked the same way.
- **Data rules**: 13 built-in rules (see below) and your own keyword or regular-expression rules.
- **Activity log**: the last 500 events, in the browser only. It records the site and the rule
  that matched, never the text or the file. It can be saved as CSV.
- **Management server (optional)**: a small program an organisation runs itself; every connected
  browser downloads the same settings from it, and the admin page lists the connected browsers
  with their versions and daily counts.
- **Language**: follows the browser, or English or Korean chosen in the settings.

**User guide with screenshots:** [English](docs/guide.md) · [한국어](docs/guide.ko.md) · [Changelog](CHANGELOG.md)

## Install

There is no build step.

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Choose **Load unpacked** and pick the `extension/` folder.
3. The settings page opens. A new install allows every known service and checks what is sent.

## Built-in rules

| Rule | Default | Check |
|---|---|---|
| Resident registration number (KR) | Block | 13 digits with a real date of birth |
| Foreigner registration number (KR) | Block | 13 digits with a real date |
| Passport number (KR) | Warn | format |
| Driver licence number (KR) | Warn | format |
| Mobile phone number (KR) | Warn | format |
| E-mail address | Off | format |
| Payment card number | Block | 13 to 19 digits with a valid Luhn check digit |
| Business registration number (KR) | Off | format and check digit |
| Private key | Block | PEM header |
| AWS access key | Block | format |
| API key or token (OpenAI, GitHub, GitLab, Slack, Google) | Block | format |
| JSON Web Token | Warn | format |
| Password written out (`password: ...`, `비밀번호=...`) | Warn | format |

Your own rules are either **keywords** (comma-separated; whole words for English, also matched
with a particle attached for Korean, Japanese and Chinese) or a **regular expression**. An
expression that would be slow enough to freeze the check is refused when you add it.

## Settings file

**Save settings to a file** on the settings page writes one JSON document; **Load settings from a
file** reads it back. Use it to move settings between browsers or share them with a team.

```json
{
  "organisation": "Acme",
  "language": "auto",
  "defaultAction": "allow",
  "services": { "deepseek": "block", "chatgpt": "alert" },
  "customServices": [{ "name": "Internal LLM", "domains": ["llm.corp.example"], "action": "allow" }],
  "inspection": { "prompts": true, "files": true, "unscannableFiles": "warn" },
  "rules": { "email-address": "warn", "kr-mobile-phone": "block" },
  "customRules": [{ "name": "Project names", "type": "keyword", "pattern": "apollo, 대외비", "action": "block" }],
  "log": true
}
```

Actions for a service are `allow`, `alert` (warn) and `block`; for a rule `off`, `warn` and
`block`. Anything unknown in the file is ignored.

### Managed by an administrator

An administrator can push the same document through browser policy as the `settingsJson` string
of this extension (see `extension/managed_schema.json`). The settings are then used as a whole
and the settings page becomes read-only. On Windows, for Chrome:

```
HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist
  1 (REG_SZ) = kidphjodkengcdmmpfdagohlnimmfmhb;https://clients2.google.com/service/update2/crx

HKLM\Software\Policies\Google\Chrome\3rdparty\extensions\kidphjodkengcdmmpfdagohlnimmfmhb\policy
  settingsJson (REG_SZ) = {"organisation":"Acme","services":{"deepseek":"block"}}
  serverUrl    (REG_SZ) = https://guardrail.example.com/
  serverKey    (REG_SZ) = <enrollment key>
```

The first key installs the extension from the Chrome Web Store and stops people removing it;
`kidphjodkengcdmmpfdagohlnimmfmhb` is its store ID. Push either `settingsJson` or `serverUrl` and `serverKey`, not both:
`settingsJson` wins. For Microsoft Edge use `HKLM\Software\Policies\Microsoft\Edge\...` with
the same values; on macOS and Linux, and through Google Admin or Intune, the same names apply as
managed preferences or a configuration profile.

### Management server

For an organisation without browser management, or one that wants to change settings without
touching every PC, `server/` holds a small server. It needs Node 20 or later and nothing else.

```
node server/server.js
```

| Setting | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port to listen on |
| `HOST` | `127.0.0.1` | Address to listen on; set it to reach the server from other machines |
| `KYRA_DATA_DIR` | `./data` | Folder for `state.json`, the one file the server keeps |

1. The first start prints the **admin key** once. Keep it; `node server/server.js --reset-admin-key`
   makes a new one.
2. Open the server address in a browser and sign in with the admin key. The page shows the
   settings in force, the **server address** and the **enrollment key** for browsers.
3. Set things up in your own browser with the extension, choose **Save settings to a file**, and
   load that file on the admin page (or edit the document there). **Save and hand out**.
4. In each browser, open the extension settings, enter the server address and enrollment key
   under **Management server** and press **Connect**. With browser management, push them as the
   `serverUrl` and `serverKey` policy values instead; then a person cannot disconnect.

What a connected browser does:

- It downloads the settings at start and then every 30 minutes (5 minutes to a day, set on the
  admin page). The settings page becomes read-only and shows where the settings come from.
- After each download it checks in, so the admin page can list the connected browsers. The
  server keeps the last check-in of each browser and no network address.

| Sent at each check-in | Never sent |
|---|---|
| The name given to the browser (optional) and a random browser id | Sites visited or used |
| Extension version and the version of the settings in force | Which rule matched |
| Whether the message check and the file check are on | File names |
| How many own services still wait for site access | The reason typed on a warning page |
| Counts per day for the last 7 days: blocked, warned, sent after a warning | Anything typed or attached |

- The name is typed under **Management server** when connecting, or pushed as the `deviceLabel`
  policy value. Without one the list shows the first characters of the browser id.
- The counts come from the browser's own activity log, which keeps 500 events; with the log off
  no counts are sent.
- On the admin page, **Remove** takes a browser off the list (a retired PC, for example).
- If the server cannot be reached, the settings downloaded last stay in force.
- Settings pushed as `settingsJson` through browser policy win over the server.

Put the server behind HTTPS (a reverse proxy with a certificate) for anything beyond a trial:
over plain HTTP the settings and the enrollment key can be read on the network. The admin key
is stored only as a hash. Wrong admin keys are slowed down after the tenth from one address;
the right key is never locked out. The settings page warns when the server address is plain
HTTP to another machine.

Behind a reverse proxy the server may sit under a path prefix (for example
`https://example.com/kyra/`); open the admin page with the trailing slash and give browsers
that same address.

To report a security problem, see [SECURITY.md](SECURITY.md).

## What to check before relying on it

- **Images and PDF files are not read.** Choose what happens to files that cannot be read
  (allow, warn or block) in the settings.
- **A person can change or remove it** unless an administrator force-installs it and pushes the
  settings through browser policy.
- **Only the browser is covered.** Desktop AI apps, command-line tools and other browsers are not.
- **The log never leaves the browser**, so nobody else sees it. The management server shows
  counts per browser and day, not what happened: no sites, rules or files. There is no central log.
- **The management server is one set of settings for everyone.** It has no users, groups or
  change history, and a person can disconnect unless the address is pushed through browser policy.
- **The list of browsers is what each browser says about itself.** A name is whatever was typed,
  and anyone with the enrollment key can check in.
- **Sites differ.** Sending is recognised by the Enter key and by send buttons. It was tested
  against a stand-in chat page; check it on the AI sites you use.
- **Site access.** At install the extension has access to the known AI services only. When you
  add your own service the browser asks for access to that site; until it is given, the service
  shows "Needs site access" and is not enforced. Settings loaded from a file or pushed by an
  administrator, or downloaded from a management server, need the same step for each own
  service (press **Grant access**).

The commercial KYRA AI Guardrail adds central policy and reporting, text recognition in images
and PDF files, per-user and per-group policy, data grade limits and change history. Its
extension is a separate program; this one does not connect to it.

## Development

```
npm test                              # unit tests (Node 20 or later, no dependencies)
npm run server                        # the management server on http://127.0.0.1:8787/
python test/e2e_playwright.py [dir]   # a real browser; needs Python and Playwright's Chromium
python scripts/guide_screenshots.py   # remakes the images of the user guide in docs/
```

```
extension/
  background.js       service worker: applies the settings, checks messages and files
  lib/rules.js        the built-in rules, your own rules, scanning and masking
  lib/settings.js     the settings document: defaults, validation, managed settings
  lib/remote.js       downloads settings from a management server (the only network request)
  lib/catalog.js      the known AI services
  lib/reporter.js     the activity log
  lib/policy.js       declarativeNetRequest rules for warned and blocked services
  content/            the page script on AI sites: holds a send or an attachment until checked
  ui/, *.html         settings page, popup, blocked page, warning page
```

`store/` holds the store listing text, the privacy policy and the listing images
(`python scripts/store_screenshots.py` regenerates the images).

## Licence

Apache License 2.0. See `LICENSE` and `NOTICE`.
