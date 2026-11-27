"""End-to-end check of the free edition in headless Chromium (manual, not CI).

There is no KYRA server. A local web server only serves a stand-in chat page under three test
domains, which the options page adds as the user's own AI services: one allowed, one warned
and one blocked. Every request the browser makes is recorded, to show that nothing goes
anywhere but that page.

    python test/e2e_playwright.py [screenshot-dir]

Uses its own temporary browser profile and never connects to an existing Chrome.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright

EXTENSION_DIR = Path(__file__).resolve().parent.parent / "extension"
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
POSTS: list[str] = []

PAGE = """<!doctype html><meta charset="utf-8"><title>chat</title>
<input id="file" type="file" multiple>
<div id="box" contenteditable="true" style="border:1px solid #888;min-height:40px"></div>
<button id="send" aria-label="Send message">send</button>
<button id="save" aria-label="Save settings">save</button>
<script>
window.sent = []; window.attached = [];
const box = document.getElementById('box');
function send() { const t = box.innerText.trim(); if (t) { window.sent.push(t); box.innerText = ''; } }
box.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
document.getElementById('send').addEventListener('click', send);
document.getElementById('file').addEventListener('change', (e) => {
  window.attached.push([...e.target.files].map((f) => f.name));
});
</script>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802
        data = PAGE.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802
        POSTS.append(self.path)
        self.send_response(204)
        self.end_headers()


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"  ok  {message}")


def wait_until(predicate, timeout: float = 10, message: str = "condition"):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(f"timed out waiting for {message}")


