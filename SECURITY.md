# Security policy

KYRA AI Guardrail Free is a security tool, so reports of weaknesses in it are welcome.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

- E-mail **contact@seekerslab.com** with the subject "KYRA AI Guardrail Free security".
- Say what you found, how to reproduce it, and which version or commit you used.
- If the report includes sensitive details, ask first and we will arrange a safer way to send them.

We aim to answer within five working days and to tell you what we plan to do. Please give us a
reasonable time to fix the problem before making it public.

## What counts

- A way to send text or a file to a covered AI site without the configured check.
- A way to change or read the settings, the activity log or the enrollment key from a web page.
- A weakness in the management server (`server/`): reading or changing settings without the
  right key, reading files outside the admin page, or taking the server down with a small request.
- A way for a settings document, from a file or a management server, to run code.

## What does not

- A person removing or disabling the extension in a browser that is not managed. The README says so.
- Desktop apps, other browsers and other tools: the extension covers one browser.
- Text inside images and PDF files, which the free edition does not read.

## Supported versions

Fixes go into the latest version on the `main` branch.
