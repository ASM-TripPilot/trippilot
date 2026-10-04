#!/usr/bin/env python3
"""약관·처리방침 시드 → 공개 정적 페이지(GitHub Pages).

## 왜 필요한가

App Store Connect 가 **공개 웹 URL 로 된 개인정보처리방침**을 필수로 요구한다. 그런데 우리
약관 6종은 앱 내 API(`GET /api/v1/terms`)로만 나가서 웹에 주소가 없었다.

## 왜 시드에서 생성하나

정본은 `R__seed_reference_data.sql` 의 `terms_version.body` 다 —
`backend/docs/legal/*.md` 는 **초안**이고 실제로 낡아 있다(초안은 `시행일: [미확정]`,
시드는 `2026-09-28`). 초안에서 뽑으면 공개 페이지가 앱 화면과 다른 말을 한다.

손으로 한 번 복사해 올리는 쪽이 더 간단하지만, 그러면 본문이 개정될 때 페이지가 **조용히
갈라진다** — 이 리포가 반복해서 다친 그 형태다. 생성 스크립트 + 시드 변경 트리거로 묶는다.

## 쓰는 법

    python3 backend/scripts/render_legal_pages.py --out public
    python3 backend/scripts/render_legal_pages.py --check   # 생성물이 최신인지만 확인(CI)

출력은 `index.html` + 종류별 `<slug>.html`. 의존성 없이 표준 라이브러리만 쓴다 —
이 스크립트 하나 때문에 마크다운 라이브러리를 들이지 않는다(필요한 문법이 좁다).
"""

from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "backend/app/src/main/resources/db/migration/R__seed_reference_data.sql"

# terms_type → (표시 이름, 파일 slug)
KINDS = {
    "PRIVACY_POLICY": ("개인정보 처리방침", "privacy"),
    "TERMS_OF_SERVICE": ("서비스 이용약관", "terms"),
    "LOCATION_TERMS": ("위치기반서비스 이용약관", "location"),
    "GPS_RECORDING": ("위치정보 기록 동의", "gps"),
    "MARKETING": ("광고성 정보 수신 동의", "marketing"),
    "PERSONALIZATION": ("기록 기반 개인화 동의", "personalization"),
}

# `('TYPE', '1.0', $body$…$body$, TIMESTAMPTZ '2026-01-01 00:00:00+00', false)` —
# 달러 인용이라 본문 안의
# 따옴표·개행을 신경 쓰지 않아도 된다. 이 형식이 깨지면 아래 건수 검사가 잡는다.
ENTRY = re.compile(
    r"\('(?P<type>[A-Z_]+)',\s*'(?P<version>[^']+)',\s*\$body\$(?P<body>.*?)\$body\$,\s*"
    r"(?:TIMESTAMPTZ\s*)?'(?P<effective>[^']*)'",
    re.S,
)


def parse_seed(text: str) -> list[dict]:
    found = [m.groupdict() for m in ENTRY.finditer(text)]
    missing = set(KINDS) - {item["type"] for item in found}
    if missing:
        raise SystemExit(f"시드에서 못 찾은 약관: {sorted(missing)} — 형식이 바뀌었는지 확인하라")
    return [item for item in found if item["type"] in KINDS]


def md_to_html(source: str) -> str:
    """필요한 문법만 — 제목·표·목록·강조·인용·수평선. 마크다운 전반을 구현하지 않는다."""
    out: list[str] = []
    rows: list[list[str]] = []
    bullets: list[str] = []

    def flush_table() -> None:
        if not rows:
            return
        head, *body = rows
        out.append("<table><thead><tr>" + "".join(f"<th>{c}</th>" for c in head) + "</tr></thead><tbody>")
        for row in body:
            out.append("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>")
        out.append("</tbody></table>")
        rows.clear()

    def flush_bullets() -> None:
        if not bullets:
            return
        out.append("<ul>" + "".join(f"<li>{item}</li>" for item in bullets) + "</ul>")
        bullets.clear()

    def inline(text: str) -> str:
        text = html.escape(text.strip())
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"`(.+?)`", r"<code>\1</code>", text)
        return text

    for raw in source.splitlines():
        line = raw.rstrip()
        if line.startswith("|"):
            cells = [inline(c) for c in line.strip("|").split("|")]
            # `|---|---|` 구분선은 버린다
            if all(set(c.replace("&gt;", "").strip()) <= {"-", ":"} for c in cells if c.strip()):
                continue
            flush_bullets()
            rows.append(cells)
            continue
        flush_table()
        if not line.strip():
            flush_bullets()
            continue
        if line.startswith("- "):
            bullets.append(inline(line[2:]))
            continue
        flush_bullets()
        if match := re.match(r"^(#{1,4})\s+(.*)$", line):
            level = len(match.group(1))
            out.append(f"<h{level}>{inline(match.group(2))}</h{level}>")
        elif line.startswith("> "):
            out.append(f"<blockquote>{inline(line[2:])}</blockquote>")
        elif set(line.strip()) <= {"-"} and len(line.strip()) >= 3:
            out.append("<hr>")
        else:
            out.append(f"<p>{inline(line)}</p>")
    flush_table()
    flush_bullets()
    return "\n".join(out)