class ManagementServer:
    """The real server from server/, on a free port with its own data folder."""

    def __init__(self, data_dir: Path) -> None:
        env = {**os.environ, "PORT": "0", "HOST": "127.0.0.1", "KYRA_DATA_DIR": str(data_dir)}
        self.process = subprocess.Popen(["node", str(EXTENSION_DIR.parent / "server" / "server.js")], env=env,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
        self.url = re.search(r"http://\S+", self.process.stdout.readline()).group(0)
        self.process.stdout.readline()  # the data folder
        self.admin_key = self.process.stdout.readline().rsplit(" ", 1)[1].strip()

    def admin(self, method: str, path: str, body: dict | None = None) -> dict:
        request = Request(self.url + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                          headers={"Authorization": f"Bearer {self.admin_key}", "Content-Type": "application/json"})
        with urlopen(request, timeout=10) as response:  # noqa: S310 - a local test server
            return json.loads(response.read())

    def stop(self) -> None:
        self.process.terminate()
        self.process.wait(timeout=10)


def docx(text: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", f"<w:document><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>")
    return buffer.getvalue()


def shot(page, name: str) -> None:
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / name), full_page=True)


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    chat = f"http://chat.allow-ai.test:{port}/"
    requests: list[str] = []

    with tempfile.TemporaryDirectory() as profile, tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        files = Path(tmp)
        (files / "notes.txt").write_text("meeting notes, nothing sensitive", encoding="utf-8")
        (files / "cards.csv").write_text("name,card\nKim,4111 1111 1111 1111\n", encoding="utf-8")
        (files / "report.docx").write_bytes(docx("주민번호 900101-1234567"))
        (files / "phones.txt").write_text("call 010-1234-5678", encoding="utf-8")
        (files / "photo.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)

        # The browser's own "allow access to this site?" prompt cannot be pressed in a headless
        # browser, so this run uses a copy of the extension that has the test domains from the
        # install, as the known AI sites are. check_ungranted() below covers a site without access.
        extension = files / "extension"
        shutil.copytree(EXTENSION_DIR, extension)
        manifest = json.loads((extension / "manifest.json").read_text(encoding="utf-8"))
        manifest["host_permissions"].append("*://*.test/*")
        (extension / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

        context = p.chromium.launch_persistent_context(
            profile, channel="chromium", headless=True, locale="ko-KR", viewport={"width": 1100, "height": 900},
            args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}",
                  "--lang=ko", "--host-resolver-rules=MAP *.test 127.0.0.1"])
        context.on("request", lambda r: requests.append(r.url))
        try:
            sw = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
            origin = "chrome-extension://" + sw.url.split("/")[2]
            log = lambda: sw.evaluate("chrome.storage.local.get('activityLog').then(r => r.activityLog || [])")  # noqa: E731

            print("1. a new install: every known service allowed, checks on, settings page in Korean")
            options = context.new_page()
            options.goto(f"{origin}/options.html")
            options.wait_for_selector("#services tbody tr")
            check(options.locator("#services tbody tr").count() == 65, "the 65 known AI services are listed")
            check("이 브라우저에만 저장" in options.inner_text("body"), "the page says everything stays in this browser")
            check(sw.evaluate("chrome.declarativeNetRequest.getDynamicRules().then(r => r.length)") == 0, "nothing is blocked or warned yet")
            scripts = wait_until(lambda: sw.evaluate("chrome.scripting.getRegisteredContentScripts()"), message="page script")
            check("*://*.chatgpt.com/*" in scripts[0]["matches"], "the page script covers the known AI sites")

            print("2. own services: one allowed, one warned, one blocked")
            for name, domain, action in (("Allow AI", "allow-ai.test", "allow"), ("Warn AI", "warn-ai.test", "alert"),
                                         ("Block AI", "block-ai.test", "block")):
                options.fill("#service-name", name)
                options.fill("#service-domains", domain)
                options.select_option("#service-action", action)
                options.click("#service-form button[type=submit]")
                options.wait_for_selector(f"#services tbody tr:has-text('{domain}')")
            options.fill("#service-name", "Bad")
            options.fill("#service-domains", "not a domain")
            options.click("#service-form button[type=submit]")
            check(options.is_visible("#error"), "a service without a valid domain is refused")
            wait_until(lambda: sw.evaluate("chrome.declarativeNetRequest.getDynamicRules().then(r => r.length)") >= 3,
                       message="rules for the warned and blocked services")
            wait_until(lambda: "*://*.allow-ai.test/*" in sw.evaluate(
                "chrome.scripting.getRegisteredContentScripts().then(s => s[0].matches)"), message="page script for the new site")
            check("*://*.block-ai.test/*" not in sw.evaluate("chrome.scripting.getRegisteredContentScripts().then(s => s[0].matches)"),
                  "no page script on the blocked site")

            print("3. an own rule, and the try box")
            options.fill("#rule-name", "Slow")
            options.select_option("#rule-type", "regex")
            options.fill("#rule-pattern", "(a+)+$")
            options.click("#rule-form button[type=submit]")
            check("처리 시간" in options.inner_text("#error"), "a slow expression is refused")
            options.fill("#rule-name", "프로젝트 코드")
            options.select_option("#rule-type", "keyword")
            options.fill("#rule-pattern", "내부자료, apollo")
            options.select_option("#rule-action", "block")
            options.click("#rule-form button[type=submit]")
            options.wait_for_selector("#rules tbody tr:has-text('프로젝트 코드')")
            options.fill("#try-text", "apollo 계획은 내부자료이며 담당자 연락처는 010-1234-5678")
            wait_until(lambda: "차단 대상" in options.inner_text("#try-result"), message="try result")
            check(options.inner_text("#try-masked") == "[프로젝트 코드] 계획은 [프로젝트 코드]이며 담당자 연락처는 [휴대전화번호]",
                  "the try box shows what would be masked")
            shot(options, "free-options.png")

            page = context.new_page()
            page.goto(chat)
            sent = lambda: page.evaluate("window.sent")  # noqa: E731
            attached = lambda: page.evaluate("window.attached")  # noqa: E731
            box = page.locator("#box")
            notice = lambda: page.evaluate(  # noqa: E731 - the notice lives in a closed shadow root
                "[...document.documentElement.children].some(e => e.tagName === 'DIV' && !e.id && e !== document.body)")

            print("4. messages on the allowed site")
            wait_until(lambda: page.evaluate("!!document.getElementById('kyra-inspection-notice')"), message="notice that checks run")
            box.click(); page.keyboard.type("hello there"); page.keyboard.press("Enter")
            wait_until(lambda: sent() == ["hello there"], message="clean message sent")
            time.sleep(0.8)
            check(sent() == ["hello there"], "a clean message is sent exactly once")
            # A Save button that is not a send button: checked, but the draft is not sent with it.
            box.click(); page.keyboard.type("just a draft"); page.click("#save")
            time.sleep(1.0)
            check(sent() == ["hello there"] and page.evaluate("document.getElementById('box').innerText.trim()") == "just a draft",
                  "a draft stays put when another Save button is pressed")
            page.evaluate("document.getElementById('box').innerText = ''")

            box.click(); page.keyboard.type("my number is 900101-1234567"); page.keyboard.press("Enter")
            wait_until(notice, message="block notice")
            shot(page, "free-blocked-message.png")
            check(len(sent()) == 1, "a message with a resident number is not sent")
            page.keyboard.press("Escape")
            wait_until(lambda: not notice(), message="notice closed")
            page.evaluate("document.getElementById('box').innerText = ''")

            box.click(); page.keyboard.type("this is 내부자료를 포함"); page.click("#send")
            wait_until(notice, message="block notice for the own rule")
            check(len(sent()) == 1, "the own keyword rule blocks, with a particle attached, by the button too")
            page.keyboard.press("Escape")
            page.evaluate("document.getElementById('box').innerText = ''")

            box.click(); page.keyboard.type("call 010-1234-5678 today"); page.keyboard.press("Enter")
            wait_until(notice, message="warning")
            shot(page, "free-warned-message.png")
            check(len(sent()) == 1, "a warned message is held")
            page.keyboard.press("Shift+Tab")  # Edit (focused) -> Mask and send
            page.keyboard.press("Enter")
            wait_until(lambda: len(sent()) == 2, message="masked message sent")
            check(sent()[1] == "call [휴대전화번호] today", "Mask and send sends the masked text, not the original")

            box.click(); page.keyboard.type("fax 010-1234-5678"); page.keyboard.press("Enter")
            wait_until(notice, message="second warning")
            page.keyboard.press("Shift+Tab"); page.keyboard.press("Shift+Tab")  # -> Send anyway
            page.keyboard.press("Enter")
            wait_until(lambda: len(sent()) == 3, message="sent after the warning")
            check(sent()[2] == "fax 010-1234-5678", "Send anyway sends the original")
            time.sleep(0.5)
            check(len(sent()) == 3, "sent exactly once")

            # Past the first 100,000 characters: checked in pieces, so a key at the end is still found.
            filler = "lorem ipsum " * 9000
            page.evaluate("t => { const b = document.getElementById('box'); b.innerText = t; b.focus(); }", filler + "key sk-" + "A" * 30)
            page.keyboard.press("End"); page.keyboard.press("Enter")
            wait_until(notice, message="block notice for a long message")
            check(len(sent()) == 3, "a key after 100,000 characters of filler is found and not sent")
            page.keyboard.press("Escape")
            page.evaluate("t => { const b = document.getElementById('box'); b.innerText = t; b.focus(); }", filler + "end")
            page.keyboard.press("End"); page.keyboard.press("Enter")
            wait_until(lambda: len(sent()) == 4, message="long clean message sent")
            check(sent()[3].endswith("end") and len(sent()[3]) > 100000, "a long clean message is sent whole, once")

            print("5. files on the allowed site")
            page.set_input_files("#file", str(files / "notes.txt"))
            wait_until(lambda: attached() == [["notes.txt"]], message="clean file attached")
            page.set_input_files("#file", str(files / "cards.csv"))
            wait_until(notice, message="block notice for the file")
            check(len(attached()) == 1 and page.evaluate("document.getElementById('file').files.length") == 0,
                  "a file with a card number never reaches the page")
            page.keyboard.press("Escape")
            page.set_input_files("#file", str(files / "report.docx"))
            wait_until(notice, message="block notice for the Word document")
            check(len(attached()) == 1, "a resident number inside a Word document is found")
            page.keyboard.press("Escape")
            page.set_input_files("#file", str(files / "photo.png"))
            wait_until(notice, message="warning for the image")
            check(len(attached()) == 1, "an image (it cannot be read here) is held for a warning by default")
            page.keyboard.press("Shift+Tab"); page.keyboard.press("Enter")  # Cancel (focused) -> Attach anyway
            wait_until(lambda: len(attached()) == 2, message="image attached")
            check(attached()[1] == ["photo.png"], "attached after the warning")

            print("5b. a chat box in a frame, on a site that is not an AI service")
            host_page = context.new_page()
            host_page.goto(f"http://www.plain-site.test:{port}/")
            host_page.evaluate("src => { const f = document.createElement('iframe'); f.src = src; f.style.height = '400px';"
                               " document.body.append(f); }", chat)
            frame = wait_until(lambda: host_page.wait_for_timeout(100) or next((f for f in host_page.frames if f.url.startswith(chat)), None), timeout=30, message="the frame")
            frame.wait_for_selector("#box")
            wait_until(lambda: frame.evaluate("!!document.getElementById('kyra-inspection-notice') || document.readyState === 'complete'"),
                       message="frame loaded")
            time.sleep(0.5)
            frame.click("#box"); host_page.keyboard.type("my number is 900101-1234567"); host_page.keyboard.press("Enter")
            wait_until(lambda: frame.evaluate(
                "[...document.documentElement.children].some(e => e.tagName === 'DIV' && !e.id && e !== document.body)"),
                message="block notice in the frame")
            check(frame.evaluate("window.sent") == [], "a chat box in a frame is checked too (it was not before)")
            host_page.close()

            print("6. the warned and the blocked site")
            blocked = context.new_page()
            blocked.goto(f"http://www.block-ai.test:{port}/x")
            blocked.wait_for_selector("#body")
            check(blocked.url.startswith(f"{origin}/blocked.html") and "Block AI" in blocked.inner_text("body"),
                  "the blocked service shows the blocked page")
            shot(blocked, "free-blocked-site.png")
            blocked.close()
            warned = context.new_page()
            warned.goto(f"http://app.warn-ai.test:{port}/start")
            warned.wait_for_selector("#reason")
            check(warned.url.startswith(f"{origin}/warn.html"), "the warned service asks first")
            warned.fill("#reason", "공개 문서 확인")
            warned.click("#continue")
            warned.wait_for_url(f"http://app.warn-ai.test:{port}/start")
            check(True, "with a reason, the service opens")
            warned.close()
            # Another site cannot load the extension's pages by their fixed address (it could before:
            # to frame the warning page, fake log entries, or tell that the extension is installed).
            target = f"http://app.warn-ai.test:{port}/start"
            warn_url = f"{origin}/warn.html?service=custom-warn-ai-test&host=app.warn-ai.test&url={target}"
            add_frame = "src => { const f = document.createElement('iframe'); f.src = src; document.body.append(f); }"
            framing = context.new_page()
            framing.goto(f"http://www.plain-site.test:{port}/")
            framing.evaluate(add_frame, warn_url)
            framing.evaluate(add_frame, f"http://www.block-ai.test:{port}/x")
            framed_blocked = wait_until(lambda: framing.wait_for_timeout(100) or next(
                (f for f in framing.frames if f.url.startswith(f"{origin}/blocked.html")), None), timeout=30, message="blocked page in a frame")
            framed_blocked.wait_for_selector("#body", state="attached")  # the compact framed layout hides the paragraph
            wait_until(lambda: "Block AI" in (framed_blocked.text_content("#body") or ""), message="blocked page text in the frame")
            check(True, "a blocked service inside a frame still shows the blocked page")
            check(not any(f.url.startswith(f"{origin}/warn.html") and f.locator("#reason").count() for f in framing.frames),
                  "a site cannot open the warning page in a frame")
            framing.close()
            # Framed all the same (here by the extension's own page): it shows nothing, and its reports do not count.
            options.evaluate(add_frame, warn_url)
            framed = wait_until(lambda: options.wait_for_timeout(100) or next(
                (f for f in options.frames if f.url.startswith(f"{origin}/warn.html")), None), timeout=30, message="the framed warning page")
            framed.wait_for_load_state()
            options.wait_for_timeout(500)
            check(framed.evaluate("document.body.innerText.trim()") == "" and framed.locator("#reason").count() == 0,
                  "the warning page shows nothing inside a frame")
            answer = framed.evaluate("chrome.runtime.sendMessage({type: 'proceed', host: 'app.warn-ai.test', url: location.href, reason: 'x'})")
            check(answer.get("ok") is False, "and the worker takes no report from a framed page")
            options.evaluate("document.querySelectorAll('iframe').forEach(f => f.remove())")

            print("7. the activity log: what happened, never the text")
            entries = wait_until(lambda: (lambda e: e if len(e) >= 12 else None)(log()), message="log entries")
            actions = sorted({e["action"] for e in entries})
            check(actions == ["blocked", "file_blocked", "file_sent_after_warning", "file_warned", "proceeded", "prompt_blocked",
                              "prompt_sent_after_warning", "prompt_warned", "warned"], f"the log has each kind of event ({len(entries)} entries)")
            dumped = json.dumps(entries, ensure_ascii=False)
            check("1234567" not in dumped and "010-1234" not in dumped and "4111" not in dumped and "내부자료" not in dumped,
                  "no message or file text is in the log")
            check(any(e.get("fileName") == "cards.csv" and e["rules"] == ["Payment card number"] for e in entries),
                  "a file entry names the file and the rule")
            check(any(e["action"] == "proceeded" and e.get("reason") == "공개 문서 확인" for e in entries), "the reason is kept")
            options.bring_to_front()
            wait_until(lambda: options.locator("#log tbody tr").count() >= 9, message="log table")
            shown = options.locator("#log tbody").inner_text()
            check("카드번호" in shown and "Payment card number" not in shown,
                  "the log table shows built-in rule names in the browser's language")
            options.locator("#log").scroll_into_view_if_needed()
            shot(options, "free-log.png")
            with options.expect_download() as download:
                options.click("#log-export")
            csv = Path(download.value.path()).read_text(encoding="utf-8-sig")
            check(csv.startswith("time,action,service,site,rules,file,reason") and "cards.csv" in csv, "the log saves as CSV")

            print("8. the popup, and saving and loading the settings")
            popup = context.new_page()
            popup.goto(f"{origin}/popup.html")
            wait_until(lambda: popup.inner_text("#services") == "68", message="popup")
            check(popup.inner_text("#blocked-count") == "1" and popup.inner_text("#warned-count") == "1", "the popup counts the services")
            check(popup.inner_text("#checks") == "메시지 및 파일" and "차단" in popup.inner_text("#today"), "and shows checks and today's events")
            shot(popup, "free-popup.png")
            popup.close()
            with options.expect_download() as download:
                options.click("#settings-export")
            saved = json.loads(Path(download.value.path()).read_text(encoding="utf-8"))
            check(len(saved["customServices"]) == 3 and saved["customRules"][0]["pattern"] == "내부자료, apollo", "the settings save to a file")
            options.once("dialog", lambda d: d.accept())
            options.click("#settings-reset")
            wait_until(lambda: options.locator("#services tbody tr").count() == 65, message="reset")
            wait_until(lambda: sw.evaluate("chrome.declarativeNetRequest.getDynamicRules().then(r => r.length)") == 0, message="rules removed")
            saved_path = files / "settings.json"
            saved_path.write_text(json.dumps(saved), encoding="utf-8")
            options.set_input_files("#import-file", str(saved_path))
            wait_until(lambda: options.locator("#services tbody tr").count() == 68, message="import")
            wait_until(lambda: sw.evaluate("chrome.declarativeNetRequest.getDynamicRules().then(r => r.length)") >= 3, message="rules back")
            check(True, "reset removes them and loading the file brings them back")

            print("9. nothing left the browser")
            outside = sorted({urlparse(u).hostname for u in requests
                              if urlparse(u).scheme in ("http", "https") and not (urlparse(u).hostname or "").endswith(".test")})
            check(outside == [], f"every web request went to the test page only ({len(requests)} requests seen)")
            check(POSTS == [], "nothing was posted to the web server")

            print("10. the language: chosen in the settings instead of the browser's")
            options.bring_to_front()
            options.select_option("#language", "en")
            wait_until(lambda: options.locator("h2", has_text="AI services").count() == 1, message="the page in English")
            check(options.locator("#log thead").inner_text().startswith("Time"), "the settings page is shown in the chosen language")
            wait_until(lambda: "Payment card number" in options.locator("#log tbody").inner_text(), message="rule names in English")
            in_page = lambda key: sw.evaluate(  # noqa: E731 - what the page script on the AI site would show
                """async (key) => { const [tab] = await chrome.tabs.query({url: '*://chat.allow-ai.test/*'});
                const [r] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: (k) => chrome.i18n.getMessage(k), args: [key]});
                return r.result; }""", key)
            page.reload()
            wait_until(lambda: in_page("promptCategoryFinancial") == "Financial information", message="page script texts in English")
            check(True, "the notices on AI sites follow the choice")
            popup = context.new_page()
            popup.goto(f"{origin}/popup.html")
            wait_until(lambda: "AI services known" in popup.inner_text("body"), message="popup in English")
            popup.close()
            blocked = context.new_page()
            blocked.goto(f"http://www.block-ai.test:{port}/")
            blocked.wait_for_url(f"{origin}/blocked.html*")
            wait_until(lambda: "is blocked" in blocked.inner_text("body"), message="blocked page in English")
            check(True, "the popup and the blocked page too")
            blocked.close()
            options.bring_to_front()
            options.select_option("#language", "auto")
            wait_until(lambda: options.locator("h2", has_text="AI 서비스").count() >= 1, message="back to the browser's language")
            check(True, "and back to the browser's language")

            print("11. a management server: settings downloaded from it, nothing sent to it")
            managed = ManagementServer(files / "server-data")
            try:
                state = managed.admin("PUT", "api/admin/settings", {"refreshMinutes": 5, "settings": {
                    "organisation": "Server Corp", "services": {"deepseek": "block"},
                    "customServices": [{"name": "Server Blocked", "domains": ["srv-blocked.test"], "action": "block"}]}})
                options.fill("#server-url", managed.url)
                options.fill("#server-key", "not the key")
                options.click("#server-connect")
                wait_until(lambda: "등록 키" in options.inner_text("#server-status"), message="wrong key refused")
                check(not options.locator("#managed-banner").is_visible() and options.locator("#organisation").is_enabled(),
                      "a wrong enrolment key changes nothing")
                options.once("dialog", lambda d: d.accept())
                options.click("#server-disconnect")
                wait_until(lambda: options.locator("#server-connect").is_visible(), message="disconnected after the wrong key")
                options.fill("#server-url", managed.url)
                options.fill("#server-key", state["enrollmentKey"])
                options.fill("#server-label", "QA 노트북")
                options.click("#server-connect")
                wait_until(lambda: options.locator("#managed-banner").is_visible(), message="settings from the server")
                check(options.input_value("#organisation") == "Server Corp" and options.locator("#organisation").is_disabled()
                      and options.locator("#language").is_disabled() and not options.locator("#service-form").is_visible(),
                      "the server's settings are in force and cannot be changed in the browser")
                check(state["version"] in options.inner_text("#server-status") and managed.url in options.inner_text("#local-notice"),
                      "the page says where the settings come from")
                check(options.locator("#services tbody tr", has_text="allow-ai.test").count() == 0, "this browser's own services are set aside")
                blocked = context.new_page()
                blocked.goto(f"http://www.srv-blocked.test:{port}/")
                blocked.wait_for_url(f"{origin}/blocked.html*")
                check("Server Corp" in blocked.inner_text("body"), "a service blocked on the server is blocked here")
                blocked.close()
                options.locator("#server").scroll_into_view_if_needed()
                shot(options, "free-server.png")

                listed = wait_until(lambda: managed.admin("GET", "api/admin/browsers")["browsers"], message="the browser's check-in")
                mine = listed[0]
                check(len(listed) == 1 and mine["label"] == "QA 노트북" and mine["settingsVersion"] == state["version"]
                      and mine["extensionVersion"] == manifest["version"] and mine["checks"] == {"prompts": True, "files": True},
                      "the server lists this browser with its name, versions and checks")
                week = {key: sum(day[key] for day in mine["days"]) for key in ("blocked", "warned", "sentAfterWarning")}
                check(week["blocked"] >= 3 and week["warned"] >= 2 and week["sentAfterWarning"] >= 2, f"with counts for the week ({week})")
                reported = json.dumps(listed, ensure_ascii=False)
                check(not any(text in reported for text in ("allow-ai", "block-ai", "cards.csv", "카드", "Payment", "공개 문서", "127.0.0.1")),
                      "and no site, rule, file name, reason or network address")
                device = sw.evaluate("chrome.storage.local.get('serverDevice').then(r => r.serverDevice)")
                check(len(device.get("secret", "")) == 48 and "secretHash" not in mine and device["secret"] not in reported,
                      "the browser checks in with a secret of its own, which the admin list never shows")

                admin = context.new_page()
                admin.goto(managed.url)
                admin.fill("#admin-key", managed.admin_key)
                admin.click("#sign-in-form button")
                admin.wait_for_selector("#console:not([hidden])")
                check("Server Corp" in admin.inner_text("#summary") and state["enrollmentKey"] in admin.inner_text("#enrollment-key"),
                      "the admin page shows the settings in force and how to connect")
                admin.wait_for_selector("#browsers tbody tr")
                check("QA 노트북" in admin.inner_text("#browsers tbody") and "브라우저 1대" in admin.inner_text("#browsers-total"),
                      "and the connected browsers")
                document = json.loads(admin.input_value("#document"))
                document["organisation"] = "Server Corp 2"
                document["customRules"] = [{"name": "Slow", "type": "regex", "pattern": "(a+)+$", "action": "block"}]
                admin.fill("#document", json.dumps(document))
                admin.click("#save")
                wait_until(lambda: "제외" in admin.inner_text("#message"), message="saved with a note")
                check("Server Corp 2" in admin.inner_text("#summary"), "the admin page saves a changed document and says what it left out")
                shot(admin, "free-server-admin.png")
                admin.close()

                options.bring_to_front()
                options.click("#server-sync")
                wait_until(lambda: options.input_value("#organisation") == "Server Corp 2", message="the change downloaded")
                check(True, "a change on the server reaches the browser at the next download")
                managed.stop()
                options.click("#server-sync")
                wait_until(lambda: "연결할 수 없" in options.inner_text("#server-status"), message="server down")
                check(options.input_value("#organisation") == "Server Corp 2" and options.locator("#managed-banner").is_visible(),
                      "when the server cannot be reached, the settings held stay in force")
                options.once("dialog", lambda d: d.accept())
                options.click("#server-disconnect")
                wait_until(lambda: not options.locator("#managed-banner").is_visible(), message="disconnected")
                check(options.locator("#services tbody tr", has_text="allow-ai.test").count() == 1 and options.locator("#organisation").is_enabled(),
                      "after disconnecting, this browser's own settings are back")
                stored = sw.evaluate("chrome.storage.local.get(null).then(all => Object.keys(all))")
                check("serverSettings" not in stored and "server" not in stored and "serverDevice" not in stored,
                      "and nothing of the server is kept")
            finally:
                managed.stop()
        finally:
            context.close()
            server.shutdown()
    check_ungranted()
    print("ALL OK")
    return 0


