r"""KB-5 장소 지식 수집 — 출처별로 문서를 모아 `data/place_docs.json` 에 쌓는다.

실행:
    uv run python scripts/collect_place_docs.py wiki          # ③ 위키백과 (키 불필요)
    uv run python scripts/collect_place_docs.py intro         # ② 수집 제안의 detail 조립

**멱등 병합이다.** 기존 파일을 읽어 `doc_id` 로 덮어쓰므로 출처를 나눠 여러 번 돌려도
서로를 지우지 않는다 — 넷이 한 장소에 공존하는 것이 설계다.

적재는 별도다: `scripts/load_kb.py data/place_docs.json` (다른 시드와 같은 경로).

## 출처별 메모

**wiki** — API 키 불필요. 제목 정확 일치만 쓴다(검색은 안 쓴다 — 동명 장소를 잘못
집으면 **엉뚱한 장소 설명이 후보에 붙어** 모델이 그걸 믿는다. 빈 것보다 나쁘다).
실측 적중률 11.8%(문화 25% ↔ 카페 2.5%) — 낮은 게 정상이고 ②가 그 구멍을 메운다.
CC BY-SA 라 `metadata.license`·`metadata.url` 을 같이 남긴다.

**intro** — 새 API 호출 0. 단 `provenance.detail` 은 **신규·변경분에만** 붙는다.
"""

from __future__ import annotations

import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request
from collections.abc import Iterable, Sequence

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))

from trippilot.domain.kb import KbDocument  # noqa: E402
from trippilot.poi_curation.place_docs import (  # noqa: E402
    SOURCE_WIKI,
    intro_docs,
    is_disambiguation,
    make_doc,
    mentions_region,
)

_DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
_OUT = _DATA / "place_docs.json"
_POIS = _DATA / "collected_pois.json"

_WIKI_API = "https://ko.wikipedia.org/w/api.php"
# 위키미디어 정책이 식별 가능한 User-Agent 를 요구한다 — 없으면 차단될 수 있다.
_UA = "TripPilot-KB5/0.1 (https://github.com/ASM-TripPilot/trippilot)"
# **TextExtracts 의 상한은 20 이다** — `titles` 는 50까지 받지만 `prop=extracts` 는
# 요청당 20건만 본문을 주고 나머지는 `continue.excontinue` 로 넘긴다(`exlimit=max` 도 20).
# 40으로 두면 page 40개가 오는데 extract 는 20개뿐이고, **경고도 오류도 없다.**
# 실측(2026-09-19): 반드시 존재하는 제목 40건을 요청 → page 40 · extract 20 ·
# `continue={"excontinue":20}`. 첫 수집에서 밀집 묶음 8개에서 extract 36건이
# 조용히 샜다(문서 12건 손실). 상한과 같은 값으로 둬서 매 요청이 온전히 처리되게 한다.
_WIKI_BATCH = 20
_WIKI_SLEEP = 0.4  # 예의상 간격 — 전량 18,607건이면 약 470요청


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in {"wiki", "intro"}:
        raise SystemExit(__doc__)
    source = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    proposals = json.loads(_POIS.read_text(encoding="utf-8"))["proposals"]
    if limit:
        proposals = proposals[:limit]

    docs = _wiki_docs(proposals) if source == "wiki" else intro_docs(proposals)
    merged = _merge(docs)
    print(f"{source}: 신규·갱신 {len(docs)}건 → 총 {len(merged)}건 ({_OUT.name})")