STYLE = """:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0 auto;padding:2rem 1.25rem 4rem;max-width:46rem;
 font:16px/1.75 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;
 color:#1a1a1a;background:#fff}
@media (prefers-color-scheme:dark){body{color:#e6e6e6;background:#141414}
 a{color:#8ab4f8} th{background:#1f1f1f} td,th{border-color:#333} code{background:#222}}
h1{font-size:1.6rem;margin:0 0 .5rem}h2{font-size:1.2rem;margin:2rem 0 .5rem}
h3{font-size:1.05rem;margin:1.5rem 0 .4rem}
blockquote{margin:.5rem 0;padding:.4rem .9rem;border-left:3px solid #999;color:#666}
@media (prefers-color-scheme:dark){blockquote{color:#aaa}}
table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.92rem;display:block;overflow-x:auto}
td,th{border:1px solid #ddd;padding:.45rem .6rem;text-align:left;vertical-align:top}
th{background:#f4f4f4}
code{background:#f0f0f0;padding:.1rem .3rem;border-radius:3px;font-size:.9em}
nav{margin:1.5rem 0 2.5rem;padding:1rem 1.25rem;border:1px solid #ddd;border-radius:8px}
@media (prefers-color-scheme:dark){nav{border-color:#333}}
nav ul{margin:.5rem 0 0;padding-left:1.2rem}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #ddd;font-size:.85rem;color:#666}
@media (prefers-color-scheme:dark){footer{border-color:#333;color:#999}}"""


def page(title: str, body: str, back: bool) -> str:
    nav = '<p><a href="./">← 전체 목록</a></p>' if back else ""
    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} · TripPilot</title>
<style>{STYLE}</style></head><body>
{nav}
{body}
<footer>TripPilot · 트립파일럿 · 이 페이지는 앱이 보여 주는 본문과 같은 정본에서 생성됩니다.</footer>
</body></html>
"""


def render(entries: list[dict]) -> dict[str, str]:
    files: dict[str, str] = {}
    order = [t for t in KINDS if any(e["type"] == t for e in entries)]
    links = []
    for kind in order:
        entry = next(e for e in entries if e["type"] == kind)
        label, slug = KINDS[kind]
        files[f"{slug}.html"] = page(label, md_to_html(entry["body"]), back=True)
        links.append(
            f'<li><a href="{slug}.html">{html.escape(label)}</a>'
            f' <small>v{html.escape(entry["version"])} · 시행 {html.escape(entry["effective"][:10])}</small></li>'
        )
    index = (
        "<h1>TripPilot 약관 및 방침</h1>"
        "<p>아래 문서는 앱 안에서 보여 주는 본문과 **같은 정본**에서 생성됩니다.</p>"
        f"<nav><strong>문서</strong><ul>{''.join(links)}</ul></nav>"
    ).replace("**같은 정본**", "<strong>같은 정본</strong>")
    files["index.html"] = page("약관 및 방침", index, back=False)
    return files


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="public", help="출력 디렉토리(리포 상대)")
    parser.add_argument("--check", action="store_true", help="생성물이 최신인지만 확인한다(쓰지 않음)")
    args = parser.parse_args(argv)

    entries = parse_seed(SEED.read_text(encoding="utf-8"))
    files = render(entries)
    out = ROOT / args.out

    if args.check:
        stale = [
            name for name, content in files.items()
            if not (out / name).exists() or (out / name).read_text(encoding="utf-8") != content
        ]
        if stale:
            print(f"생성물이 낡았다: {stale}\n  python3 backend/scripts/render_legal_pages.py --out {args.out}",
                  file=sys.stderr)
            return 1
        print(f"최신이다 — {len(files)}개 파일")
        return 0

    out.mkdir(parents=True, exist_ok=True)
    # Jekyll 이 `_` 로 시작하는 경로를 삼키지 않게 — 지금은 없지만 선례를 막아 둔다.
    (out / ".nojekyll").write_text("", encoding="utf-8")
    for name, content in files.items():
        (out / name).write_text(content, encoding="utf-8")
    print(f"{out} 에 {len(files)}개 생성 — " + ", ".join(sorted(files)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