def check_ungranted() -> None:
    """The extension as shipped: an own service on a site the browser has no access to."""
    print("12. as shipped: a site without access waits, and does not disturb the rest")
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory() as profile, sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            profile, channel="chromium", headless=True, locale="en-US",
            args=[f"--disable-extensions-except={EXTENSION_DIR}", f"--load-extension={EXTENSION_DIR}",
                  "--host-resolver-rules=MAP *.test 127.0.0.1"])
        try:
            sw = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
            origin = "chrome-extension://" + sw.url.split("/")[2]
            granted = sw.evaluate("chrome.permissions.getAll().then(p => p.origins)")
            check("*://*.chatgpt.com/*" in granted and not any("<all_urls>" in o or o == "*://*/*" for o in granted),
                  f"access at install is the known AI sites only ({len(granted)} patterns)")
            # Settings that arrive without a click (a loaded file, or pushed by an administrator).
            sw.evaluate("""chrome.storage.local.set({settings: {customServices: [
                {name: 'Block AI', domains: ['block-ai.test'], action: 'block'}]}})""")
            options = context.new_page()
            options.goto(f"{origin}/options.html")
            row = options.locator("#services tbody tr", has_text="block-ai.test")
            row.wait_for()
            check("Needs site access" in row.inner_text() and row.get_by_role("button", name="Grant access").count() == 1,
                  "the settings page marks the service and offers to give access")
            status = options.evaluate("chrome.runtime.sendMessage({type: 'status'})")
            check(status["pending"] == ["custom-block-ai-test"] and status["services"] == 65 and status["counts"]["block"] == 0,
                  "the worker leaves it out until access is given")
            scripts = sw.evaluate("chrome.scripting.getRegisteredContentScripts()")
            check(len(scripts) == 1 and "*://*.chatgpt.com/*" in scripts[0]["matches"], "checks on the known sites still work")
            page = context.new_page()
            page.goto(f"http://www.block-ai.test:{port}/")
            check(page.url.startswith("http://www.block-ai.test"), "the site is not blocked yet")
        finally:
            context.close()
            server.shutdown()


if __name__ == "__main__":
    sys.exit(main())
