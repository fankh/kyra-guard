# Changelog

## 1.0.0 (first release)

### Extension

- **AI services**: 51 known services, each allowed, warned about (a reason is asked first) or
  blocked; your own services can be added.
- **Message check**: a message on an AI site is checked against the data rules before it is
  sent. A finding blocks it, or shows a warning with three choices: edit, send with the finding
  masked, or send anyway.
- **File check**: the text of attached text, Word, Excel and PowerPoint files is checked the
  same way. What happens to files that cannot be read (images, PDF, archives) is a setting.
- **Data rules**: 13 built-in rules (Korean resident, foreigner, passport, driver licence, mobile
  phone and business numbers, payment cards, private keys, AWS keys, API keys and tokens, JSON
  Web Tokens, written-out passwords, e-mail addresses) and your own keyword or
  regular-expression rules, with a box to try them.
- **Activity log**: the last 500 events in the browser, with CSV export. It records the site and
  the rule, never the text or the file.
- **Settings**: kept in the browser; saved to and loaded from a file; can be pushed and locked
  through browser policy (`settingsJson`).
- **Language**: follows the browser, or English or Korean chosen in the settings.

### Management server (optional)

- A small self-hosted server (`server/`, Node 20, no dependencies) that hands one set of
  settings to every connected browser.
- The admin page lists the connected browsers with their name, versions, whether the checks are
  on, last check-in and daily counts of blocked and warned events. Browsers never report sites,
  rules, file names or anything typed.
- Browsers connect in the settings page or through the `serverUrl`, `serverKey` and
  `deviceLabel` policy values.
