# Store listing: KYRA AI Guardrail Free

Text and answers for the Chrome Web Store developer dashboard (the same text serves Microsoft
Edge Add-ons). Items marked **[fill in]** need a value from the publisher.

## Package and images

| Item | File |
|---|---|
| Upload package | `git archive --format=zip -o kyra-guardrail-free-<version>.zip HEAD .` run inside `extension/` |
| Store icon, 128x128 | `extension/icons/icon128.png` |
| Screenshots, 1280x800 | `store/screenshots/en/*.png`, `store/screenshots/ko/*.png` |
| Small promo tile, 440x280 | `store/promo-440x280.png` |

Regenerate the images with `python scripts/store_screenshots.py`.

## Store listing tab

- **Category:** Privacy & Security (if not offered: Workflow & Planning under Productivity)
- **Language:** English (default), Korean
- **Homepage URL:** https://seekerslab.com
- **Support URL:** https://github.com/fankh/kyra-guard/issues (e-mail: contact@seekerslab.com)

### English

**Name:** KYRA AI Guardrail Free

**Summary (132 characters at most):**
Checks what you send to AI chats for personal data and keys, in your browser. Warn, mask or block. Nothing is sent anywhere.

**Description:**

KYRA AI Guardrail Free keeps sensitive data out of AI services. Before a message or a file goes to an AI chat, it is checked in your browser against data rules you control. Nothing you type is sent to us or to anyone else. Out of the box the extension makes no network request at all.

What it does
- Checks the messages you send on AI sites such as ChatGPT, Claude, Gemini, Copilot and DeepSeek (51 services are known out of the box; add your own).
- Checks the text of files you attach: plain text, Word, Excel and PowerPoint.
- When it finds something, it either blocks the message or shows a warning. From the warning you can edit the message, send it with the finding masked, or send it anyway.
- Lets you allow, warn about or block each AI service.

Built-in data rules
- Korean resident and foreigner registration numbers, passport, driver licence, mobile phone and business registration numbers
- Payment card numbers (with check-digit validation)
- Private keys, AWS access keys, API keys and tokens (OpenAI, GitHub, GitLab, Slack, Google), JSON Web Tokens, written-out passwords
- E-mail addresses (off by default)
- Your own rules: keywords or regular expressions

Private by design
- Every setting and the activity log stay in this browser.
- The activity log records the site and the rule that matched, never your text or your files.
- No account, no sign-in, no analytics.

For teams
- Save the settings to a file and share them, or let an administrator push them through browser policy.
- An organization can run the small open-source management server itself. Connected browsers download their settings from it and report their name, versions and daily counts, never sites, rules or what you type.
- Shown in the browser's language, or in English or Korean if you choose.

What it does not do
- It does not read text inside images or PDF files.
- It covers this browser only, not desktop apps or other browsers.

Open source under the Apache License 2.0: https://github.com/fankh/kyra-guard

### Korean (한국어)

**이름:** KYRA AI Guardrail Free

**요약 (132자 이내):**
AI 대화로 보내는 내용의 개인정보와 키를 브라우저 안에서 검사. 경고, 마스킹 또는 차단. 외부 전송 없음.

**설명:**

KYRA AI Guardrail Free는 민감한 데이터가 AI 서비스로 전송되지 않도록 지원하는 확장 프로그램. 메시지와 파일을 AI 대화로 보내기 전에 사용자가 설정한 데이터 규칙으로 브라우저 안에서 검사. 입력 내용은 당사를 포함한 어느 곳에도 전송되지 않음. 기본 상태에서 확장 프로그램 자체의 네트워크 요청 없음.

주요 기능
- ChatGPT, Claude, Gemini, Copilot, DeepSeek 등 AI 사이트에서 보내는 메시지 검사 (기본 등록 51개 서비스, 직접 추가 가능)
- 첨부 파일의 텍스트 검사: 일반 텍스트, Word, Excel, PowerPoint
- 발견 시 차단 또는 경고. 경고 화면에서 메시지 수정, 마스킹 후 전송, 그대로 전송 중 선택
- AI 서비스별 허용, 경고, 차단 지정

