"""Makes the images of the user guide, in English and Korean.

    python scripts/guide_screenshots.py

Writes to docs/images/{en,ko}/. The chat page is a stand-in served from
this machine and the management server is the one in server/, started on a free port with a
temporary data folder; no AI service is contacted. Uses its own temporary browser profile and
never connects to an existing Chrome.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXTENSION_DIR = ROOT / "extension"
OUT = ROOT / "docs" / "images"

CHAT = """<!doctype html><meta charset="utf-8"><title>__TITLE__</title>
<style>
  body { margin: 0; font: 15px/1.5 "Segoe UI", "Malgun Gothic", system-ui, sans-serif; background: #f7f7f8; color: #1a1f2b; }
  header { padding: 14px 24px; border-bottom: 1px solid #e3e5ea; background: #fff; font-weight: 600; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 24px 0; }
  .bubble { background: #fff; border: 1px solid #e3e5ea; border-radius: 12px; padding: 12px 16px; margin: 0 0 14px; max-width: 80%; }
  .me { margin-left: auto; background: #e8edf8; border-color: #d3dcf2; }
  .composer { position: fixed; left: 0; right: 0; bottom: 28px; }
  .composer div.wrap { max-width: 760px; margin: 0 auto; display: flex; gap: 10px; padding: 0 24px; }
  #box { flex: 1; min-height: 48px; background: #fff; border: 1px solid #c9ced8; border-radius: 12px; padding: 12px 16px; outline: none; }
  button { border: 0; border-radius: 12px; padding: 0 20px; background: #1a1f2b; color: #fff; font: inherit; }
</style>
<header>__TITLE__</header>
<main>
  <p class="bubble me">__Q__</p>
  <p class="bubble">__A__</p>
</main>
<div class="composer"><div class="wrap">
  <input id="file" type="file" style="display:none">
  <div id="box" contenteditable="true"></div><button id="send" aria-label="Send message">__SEND__</button>
</div></div>
<script>
  const box = document.getElementById('box');
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); box.innerText = ''; } });
  document.getElementById('send').addEventListener('click', () => { box.innerText = ''; });
</script>"""

TEXT = {
    "en": {
        "locale": "en-US", "title": "AI chat (demo page)", "send": "Send",
        "q": "Can you tidy up this customer note for me?", "a": "Of course. Paste the note and tell me the tone you want.",
        "warn": "Please call Ms. Kim back on 010-1234-5678 about the renewal.",
        "block": "Customer Kim Minsu, resident number 900101-1234567, asked for a refund.",
        "file": ("customers.txt", "Hong Gildong 900101-1234567\nKim Younghee 010-2345-6789\n"),
        "service": "Internal AI portal", "rule": "Project names", "keywords": "apollo, confidential",
        "try": "Contact 010-1234-5678, card 4111 1111 1111 1111, apollo schedule", "reason": "Reviewing a draft of marketing copy",
        "browser": "Sales team, PC-07",
    },
    "ko": {
        "locale": "ko-KR", "title": "AI 대화 (시연 페이지)", "send": "보내기",
        "q": "이 고객 메모를 정리해 줄 수 있나요?", "a": "네. 메모를 붙여 넣고 원하는 어조를 알려 주세요.",
        "warn": "김 과장님께 010-1234-5678 번호로 갱신 건 회신 부탁드립니다.",
        "block": "고객 김민수, 주민등록번호 900101-1234567, 환불 요청 건입니다.",
        "file": ("고객명단.txt", "홍길동 900101-1234567\n김영희 010-2345-6789\n"),
        "service": "사내 AI 포털", "rule": "프로젝트 이름", "keywords": "apollo, 대외비",
        "try": "담당자 010-1234-5678, 카드 4111 1111 1111 1111, apollo 일정", "reason": "마케팅 문구 초안 검토",
        "browser": "영업팀 PC-07",
    },
}

NOTICE = "[...document.documentElement.children].some(e => e.tagName === 'DIV' && !e.id && e !== document.body)"
STATE = {"page": ""}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802
        data = STATE["page"].encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ManagementServer:
    """The server from server/, on a free port with its own data folder."""

    def __init__(self, data_dir: Path) -> None:
        env = {**os.environ, "PORT": "0", "HOST": "127.0.0.1", "KYRA_DATA_DIR": str(data_dir)}
        self.process = subprocess.Popen(["node", str(ROOT / "server" / "server.js")], env=env,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
        self.url = re.search(r"http://\S+", self.process.stdout.readline()).group(0)
        self.process.stdout.readline()  # the data folder
        self.admin_key = self.process.stdout.readline().rsplit(" ", 1)[1].strip()

    def admin(self, method: str, path: str, body: dict | None = None) -> dict:
        request = Request(self.url + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                          headers={"Authorization": f"Bearer {self.admin_key}", "Content-Type": "application/json"})
        with urlopen(request, timeout=10) as response:  # noqa: S310 - a local server started above
            return json.loads(response.read())

    def stop(self) -> None:
        self.process.terminate()
        self.process.wait(timeout=10)


def wait_until(predicate, timeout: float = 10, message: str = "condition"):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(f"timed out waiting for {message}")


def section_shot(options, selector: str, path: Path) -> None:
    section = options.locator(selector)
    section.scroll_into_view_if_needed()
    options.wait_for_timeout(200)
    section.screenshot(path=str(path))


def capture(p, lang: str, port: int) -> None:
    text = TEXT[lang]
    STATE["page"] = (CHAT.replace("__TITLE__", text["title"]).replace("__SEND__", text["send"])
                     .replace("__Q__", text["q"]).replace("__A__", text["a"]))
    out = OUT / lang
    out.mkdir(parents=True, exist_ok=True)
    settings = {
        "organisation": "Acme", "services": {"deepseek": "block", "character-ai": "alert"},
        "customServices": [{"name": text["service"], "domains": ["demo-ai.test"], "action": "allow"}],
        "customRules": [{"id": "custom-1", "name": text["rule"], "type": "keyword", "pattern": text["keywords"], "action": "block"}],
    }
    with tempfile.TemporaryDirectory() as profile, tempfile.TemporaryDirectory() as tmp:
        # The demo domains are given at install here, as the known AI sites are
        # in the real package (a headless browser cannot press the browser's own permission prompt).
        extension = Path(tmp) / "extension"
        shutil.copytree(EXTENSION_DIR, extension)
        manifest = json.loads((extension / "manifest.json").read_text(encoding="utf-8"))
        manifest["host_permissions"].append("*://*.test/*")
        (extension / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

        context = p.chromium.launch_persistent_context(
            profile, channel="chromium", headless=True, locale=text["locale"], viewport={"width": 1180, "height": 760},
            args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}",
                  f"--lang={lang}", "--host-resolver-rules=MAP *.test 127.0.0.1"])
        managed = ManagementServer(Path(tmp) / "server-data")
        try:
            sw = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
            origin = "chrome-extension://" + sw.url.split("/")[2]
            first = context.new_page()
            first.goto(f"{origin}/options.html")
            first.wait_for_selector("#services tbody tr")
            first.screenshot(path=str(out / "01-first-run.png"))
            first.close()

            sw.evaluate("s => chrome.storage.local.set({settings: s, inspectionNoticeAt: Date.now()})", settings)
            wait_until(lambda: "*://*.demo-ai.test/*" in sw.evaluate(
                "chrome.scripting.getRegisteredContentScripts().then(s => s[0] ? s[0].matches : [])"), message="page script")

            page = context.new_page()
            page.goto(f"http://chat.demo-ai.test:{port}/")
            notice = lambda: page.evaluate(NOTICE)  # noqa: E731 - the dialog lives in a closed shadow root
            box = page.locator("#box")
            for name, key in (("02-warning.png", "warn"), ("03-blocked-message.png", "block")):
                box.click()
                page.keyboard.insert_text(text[key])
                page.keyboard.press("Enter")
                wait_until(notice, message=name)
                page.wait_for_timeout(300)
                page.screenshot(path=str(out / name))
                page.keyboard.press("Escape")
                wait_until(lambda: not notice(), message="dialog closed")
                page.evaluate("document.getElementById('box').innerText = ''")
            page.set_input_files("#file", files=[{"name": text["file"][0], "mimeType": "text/plain", "buffer": text["file"][1].encode()}])
            wait_until(notice, message="file")
            page.wait_for_timeout(300)
            page.screenshot(path=str(out / "04-file.png"))
            page.keyboard.press("Escape")

            blocked = context.new_page()
            blocked.goto("http://chat.deepseek.com/")
            blocked.wait_for_selector("#body")
            blocked.wait_for_timeout(300)
            blocked.screenshot(path=str(out / "05-blocked-service.png"))
            blocked.close()
            warned = context.new_page()
            warned.goto("http://character.ai/")
            warned.wait_for_selector("#reason")
            warned.fill("#reason", text["reason"])
            warned.wait_for_timeout(300)
            warned.screenshot(path=str(out / "06-warn-service.png"))
            warned.close()

            options = context.new_page()
            options.goto(f"{origin}/options.html")
            options.wait_for_selector("#rules tbody tr")
            options.fill("#try-text", text["try"])
            options.wait_for_selector("#log tbody tr")
            sections = options.locator(".options section")
            names = ["07-general.png", "08-services.png", "10-checks.png", "11-data-rules.png",
                     "12-activity-log.png", "13-server-not-connected.png", "14-backup.png"]
            assert sections.count() == len(names), sections.count()
            for index, name in enumerate(names):
                section = sections.nth(index)
                section.scroll_into_view_if_needed()
                options.wait_for_timeout(200)
                section.screenshot(path=str(out / name))

            popup = context.new_page()
            popup.set_viewport_size({"width": 380, "height": 520})
            popup.goto(f"{origin}/popup.html")
            popup.wait_for_timeout(600)
            popup.screenshot(path=str(out / "15-popup.png"))
            popup.close()

            state = managed.admin("PUT", "api/admin/settings", {"settings": {**settings, "organisation": "Acme (server)"}})
            options.fill("#server-url", managed.url)
            options.fill("#server-key", state["enrollmentKey"])
            options.fill("#server-label", text["browser"])
            options.click("#server-connect")
            options.wait_for_selector("#managed-banner:not([hidden])")
            wait_until(lambda: managed.admin("GET", "api/admin/browsers")["browsers"], message="check-in")

            admin = context.new_page()
            admin.goto(managed.url)
            admin.screenshot(path=str(out / "16-server-sign-in.png"), clip={"x": 0, "y": 0, "width": 1180, "height": 330})
            admin.fill("#admin-key", managed.admin_key)
            admin.click("#sign-in-form button")
            admin.wait_for_selector("#browsers tbody tr")
            # The keys of this throwaway server are not worth showing; the picture carries stand-ins.
            admin.evaluate("""() => { document.getElementById('enrollment-key').textContent = 'k3Yq…(enrollment key)';
                document.getElementById('address').textContent = 'https://guardrail.example.com/'; }""")
            admin.screenshot(path=str(out / "17-server-admin.png"), full_page=True)
            admin.close()
            options.bring_to_front()
            options.evaluate("""() => { const shown = 'https://guardrail.example.com/';
                document.getElementById('server-url').value = shown;
                const notice = document.getElementById('local-notice');
                notice.textContent = notice.textContent.replace(/http:\\/\\/127\\.0\\.0\\.1:\\d+\\//, shown); }""")
            options.evaluate("window.scrollTo(0, 0)")
            options.wait_for_timeout(200)
            options.screenshot(path=str(out / "18-server-connected-top.png"), clip={"x": 0, "y": 0, "width": 1180, "height": 420})
            section_shot(options, "#server", out / "19-server-connected.png")
        finally:
            managed.stop()
            context.close()
    print(lang, len(list(out.iterdir())), "images")


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            for lang in TEXT:
                capture(p, lang, server.server_address[1])
    finally:
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