def _wiki_docs(proposals: Sequence[dict]) -> tuple[KbDocument, ...]:
    """상호명 정확 일치로 도입부를 받는다. 못 찾으면 그냥 없는 것이다."""
    by_title: dict[str, dict] = {}  # 제목 → 제안 항목 (지역 대조에 쓴다)
    for item in proposals:
        ref = (item.get("provenance") or {}).get("content_id") or item.get("provisional_id")
        name = ((item.get("poi") or {}).get("name") or "").strip()
        if ref and name and name not in by_title:
            by_title[name] = item

    docs: list[KbDocument] = []
    rejected = 0
    titles = list(by_title)
    for i in range(0, len(titles), _WIKI_BATCH):
        chunk = titles[i : i + _WIKI_BATCH]
        try:
            pages = _wiki_fetch(chunk)
        except Exception as e:  # 한 묶음 실패가 전체를 죽이지 않는다
            print(f"  ! 묶음 {i // _WIKI_BATCH} 실패 — {type(e).__name__}: {e}")
            continue
        for title, extract in pages.items():
            item = by_title.get(title)
            if not item:
                continue  # 리다이렉트로 제목이 바뀐 것 — 조인 못 하면 버린다
            provenance = item.get("provenance") or {}
            ref = str(provenance.get("content_id") or item.get("provisional_id"))
            # **그 문서가 그 장소 얘기인지 확인한다.** 상호명 일치만으로는 동명의
            # 인물·작품·개념이 그대로 통과한다 — place_docs.mentions_region 주석 참조.
            if is_disambiguation(extract) or not mentions_region(
                extract, item.get("region") or "", str(provenance.get("address") or "")
            ):
                rejected += 1
                continue
            doc = make_doc(
                SOURCE_WIKI, ref, extract,
                metadata={
                    "license": "CC BY-SA 4.0",
                    "url": f"https://ko.wikipedia.org/wiki/{urllib.parse.quote(title)}",
                    "title": title,
                },
            )
            if doc is not None:
                docs.append(doc)
        print(f"  {i + len(chunk):5d}/{len(titles)} · 채택 {len(docs)}건 · 지역불일치 기각 {rejected}건")
        time.sleep(_WIKI_SLEEP)
    return tuple(docs)


def _wiki_fetch(titles: Sequence[str]) -> dict[str, str]:
    query = urllib.parse.urlencode({
        "action": "query", "format": "json", "redirects": "1",
        "prop": "extracts", "exintro": "1", "explaintext": "1",
        "titles": "|".join(titles),
    })
    req = urllib.request.Request(f"{_WIKI_API}?{query}", headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=30) as response:
        body = json.load(response)
    # 상한을 넘겨 본문이 잘렸다는 **유일한 신호**가 이 토큰이다. 못 받은 것과 "그
    # 문서에 도입부가 없다"가 응답 모양으로는 구별이 안 되므로, 묶음 크기를 줄이는
    # 것만으로 끝내지 않고 여기서 터뜨린다 — 상한이 바뀌거나 prop 이 늘면 다시 샌다.
    if "continue" in body:
        raise RuntimeError(
            f"응답이 잘렸다(continue={body['continue']}) — _WIKI_BATCH({_WIKI_BATCH})가 "
            "API 상한을 넘는다. 줄여라. 그냥 두면 문서가 조용히 사라진다."
        )
    pages = body["query"]["pages"]
    return {
        page["title"]: (page.get("extract") or "")
        for page in pages.values()
        if page.get("title")
    }


def _merge(docs: Iterable[KbDocument]) -> dict[str, dict]:
    """`doc_id` 기준 멱등 병합 — 다른 출처의 문서를 지우지 않는다."""
    existing: dict[str, dict] = {}
    if _OUT.exists():
        loaded = json.loads(_OUT.read_text(encoding="utf-8"))
        existing = {d["doc_id"]: d for d in loaded.get("documents", [])}
    for doc in docs:
        existing[doc.doc_id] = {
            "doc_id": doc.doc_id,
            "text": doc.text,
            "poi_ref": doc.poi_ref,
            "metadata": doc.metadata,
        }
    _OUT.write_text(
        json.dumps(
            {"kb": "POI_DESC", "documents": sorted(existing.values(), key=lambda d: d["doc_id"])},
            ensure_ascii=False, indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    return existing


if __name__ == "__main__":
    main()
