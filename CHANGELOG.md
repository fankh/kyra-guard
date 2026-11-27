# Changelog

## 1.1.1 (security fixes)

- **Long messages and files are checked in full.** Text past the first 100,000 characters used to
  be sent unchecked; it is now checked in overlapping pieces. A message over 1,000,000 characters
  is not sent, and a file over 20 MB or with more text than that counts as one that cannot be
  checked.
- **Files that cannot be checked are warned about by default** on a new install (images, PDF,
  archives, other formats). Settings saved before keep their choice.
- **Own rules that can freeze the checks are refused**: a repeated group holding a repeat, such as
  `(a+)+`, and expressions found slow on text built from all of their characters (the trial used
  only the first six).
- **The management server must use HTTPS**, except on the same machine. A plain-HTTP address to
  another machine is refused, since the settings and the enrollment key could be read and changed
  on the network; settings downloaded before stay in force.
- **Hidden values are found**: a value with an invisible (zero-width) character in it, written in
  full-width digits, or typed with spaces between its characters is checked as if written plainly.
- **Chat boxes inside frames are checked**, also on a site that is not an AI service, and a
  "Save" button (editing an earlier message) counts as sending. When the extension does not
  answer within 60 seconds, a message or file is held with a warning instead of being let through.
- **The blocked and warning pages can no longer be opened by other sites.** The warning page
  shows nothing inside a frame, and reports from a framed page are ignored.
- **Management server**:
  - each browser sends a secret of its own, so nobody else can check in under its id;
  - at most 1,000 new browsers an hour are taken, and check-ins are written to disk together;
  - the admin page does not send the admin key over plain HTTP to another machine;
  - the server warns at start when it listens beyond the machine it runs on;
  - the table of wrong admin keys keeps its size limit without being emptied.

## 1.1.0

- **Korean AI services**: 14 more known services (65 in all): Upstage, A. (에이닷), Kanana, CLOVA
  Studio, CLOVA Note, Papago, Alan, Readray (Lilys AI), Daglo, Goover, Tiro, Typecast, Vrew and
  FriendliAI. The browser asks once to accept access to the added sites.
- **Data rules for public bodies**: security markings (대외비, Ⅰ·Ⅱ·Ⅲ급 비밀, 군사기밀; warns by
  default), corporate registration numbers and landline phone numbers (both off by default).
- **Management server**: the admin page lists the connected browsers with versions and daily
  counts; wrong admin keys are slowed down instead of locking the admin out; the server works
  under a path prefix; the settings page warns about a plain-HTTP server address.
- The settings page links to the commercial edition.

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
