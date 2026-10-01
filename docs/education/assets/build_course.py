"""Generate the two offline TripPilot lessons from matching chapter sources."""

import argparse
import base64
import html
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

from course_content import CHAPTERS

HERE = Path(__file__).resolve().parent
COURSE = "terraform-actions-aws-course.html"
PRESENTATION = "terraform-actions-aws-course-ppt.html"
LINKS = (
    f'<a href="{COURSE}">AWS 상세 강의</a> · '
    f'<a href="{PRESENTATION}">AWS 발표</a> · '
    '<a href="k8s-observability-class.html">로컬 Kubernetes·관측성</a>'
)


def controls():
    return '''<nav class="controls" aria-label="발표 탐색">
<button id="previous-slide" type="button" aria-label="이전 슬라이드">← 이전</button>
<button id="next-slide" type="button" aria-label="다음 슬라이드">다음 →</button>
<label for="slide-select">이동</label><select id="slide-select"></select><span id="slide-count"></span>
<progress id="slide-progress" aria-label="진행률"></progress>
<button id="toggle-overview" type="button" aria-controls="overview">목차</button>
<button id="toggle-notes" type="button" aria-pressed="false">강사 노트</button>
<button id="toggle-reading" type="button" aria-pressed="false">읽기</button>
<button id="toggle-fullscreen" type="button" aria-pressed="false">전체 화면</button>
<button id="print-slides" type="button">인쇄</button></nav>
<dialog id="overview" aria-labelledby="overview-title"><h2 id="overview-title">목차</h2>
<button id="close-overview" type="button">닫기</button><ol id="overview-list"></ol></dialog>'''


def embed_images(body, root):
    """Keep existing SVG evidence intact while removing runtime asset fetches."""
    def replace(match):
        path = root / "docs/education" / match[1]
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        return f'src="data:image/svg+xml;base64,{encoded}"'

    return re.sub(r'src="(assets/[^"<>]+\.svg)"', replace, body)


def presentation_visual(chapter, body):
    if chapter["id"] == "aws-overview":
        return re.search(r"<figure\b.*?</figure>", body, re.DOTALL)[0]
    if chapter["id"] == "terraform-environments":
        return '''<table><caption>환경별 가용성·데이터 보호</caption>
<thead><tr><th scope="col">설정</th><th scope="col">DEV</th><th scope="col">PRD</th></tr></thead>
<tbody><tr><th scope="row">AZ / NAT</th><td>2 / 1</td><td>3 / 3</td></tr>
<tr><th scope="row">RDS / 백업</th><td>Single-AZ / 1일</td><td>Multi-AZ / 14일</td></tr>
<tr><th scope="row">Redis</th><td>1노드</td><td>3노드 · 자동 장애 조치</td></tr>
<tr><th scope="row">EKS·RDS 삭제 보호</th><td>꺼짐</td><td>켜짐</td></tr></tbody></table>'''
    flows = {
        "request-path": ("모바일 앱", "NLB · nginx", "backend · AI", "PostgreSQL"),
        "actions-security": ("GitHub 신원 토큰", "STS 임시 자격 증명", "환경별 IAM 역할"),
        "actions-deploy": ("검증 · plan", "Docker · ECR", "Secret · DB", "Helm · smoke"),
    }
    if chapter["id"] not in flows:
        return ""
    nodes = '<span class="arrow" aria-hidden="true">→</span>'.join(
        f'<span class="node">{html.escape(label)}</span>'
        for label in flows[chapter["id"]]
    )
    return f'<div class="flow-figure"><div class="flow">{nodes}</div></div>'


def section(chapter, index, presentation, root):
    anchor = html.escape(chapter["id"], quote=True)
    body = embed_images((HERE / "chapters" / f"{anchor}.html").read_text(), root)
    visual = presentation_visual(chapter, body) if presentation else ""
    if presentation:
        items = "".join(f"<li>{html.escape(line)}</li>" for line in chapter["summary"])
        body = f'<ul class="summary">{items}</ul>'
    aliases = "".join(
        f'<span id="{alias}" class="anchor-alias" aria-hidden="true"></span>'
        for alias in chapter["aliases"]
    )
    source = html.escape(chapter["source"], quote=True)
    cross_link = (
        f'<a href="{COURSE}#{anchor}">이 장의 상세 설명·실습</a>' if presentation
        else f'<a href="{PRESENTATION}#{anchor}">이 장의 발표 요약</a>'
    )
    aliases_attribute = html.escape(" ".join(chapter["aliases"]), quote=True)
    return f'''<section class="slide" id="{anchor}" data-aliases="{aliases_attribute}" aria-labelledby="{anchor}-title">
{aliases}<div class="eyebrow">TRIPPILOT / {index:02d}</div>
<h2 id="{anchor}-title">{html.escape(chapter["title"])}</h2>
{body}
{visual}
<aside class="notes"><b>강사 노트</b>{html.escape(chapter["notes"])}</aside>
<p class="source">구현 근거: <a href="../../{source}">{source}</a> · {cross_link}</p>
</section>'''


