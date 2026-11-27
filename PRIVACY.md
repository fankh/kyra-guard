# Privacy policy: KYRA AI Guardrail Free

Effective date: 23 November 2026

KYRA AI Guardrail Free is a browser extension published by Seekers Inc. ("we").

## Summary

We do not collect, receive or sell any data. Everything the extension checks, it checks in
your browser, and what you type or attach never leaves it. Out of the box the extension makes no
network request. If you or your organization connect it to a management server that your
organization runs, it downloads its settings from that server and reports to it the name given
to the browser, its versions and daily counts of blocked and warned events.

## What the extension processes

- **Text you are about to send to an AI site, and the text of files you attach there.** It is
  checked in your browser against the data rules in your settings. It is not stored and not
  sent to us or to anyone else.
- **Your settings.** They are stored in your browser (`chrome.storage.local`). If your
  organization manages the extension, it reads the settings your administrator pushed through
  browser policy.
- **The activity log.** If it is turned on, the extension keeps up to 500 entries in your
  browser. An entry holds the time, the AI site, the name of the rule that matched, the name of
  an attached file, and the reason you typed on a warning page. It never holds the text of a
  message or the contents of a file. You can clear the log or turn it off in the settings.

## The optional management server

A management server is a program your organization runs on its own machine; we do not run one
and have no access to it. When the extension is connected to one, it asks that server for the
settings document from time to time and then checks in. Both requests carry the enrollment key
your organization chose and, as with any web request, your network address.

The check-in tells your organization's server:

- the name given to this browser, if one was typed or set by your administrator, and a random
  identifier and a random secret made for this browser when it connected (the secret only proves
  that later check-ins come from the same browser; the server keeps a hash of it);
- the version of the extension and of the settings in force;
- whether the checks of messages and files are on, and how many of your own services still wait
  for site access;
- for each of the last 7 days, how many times something was blocked, warned about, or sent
  after a warning.

It never tells the server which sites you used, which rules matched, the names of files, the
reason you typed on a warning page, or anything you typed or attached. The activity log itself
stays in your browser. You can see the connection, and disconnect unless your administrator set
it, in the settings; disconnecting deletes the identifier.

## What we receive

Nothing. We have no access to your settings, your activity log, or anything you type.

## Sharing

No data is shared with third parties, because none leaves your browser. If you save the
settings or the log to a file, that file is yours to keep or share.

## Site access

At install the extension can run on the AI services it knows. It asks for access to another
site only when you add that site as an AI service in the settings.

## Removing your data

Removing the extension deletes its settings and its activity log from the browser.

## Changes

We will post changes to this policy at this address and update the effective date.

## Contact

contact@seekerslab.com

---

# 개인정보 처리방침: KYRA AI Guardrail Free

시행일: 2026년 11월 23일

KYRA AI Guardrail Free는 (주)씨커스(이하 "당사")가 배포하는 브라우저 확장 프로그램.

## 요약

- 본 확장 프로그램은 어떠한 데이터도 수집, 전송, 판매하지 않음
- 기본 상태에서 확장 프로그램 자체의 네트워크 요청 없음
- 사용자 또는 소속 조직이 조직 자체 운영 관리 서버에 연결한 경우 해당 서버에서 설정을 내려받고 브라우저 이름, 버전, 일별 차단·경고 건수를 해당 서버에 보고
- 입력하거나 첨부한 내용은 어떠한 경우에도 브라우저 외부로 전송하지 않음
- 모든 처리는 사용자의 브라우저 안에서 수행

## 처리 대상

- **AI 사이트로 보내려는 텍스트와 첨부 파일의 텍스트**: 설정된 데이터 규칙으로 브라우저 안에서 검사. 저장하지 않으며 당사를 포함한 어느 곳에도 전송하지 않음
- **설정**: 브라우저(`chrome.storage.local`)에 저장. 조직에서 관리하는 경우 관리자가 브라우저 정책으로 배포한 설정을 읽음
- **활동 기록**: 사용 설정 시 최대 500건을 브라우저에 보관. 기록 항목은 시각, AI 사이트, 일치한 규칙 이름, 첨부 파일 이름, 경고 화면에 입력한 사유. 메시지 본문과 파일 내용은 기록하지 않음. 설정에서 삭제 및 사용 중지 가능

## 관리 서버(선택 사항)

- 관리 서버는 소속 조직이 자체 장비에서 운영하는 프로그램으로 당사는 운영하지 않으며 접근 권한 없음
- 연결 시 확장 프로그램이 주기적으로 해당 서버에 설정 문서를 요청하고 상태를 보고
- 요청에 포함되는 정보: 조직이 정한 등록 키, 일반 웹 요청과 동일한 네트워크 주소
- 보고 항목: 브라우저 이름(입력하였거나 관리자가 지정한 경우), 연결 시 생성한 임의 식별자 및 비밀 값(동일 브라우저의 보고임을 확인하는 용도, 서버는 해시만 보관), 확장 프로그램 및 설정 버전, 메시지·파일 검사 사용 여부, 사이트 접근 대기 중인 직접 추가 서비스 수, 최근 7일의 일별 차단·경고·경고 후 전송 건수
- 보고하지 않는 항목: 사용한 사이트, 일치한 규칙, 파일 이름, 경고 화면에 입력한 사유, 입력하거나 첨부한 내용. 활동 기록은 브라우저에 보관
- 연결 상태는 설정에서 확인 가능하며, 관리자가 지정한 경우를 제외하고 연결 해제 가능. 연결 해제 시 식별자 삭제

## 당사가 수신하는 정보

- 없음. 설정, 활동 기록, 입력 내용에 대한 당사의 접근 권한 없음

## 제3자 제공

- 브라우저 외부로 전송되는 데이터가 없으므로 제3자 제공 없음
- 설정 또는 활동 기록을 파일로 저장한 경우 해당 파일의 보관 및 공유는 사용자 책임

## 사이트 접근 권한

- 설치 시: 기본 등록된 AI 서비스 사이트에 한정
- 그 외 사이트: 사용자가 설정에서 AI 서비스로 추가하는 시점에 해당 사이트에 대해서만 요청

## 데이터 삭제

- 확장 프로그램 제거 시 설정과 활동 기록이 브라우저에서 삭제

## 변경

- 본 방침 변경 시 본 주소에 게시하고 시행일 갱신

## 문의

contact@seekerslab.com