기본 데이터 규칙
- 주민등록번호, 외국인등록번호, 여권번호, 운전면허번호, 휴대전화번호, 사업자등록번호
- 카드번호 (검증 번호 확인 포함)
- 개인 키, AWS 액세스 키, API 키 및 토큰(OpenAI, GitHub, GitLab, Slack, Google), JWT 토큰, 기재된 비밀번호
- 이메일 주소 (기본값: 사용 안 함)
- 사용자 규칙: 키워드 또는 정규식

개인정보 보호
- 모든 설정과 활동 기록은 해당 브라우저에만 저장
- 활동 기록에는 사이트와 일치한 규칙만 기록, 입력 내용과 파일은 기록하지 않음
- 계정, 로그인, 사용 통계 수집 없음

팀 사용
- 설정을 파일로 저장하여 공유, 또는 관리자가 브라우저 정책으로 배포
- 조직이 오픈 소스 관리 서버를 직접 운영하는 경우 연결된 브라우저가 설정을 내려받고 이름, 버전, 일별 건수를 보고. 사이트, 규칙, 입력 내용은 미전송
- 표시 언어: 브라우저 언어 또는 설정에서 선택한 영어·한국어

추가적으로 확인해야 되는 부분
- 이미지와 PDF 파일 안의 텍스트는 검사 대상이 아니므로 해당 파일의 처리 방식(허용, 경고, 차단)을 설정에서 지정 필요
- 적용 범위는 해당 브라우저이므로 데스크톱 앱과 다른 브라우저는 별도 대책 필요

Apache License 2.0 오픈 소스: https://github.com/fankh/kyra-guard

## Privacy practices tab

**Single purpose:**
Protect the user from sending sensitive data to AI services: it checks, in the browser, what the user sends to AI sites and can warn about or block AI sites.

**Permission justifications:**

| Permission | Justification |
|---|---|
| Host access to the listed AI sites | The purpose of the extension is to check what the user sends on these AI sites. A content script on these sites holds a message or an attached file until it has been checked locally. The list is the 51 AI services the extension knows; no other site is accessed at install. |
| Optional host access (`*://*/*`) | Requested only when the user adds their own AI service in the settings, and only for the domains the user typed. Without it the extension could not cover AI services that are not in its built-in list. |
| `scripting` | Registers the content script only on AI services that are not blocked, and updates that registration when the user changes the settings. |
| `declarativeNetRequest`, `declarativeNetRequestWithHostAccess` | Redirects a navigation to an AI service the user set to "warn" or "block" to the warning or blocked page inside the extension. Rules are built from the user settings; no request content is read. |
| `storage` | Stores the settings and the activity log in the browser, and reads settings pushed by an administrator through managed storage. |
| `alarms` | Ends the one-hour "continue" allowance after the user proceeds past a warning. |

**Remote code:** No, the extension does not use remote code. All code is in the package. When
an organization connects it to its own management server, it downloads a settings document
(JSON data: which services to warn about or block, which data rules apply). The document is
validated and never executed.

**Data usage (what the extension collects):** none of the listed categories is collected or transmitted.
The extension processes the text the user is about to send to an AI site, in the browser, to
check it against the rules; the text is not stored and not transmitted. The activity log
(site name, rule name, file name, the reason the user typed on a warning page) stays in
`chrome.storage.local` on the device.
The optional management server belongs to the user's organization, not to the publisher; the
extension downloads settings from it and reports the name given to the browser, a random
browser id, the extension and settings versions, whether the checks are on, and daily counts of
blocked and warned events. It reports no site, rule, file name or typed text. Nothing is sent to
the publisher. If the form asks about "User activity", declare these counts as sent to the
user's own organization, only when the user or their administrator connects a server.

Certify all three statements:
- Data is not sold or transferred to third parties, outside the approved use cases.
- Data is not used or transferred for purposes unrelated to the single purpose of the item.
- Data is not used or transferred to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/fankh/kyra-guard/blob/main/PRIVACY.md (the same text as `store/privacy-policy.md`)

## Distribution tab

- **Visibility:** Public (or Unlisted for a first trial)
- **Regions:** all regions
- **Pricing:** free

## Account

- **Publisher name:** Seekers Inc.
- **Trader declaration and contact details (EU):** **[fill in]**

## Notes for later versions

- Adding a service to `lib/catalog.js` adds a host permission. Chrome disables an installed
  extension until the user accepts new permissions, so batch such additions.