def render_page(root, presentation=False):
    title = "Terraform·GitHub Actions·AWS 배포" + ("" if presentation else " 상세 강의")
    css = (HERE / "course.css").read_text()
    javascript = (HERE / "course-navigation.js").read_text() if presentation else ""
    toc = "".join(
        f'<li><a href="#{chapter["id"]}">{html.escape(chapter["title"])}</a></li>'
        for chapter in CHAPTERS
    )
    sections = "\n".join(
        section(chapter, index, presentation, root)
        for index, chapter in enumerate(CHAPTERS, 1)
    )
    return f'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><link rel="icon" href="data:,">
<meta name="description" content="TripPilot의 실제 Terraform·GitHub Actions·AWS 배포를 배우는 장별 상세 강의와 발표 자료">
<title>TripPilot · {html.escape(title)}</title><style>{css}</style></head>
<body class="{"deck-body" if presentation else "course"}">
<a class="skip" href="#deck">본문으로 건너뛰기</a>
<header><div class="eyebrow">TRIPPILOT ENGINEERING / 2026-09-20</div>
<h1>{html.escape(title)}</h1><p class="lede">{LINKS}</p>
<p class="lede">같은 {len(CHAPTERS)}개 장으로 읽는 상세 설명과 발표 요약. 기본 3강 × 50분, 30분·60분 편성도 제공합니다.</p>
<p class="lede">HTML 하나로 오프라인에서 읽을 수 있습니다. 발표는 ← → / PageUp·PageDown / Space·Shift+Space / Home·End로 탐색합니다.
버튼·링크·폼 입력 중에는 단축키를 적용하지 않습니다. 읽기와 인쇄는 모든 장을 보여줍니다.</p></header>
{"" if presentation else f'<nav class="toc" aria-label="강의 목차"><h2>과정 목차</h2><ol>{toc}</ol></nav>'}
<noscript><p class="fallback">JavaScript가 꺼져 있어 모든 장을 이어서 표시합니다. 브라우저의 인쇄 기능도 사용할 수 있습니다.</p></noscript>
<main id="deck"><span id="main" class="anchor-alias" aria-hidden="true"></span>{sections}</main>
{controls() if presentation else ""}
<footer>{LINKS}<p>구성도: <a href="assets/aws-architecture.svg">DEV</a> ·
<a href="assets/aws-architecture-prd.svg">PRD</a> · <a href="assets/terraform-dependencies.svg">Terraform 의존성</a> ·
<a href="assets/diagram-provenance.json">SHA-256 출처</a></p>
<p><a href="https://github.com/ASM-TripPilot/trippilot/pull/645">TripPilot PR #645</a>의 실습·해설을
<a href="https://github.com/mz2az/SceneTrip/pull/98">SceneTrip PR #98</a>의 상세 강의·발표 형식으로 구성했습니다.
구성도는 코드 기반 교육 자료이며 실제 AWS 배포 결과가 아닙니다.</p></footer>
{"<script>" + javascript + "</script>" if presentation else ""}
</body></html>\n'''


def render_outputs(root):
    return {COURSE: render_page(root), PRESENTATION: render_page(root, True)}


class References(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids = set()
        self.links = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if "id" in values:
            self.ids.add(values["id"])
        if tag == "a" and "href" in values:
            self.links.append(values["href"])


def validate_links(root, outputs):
    directory = root / "docs/education"
    documents = {(directory / name).resolve(): References(text) for name, text in outputs.items()}
    missing = []
    for path, document in documents.items():
        for reference in document.links:
            url = urlsplit(reference)
            if url.scheme or url.netloc:
                continue
            target = (path.parent / unquote(url.path)).resolve() if url.path else path
            if target not in documents and not target.is_file():
                missing.append(f"{path.name} → {reference}")
            elif url.fragment and target.suffix == ".html":
                target_document = documents.get(target)
                if target_document is None:
                    target_document = References(target.read_text())
                if unquote(url.fragment) not in target_document.ids:
                    missing.append(f"{path.name} → {reference}")
    if missing:
        raise ValueError("존재하지 않는 문서 링크: " + "; ".join(missing))


def write_outputs(directory, outputs, check=False):
    differences = []
    for name, content in sorted(outputs.items()):
        path = directory / name
        if check:
            if not path.is_file() or path.read_text() != content:
                differences.append(name)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
    if differences:
        print("교육 산출물이 정본과 다릅니다: " + ", ".join(differences))
    return not differences


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--root", type=Path, default=HERE.parents[2])
    args = parser.parse_args(argv)
    outputs = render_outputs(args.root)
    validate_links(args.root, outputs)
    if not write_outputs(args.root / "docs/education", outputs, args.check):
        return 1
    print("교육 자료 검사 통과" if args.check else "교육 자료 생성 완료")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
