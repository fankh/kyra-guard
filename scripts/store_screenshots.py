"""Makes the store listing images: five 1280x800 screenshots per language and a 440x280 tile.

    python scripts/store_screenshots.py

Writes to store/screenshots/{en,ko}/ and store/promo-440x280.png.
The chat page is a stand-in served from this machine; no AI service is contacted. Uses its
own temporary browser profile and never connects to an existing Chrome.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXTENSION_DIR = ROOT / "extension"
OUT = ROOT / "store"

CHAT = """<!doctype html><meta charset="utf-8"><title>AI chat (demo page)</title>
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
<header>AI chat (demo page)</header>
<main>
  <p class="bubble me">__Q__</p>
  <p class="bubble">__A__</p>
</main>
<div class="composer"><div class="wrap">
  <div id="box" contenteditable="true"></div><button id="send" aria-label="Send message">Send</button>
</div></div>
<script>
  const box = document.getElementById('box');
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); box.innerText = ''; } });
  document.getElementById('send').addEventListener('click', () => { box.innerText = ''; });
</script>"""

TEXT = {
    "en": {
        "locale": "en-US", "lang": "en", "q": "Can you tidy up this customer note for me?",
        "a": "Of course. Paste the note and tell me the tone you want.",
        "warn": "Please call Ms. Kim back on 010-1234-5678 about the renewal.",
        "block": "Customer Kim Minsu, resident number 900101-1234567, asked for a refund.",
        "org": "Acme", "rule": "Project names", "keywords": "apollo, confidential",
        "tagline": "Keep personal data and keys out of AI chats", "sub": "Checked in your browser. Nothing is sent anywhere.",
    },
    "ko": {
        "locale": "ko-KR", "lang": "ko", "q": "이 고객 메모를 정리해 줄 수 있나요?",
        "a": "네. 메모를 붙여 넣고 원하는 어조를 알려 주세요.",
        "warn": "김 과장님께 010-1234-5678 번호로 갱신 건 회신 부탁드립니다.",
        "block": "고객 김민수, 주민등록번호 900101-1234567, 환불 요청 건입니다.",
        "org": "Acme", "rule": "프로젝트 이름", "keywords": "apollo, 대외비",
        "tagline": "AI 대화에 개인정보와 키가 들어가지 않도록", "sub": "브라우저 안에서 검사. 외부 전송 없음.",
    },
}

TILE = """<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; width: 440px; height: 280px; }
  body { background: #0b2a6f; color: #fff; font-family: "Segoe UI", system-ui, sans-serif; display: flex; flex-direction: column;
         justify-content: center; padding: 0 36px; box-sizing: border-box; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 21px; font-weight: 700; }
  .brand img { width: 44px; height: 44px; background: #fff; border-radius: 10px; padding: 4px; }
  h1 { font-size: 25px; line-height: 1.25; margin: 22px 0 10px; font-weight: 700; }
  p { margin: 0; font-size: 14px; opacity: .85; }
</style>
<div class="brand"><img src="__ICON__" alt="">KYRA AI Guardrail Free</div>
<h1>Keep personal data and keys out of AI chats</h1>
<p>Checked in your browser. Nothing is sent anywhere.</p>"""

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


def wait_until(predicate, timeout: float = 10, message: str = "condition"):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(f"timed out waiting for {message}")


def capture(p, lang: str, port: int) -> None:
    text = TEXT[lang]
    STATE["page"] = CHAT.replace("__Q__", text["q"]).replace("__A__", text["a"])
    out = OUT / "screenshots" / lang
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as profile, tempfile.TemporaryDirectory() as tmp:
        # The demo page's domain is given at install here, as the known AI sites are in the
        # real package (a headless browser cannot press the browser's own permission prompt).
        extension = Path(tmp) / "extension"
        shutil.copytree(EXTENSION_DIR, extension)
        manifest = json.loads((extension / "manifest.json").read_text(encoding="utf-8"))
        manifest["host_permissions"].append("*://*.test/*")
        (extension / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

        context = p.chromium.launch_persistent_context(
            profile, channel="chromium", headless=True, locale=text["locale"], viewport={"width": 1280, "height": 800},
            args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}",
                  f"--lang={text['lang']}", "--host-resolver-rules=MAP *.test 127.0.0.1"])
        try:
            sw = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
            origin = "chrome-extension://" + sw.url.split("/")[2]
            sw.evaluate("s => chrome.storage.local.set({settings: s, inspectionNoticeAt: Date.now()})", {
                "organisation": text["org"], "services": {"deepseek": "block", "character-ai": "alert"},
                "customServices": [{"name": "AI chat (demo page)", "domains": ["demo-ai.test"], "action": "allow"}],
                "customRules": [{"id": "custom-1", "name": text["rule"], "type": "keyword", "pattern": text["keywords"], "action": "block"}],
            })
            wait_until(lambda: "*://*.demo-ai.test/*" in (sw.evaluate(
                "chrome.scripting.getRegisteredContentScripts().then(s => s[0] ? s[0].matches : [])")), message="page script")

            page = context.new_page()
            page.goto(f"http://chat.demo-ai.test:{port}/")
            notice = lambda: page.evaluate(  # noqa: E731 - the dialog lives in a closed shadow root
                "[...document.documentElement.children].some(e => e.tagName === 'DIV' && !e.id && e !== document.body)")
            box = page.locator("#box")
            for name, key in (("1-warning.png", "warn"), ("2-blocked-message.png", "block")):
                box.click(); page.keyboard.insert_text(text[key]); page.keyboard.press("Enter")
                wait_until(notice, message=name)
                page.wait_for_timeout(300)
                page.screenshot(path=str(out / name))
                page.keyboard.press("Escape")
                wait_until(lambda: not notice(), message="dialog closed")
                page.evaluate("document.getElementById('box').innerText = ''")

            blocked = context.new_page()
            blocked.goto("http://chat.deepseek.com/")
            blocked.wait_for_selector("#body")
            blocked.wait_for_timeout(300)
            blocked.screenshot(path=str(out / "3-blocked-service.png"))
            blocked.close()
            warned = context.new_page()
            warned.goto("http://character.ai/")
            warned.wait_for_selector("#reason")
            warned.close()

            options = context.new_page()
            options.goto(f"{origin}/options.html")
            options.wait_for_selector("#rules tbody tr")
            options.locator("#rules").evaluate("e => e.closest('section').scrollIntoView()")
            options.wait_for_timeout(300)
            options.screenshot(path=str(out / "4-data-rules.png"))
            options.wait_for_selector("#log tbody tr")
            options.locator("#log").evaluate("e => e.closest('section').scrollIntoView({block: 'center'})")
            options.wait_for_timeout(300)
            options.screenshot(path=str(out / "5-activity-log.png"))
        finally:
            context.close()
    print(lang, sorted(f.name for f in out.iterdir()))


def tile(p) -> None:
    browser = p.chromium.launch(headless=True)
    try:
        page = browser.new_page(viewport={"width": 440, "height": 280})
        page.set_content(TILE.replace("__ICON__", (EXTENSION_DIR / "icons" / "icon128.png").as_uri()))
        # set_content pages cannot read file: images, so the icon is put in as data.
        import base64
        data = base64.b64encode((EXTENSION_DIR / "icons" / "icon128.png").read_bytes()).decode()
        page.evaluate("d => { document.querySelector('img').src = 'data:image/png;base64,' + d; }", data)
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / "promo-440x280.png"))
    finally:
        browser.close()
    print("promo tile written")


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            for lang in ("en", "ko"):
                capture(p, lang, server.server_address[1])
            tile(p)
    finally:
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
