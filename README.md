# KYRA AI Guardrail Free

A Chrome/Edge (Manifest V3) extension that keeps sensitive data out of AI services, with
**every setting kept in the browser**. It has no server and makes no network request of its
own: what you type is checked on your machine and then dropped.

- **AI services**: 51 known services (ChatGPT, Claude, Gemini, Copilot, DeepSeek and others).
  Each can be allowed, warned about (a reason is asked first) or blocked. You can add your own.
- **Messages**: before a message is sent on an AI site it is checked against the data rules.
  A finding either blocks the message or shows a warning with three choices: edit, send with
  the finding masked, or send anyway.
- **Files**: the text of attached text, Word, Excel and PowerPoint files is checked the same way.
- **Data rules**: 13 built-in rules (see below) and your own keyword or regular-expression rules.
- **Activity log**: the last 500 events, in the browser only. It records the site and the rule
  that matched, never the text or the file. It can be saved as CSV.
- **Languages**: English and Korean.

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
HKLM\Software\Policies\Google\Chrome\3rdparty\extensions\<extension id>\policy
  settingsJson (REG_SZ) = {"organisation":"Acme","services":{"deepseek":"block"}}
```

## What to check before relying on it

- **Images and PDF files are not read.** Choose what happens to files that cannot be read
  (allow, warn or block) in the settings.
- **A person can change or remove it** unless an administrator force-installs it and pushes the
  settings through browser policy.
- **Only the browser is covered.** Desktop AI apps, command-line tools and other browsers are not.
- **The log never leaves the browser**, so nobody else sees it. There is no central reporting.
- **Sites differ.** Sending is recognised by the Enter key and by send buttons. It was tested
  against a stand-in chat page; check it on the AI sites you use.
- **Site access.** At install the extension has access to the known AI services only. When you
  add your own service the browser asks for access to that site; until it is given, the service
  shows "Needs site access" and is not enforced. Settings loaded from a file or pushed by an
  administrator need the same step for each own service (press **Grant access**).

The commercial KYRA AI Guardrail adds central policy and reporting, text recognition in images
and PDF files, per-user and per-group policy, data grade limits and change history. Its
extension is a separate program; this one does not connect to it.

## Development

```
npm test                              # unit tests (Node 20 or later, no dependencies)
python test/e2e_playwright.py [dir]   # a real browser; needs Python and Playwright's Chromium
```

```
extension/
  background.js       service worker: applies the settings, checks messages and files
  lib/rules.js        the built-in rules, your own rules, scanning and masking
  lib/settings.js     the settings document: defaults, validation, managed settings
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
