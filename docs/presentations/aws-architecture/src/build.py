#!/usr/bin/env python3
"""TripPilot 인프라 자료 빌드.

    python3 src/build.py diagram   # src/aws-architecture.html → aws-architecture.png(2배) + assets/img/aws-architecture.webp
    python3 src/build.py decks     # src/{students,report}.html → 최상위 단일 HTML(CSS·JS·이미지 인라인)
    python3 src/build.py qa        # 슬라이드 넘침 검사 + 슬라이드별 스크린샷(/tmp/deck-shots)
    python3 src/build.py pdf       # 단일 HTML → PDF(한 슬라이드 = 한 쪽)
    python3 src/build.py           # 위 전부

헤드리스 Chrome(macOS 기본 경로)과 cwebp 가 필요하다. 폰트는 CDN(Pretendard·IBM Plex Mono)에서 받는다.
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SHOTS = Path("/tmp/deck-shots")
DECKS = {
    "students": "01-infra-intro-students.html",
    "report": "02-infra-strengths-report.html",
}
MIME = {".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg"}


def chrome(*args: str, timeout: int = 120) -> str:
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", *args]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"Chrome 실패({result.returncode}): {result.stderr[-500:]}")
    return result.stdout


def build_diagram() -> None:
    png = ROOT / "aws-architecture.png"
    chrome("--force-device-scale-factor=2", "--window-size=2100,1260", "--virtual-time-budget=6000",
           f"--screenshot={png}", (SRC / "aws-architecture.html").as_uri())
    webp = ROOT / "assets/img/aws-architecture.webp"
    subprocess.run(["cwebp", "-quiet", "-q", "88", str(png), "-o", str(webp)], check=True)
    print(f"diagram: {png.name} · {webp.relative_to(ROOT)}")


def data_uri(ref: str) -> str:
    path = (SRC / ref).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"참조한 파일이 없다: {ref}")
    return f"data:{MIME[path.suffix]};base64,{base64.b64encode(path.read_bytes()).decode()}"


def bundle(name: str) -> Path:
    html = (SRC / f"{name}.html").read_text(encoding="utf-8")
    css = (SRC / "deck.css").read_text(encoding="utf-8")
    js = (SRC / "deck.js").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="deck.css">', f"<style>\n{css}</style>")
    html = html.replace('<script src="deck.js"></script>', f"<script>\n{js}</script>")
    html = re.sub(r'(src|data-zoom)="(\.\./[^"]+)"', lambda m: f'{m.group(1)}="{data_uri(m.group(2))}"', html)
    out = ROOT / DECKS[name]
    out.write_text(html, encoding="utf-8")
    print(f"deck: {out.name} ({out.stat().st_size / 1024 / 1024:.1f} MB)")
    return out


def qa(name: str) -> list[dict]:
    src = SRC / f"{name}.html"
    dom = chrome("--window-size=1920,1080", "--virtual-time-budget=5000", "--dump-dom", f"{src.as_uri()}?qa")
    match = re.search(r'data-qa="([^"]*)"', dom)
    if not match:
        raise RuntimeError(f"{name}: QA 결과를 읽지 못했다(폰트 로딩 실패?)")
    issues = json.loads(match.group(1).replace("&quot;", '"'))
    count = len(re.findall(r'<section class="slide', dom))
    SHOTS.mkdir(exist_ok=True)
    for i in range(1, count + 1):
        chrome("--window-size=1920,1080", "--virtual-time-budget=6500",
               f"--screenshot={SHOTS / f'{name}-{i:02d}.png'}", f"{src.as_uri()}#{i}")
    print(f"qa {name}: 슬라이드 {count}장 · 문제 {len(issues)}건 · 스크린샷 {SHOTS}")
    for issue in issues:
        print("   ", issue)
    return issues


def pdf(name: str) -> None:
    deck = ROOT / DECKS[name]
    out = deck.with_suffix(".pdf")
    chrome("--virtual-time-budget=6000", "--no-pdf-header-footer", f"--print-to-pdf={out}", deck.as_uri())
    print(f"pdf: {out.name}")


def main(step: str = "all") -> int:
    if step in ("diagram", "all"):
        build_diagram()
    if step in ("decks", "all"):
        for name in DECKS:
            if (SRC / f"{name}.html").exists():
                bundle(name)
    issues: list[dict] = []
    if step in ("qa", "all"):
        for name in DECKS:
            if (SRC / f"{name}.html").exists():
                issues += qa(name)
    if step in ("pdf", "all"):
        for name in DECKS:
            if (ROOT / DECKS[name]).exists():
                pdf(name)
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:2]))
