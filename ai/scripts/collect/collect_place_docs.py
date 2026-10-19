r"""KB-5 장소 지식 수집.

실행:
    uv run python scripts/collect/collect_place_docs.py intro         # ② 수집 제안의 detail 조립
    uv run python scripts/collect/collect_place_docs.py wikifull      # ③′ 위키백과 **본문 전문** → 청킹 원천

적재는 별도다: `scripts/load_kb.py` (기본 seed 에 `data/place_corpus_wiki.jsonl.gz`).

## 출처별 메모

**wikifull** — 위키백과 본문 전문(API 키 불필요) → `data/place_corpus_wiki.jsonl.gz`(원천 그대로, 통째로 바꿔
쓴다). 제목 정확 일치만 쓴다(검색은 안 쓴다 — 동명 장소를 잘못 집으면 **엉뚱한 장소 설명이 후보에 붙어** 모델이
그걸 믿는다. 빈 것보다 나쁘다). CC BY-SA 라 `license`·`url` 을 행에 남기고 조각 payload 로 이어진다.
2026-10-18 종전 `wiki` 모드(도입부만 → `place_docs.json`)를 대체했다.

**intro** — 새 API 호출 0. `data/place_docs.json` 에 `doc_id` 기준 멱등 병합. 단 `provenance.detail` 은
**신규·변경분에만** 붙는다. 기본 seed 가 아니다(실측 0건이라 아직 쓸 데가 없다 — 2단계 TourAPI 상세와 함께).
"""

from __future__ import annotations

import gzip
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request
from collections.abc import Iterable, Sequence

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "src"))

from trippilot.domain.kb import KbDocument  # noqa: E402
from trippilot.llm_gateway.gates.base import has_contact_like  # noqa: E402
from trippilot.poi_curation.chunking import split_sentences  # noqa: E402
from trippilot.poi_curation.place_docs import (  # noqa: E402
    SOURCE_WIKI,
    intro_docs,
    is_company_intro,
    is_disambiguation,
    mentions_region,
    same_subject,
    wiki_sections,
)

_DATA = pathlib.Path(__file__).resolve().parents[2] / "data"
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
    if len(sys.argv) < 2 or sys.argv[1] not in {"intro", "wikifull"}:
        raise SystemExit(__doc__)
    source = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    proposals = json.loads(_POIS.read_text(encoding="utf-8"))["proposals"]
    if limit:
        proposals = proposals[:limit]
    if source == "wikifull":
        n = _wiki_corpus(proposals, sample=bool(limit))
        print(f"wikifull: 본문 {n}건 → {(_SAMPLE if limit else _CORPUS).name}")
        return

    docs = intro_docs(proposals)
    merged = _merge(docs)
    print(f"{source}: 신규·갱신 {len(docs)}건 → 총 {len(merged)}건 ({_OUT.name})")


# ── ③′ 위키백과 본문 전문 (청킹 원천) ─────────────────────────────────────
#
# ③ 은 **도입부만** 받았다(`exintro`) — 중앙값 106자, 그중 LLM 이 읽는 건 앞 160자. 본문에는
# 시설·관람·교통·계절 같은 상황 판단 근거가 더 많다. 그래서 본문 전체를 **원천 그대로** 남기고
# (`place_corpus_wiki.jsonl.gz`), 문서로 쓰는 것은 `poi_curation/chunking` 이 거기서 만든다 —
# 청킹 규칙을 바꿔도 다시 수집하지 않는다.
#
# 장소 판정은 ③ 과 같다(정확 일치 + **도입부**가 지역을 언급). 본문 전체로 지역을 보면 긴 문서일수록
# 아무 지명이나 걸려 오매칭이 는다 — 그래서 판정은 도입부로, 수집은 전문으로 나눈다.
_CORPUS = _DATA / "place_corpus_wiki.jsonl.gz"
# `limit` 을 준 시험 실행은 여기에 쓴다 — 정본 코퍼스를 27행짜리 표본으로 덮어쓰는 사고를 막는다(리뷰 실측).
_SAMPLE = _DATA / "place_corpus_wiki.sample.jsonl.gz"
# 위키 판정에서 빼는 출처 — 인허가 식당(LOCALDATA 3.7만)은 동네 가게라 위키 문서가 거의 없고(실측 2026-10-18:
# 이 구간 2만여 이름에서 채택 1건), 맞으면 오히려 동명 회사·체인 문서다.
_WIKI_SKIP_SOURCES = frozenset({"LOCALDATA"})
# 같은 이름이 이만큼 이상이면 체인·일반명사로 본다("골목식당"·"장미공원"·"하늘정원"). 제목 정확 일치가 **지점이
# 아니라 회사·개념 문서**를 붙이고, 그 문서는 지명을 흔히 적어 지역 판정까지 통과한다. 셀 때 LOCALDATA 는 뺀다 —
# 동명 식당 때문에 진짜 항구·바위('죽변항'·'선바위')가 체인으로 빠졌다(리뷰 실측).
_CHAIN_MIN = 3
# 본문 실패가 이 비율을 넘으면 비정상 종료 — 망가진 실행이 종료코드 0 으로 코퍼스를 줄여 놓지 않게.
_MAX_FAIL_RATE = 0.02
# 요청 재시도 간격(초) — 연결 끊김·리셋은 잠깐 기다리면 대개 풀린다(2026-10-18 실측: 맥 부하·망 불안정으로 2,004건 중
# 93건이 한 번에 실패해 실행 전체가 버려질 뻔했다).
_RETRY_SLEEPS = (2, 5, 15)
# 받은 응답을 남겨 두는 로컬 캐시(JSONL, 리포 밖) — `WIKIFULL_CACHE` 경로를 주면 다시 돌릴 때 받은 것은 건너뛴다.
_CACHE_ENV = "WIKIFULL_CACHE"


class _Cache:
    """키 → 응답 JSONL. 없으면 아무것도 안 하는 대역."""

    def __init__(self) -> None:
        import os

        p = os.environ.get(_CACHE_ENV)
        self._path = pathlib.Path(p) if p else None
        self._data: dict = {}
        if self._path and self._path.exists():
            for line in self._path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    k, v = json.loads(line)
                    self._data[k] = v

    def get(self, key):
        return self._data.get(key)

    def put(self, key, value) -> None:
        self._data[key] = value
        if self._path:
            with self._path.open("a", encoding="utf-8") as f:
                f.write(json.dumps([key, value], ensure_ascii=False) + "\n")


def _retrying(fn, *args):
    for wait in (*_RETRY_SLEEPS, None):
        try:
            return fn(*args)
        except Exception:
            if wait is None:
                raise
            time.sleep(wait)


def select_wiki_titles(proposals: Sequence[dict]) -> dict[str, dict]:
    """판정할 이름 → 그 제안 항목. LOCALDATA·체인(이름 반복) 제외, 같은 이름은 첫 항목."""
    counts: dict[str, int] = {}
    for item in proposals:
        if item.get("source") in _WIKI_SKIP_SOURCES:
            continue
        name = ((item.get("poi") or {}).get("name") or "").strip()
        counts[name] = counts.get(name, 0) + 1
    by_title: dict[str, dict] = {}
    for item in proposals:
        ref = (item.get("provenance") or {}).get("content_id") or item.get("provisional_id")
        name = ((item.get("poi") or {}).get("name") or "").strip()
        if item.get("source") in _WIKI_SKIP_SOURCES or counts.get(name, 0) >= _CHAIN_MIN:
            continue
        if ref and name and name not in by_title:
            by_title[name] = item
    return by_title


def _ref(item: dict) -> str:
    return str((item.get("provenance") or {}).get("content_id") or item.get("provisional_id"))


def accept(pages: dict[str, tuple[str, str]], by_title: dict[str, dict]) -> list[tuple[str, str]]:
    """판정 응답 `{요청한 이름: (실제 문서 제목, 도입부)}` → 채택 `(문서 제목, 조인 키)`.

    **요청한 이름**으로 POI 를 찾는다 — 리다이렉트 뒤 제목으로 찾으면 '더현대 서울'의 응답('현대백화점')이
    다른 POI '현대백화점'으로 판정돼 같은 문서가 두 번 들어가고, 배포 적재가 doc_id 중복으로 죽었다(리뷰 재현).
    """
    out = []
    for asked, (title, intro) in pages.items():
        item = by_title.get(asked)
        if not item or not intro.strip():
            continue
        prov = item.get("provenance") or {}
        address = str(prov.get("address") or "")
        if (is_disambiguation(intro) or is_company_intro(intro)
                or not same_subject(str((item.get("poi") or {}).get("name") or asked), title, address)
                or not mentions_region(intro, item.get("region") or "", address)):
            continue
        out.append((title, _ref(item)))
    return out


def _wiki_corpus(proposals: Sequence[dict], *, sample: bool = False) -> int:
    """도입부로 장소를 판정하고, 통과한 것만 **본문 전문**을 받아 절 단위로 저장한다."""
    by_title = select_wiki_titles(proposals)
    print(f"  판정 대상 {len(by_title)}개 이름 (인허가 식당·체인 {len(proposals) - len(by_title)}건 제외)")
    titles = list(by_title)
    accepted: dict[str, str] = {}  # 조인 키 → 문서 제목 (한 장소에 문서 하나 — doc_id 가 유일하다)
    cache = _Cache()
    for i in range(0, len(titles), _WIKI_BATCH):
        batch = titles[i : i + _WIKI_BATCH]
        key = "j:" + "|".join(batch)
        pages = cache.get(key)
        if pages is None:
            try:
                pages = _retrying(_wiki_fetch_mapped, batch)
            except Exception as e:  # 한 묶음 실패가 전체를 죽이지 않는다
                print(f"  ! 판정 묶음 {i // _WIKI_BATCH} 실패 — {type(e).__name__}: {e}")
                continue
            cache.put(key, pages)
            time.sleep(_WIKI_SLEEP)
        pages = {k: tuple(v) for k, v in pages.items()}
        for title, ref in accept(pages, by_title):
            accepted.setdefault(ref, title)
        if (i // _WIKI_BATCH) % 25 == 0:
            print(f"  판정 {i + len(batch):6d}/{len(titles)} · 장소 문서 {len(accepted)}건")

    out_path = _SAMPLE if sample else _CORPUS
    tmp = out_path.with_suffix(".tmp")
    rows, failed = 0, 0
    with gzip.open(tmp, "wt", encoding="utf-8") as out:
        for n, (ref, title) in enumerate(accepted.items(), 1):
            text = cache.get("f:" + title)
            if text is None:
                try:
                    text = _retrying(_wiki_full, title)
                except Exception as e:
                    failed += 1
                    print(f"  ! 본문 {title} 실패 — {type(e).__name__}: {e}")
                    continue
                cache.put("f:" + title, text)
                time.sleep(_WIKI_SLEEP)
            sections = _without_contacts(wiki_sections(text))
            if not sections:
                continue
            out.write(json.dumps({
                "doc_id": f"{SOURCE_WIKI}:{ref}", "poi_ref": ref, "title": title,
                "license": "CC BY-SA 4.0",
                "url": f"https://ko.wikipedia.org/wiki/{urllib.parse.quote(title)}",
                "sections": sections,
            }, ensure_ascii=False) + "\n")
            rows += 1
            if n % 200 == 0:
                print(f"  본문 {n:5d}/{len(accepted)}")
    if accepted and failed / len(accepted) > _MAX_FAIL_RATE:
        tmp.unlink()
        raise SystemExit(f"본문 실패 {failed}/{len(accepted)} — {_MAX_FAIL_RATE:.0%} 초과, 코퍼스를 바꾸지 않았다")
    tmp.replace(out_path)
    return rows


def _without_contacts(sections: list[dict]) -> list[dict]:
    """전화·주소·URL 같은 연락처꼴 문장은 뺀다 — 후보 줄로 프롬프트에 실려 추천 이유에 섞이면 출력 게이트가
    그 카테고리 이유를 통째로 비운다(`gates.base.has_contact_like`, test_gate_injection_defense)."""
    out = []
    for s in sections:
        kept = [x for x in split_sentences(s["text"]) if not has_contact_like(x)]
        if kept:
            out.append({**s, "text": " ".join(kept)})
    return out


def _wiki_fetch_mapped(titles: Sequence[str]) -> dict[str, tuple[str, str]]:
    """도입부 판정 묶음 — `{요청한 이름: (실제 문서 제목, 도입부)}`. 정규화·리다이렉트를 요청한 이름으로 되돌린다."""
    query = urllib.parse.urlencode({
        "action": "query", "format": "json", "redirects": "1",
        "prop": "extracts", "exintro": "1", "explaintext": "1",
        "titles": "|".join(titles),
    })
    req = urllib.request.Request(f"{_WIKI_API}?{query}", headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=30) as response:
        body = json.load(response)
    if "continue" in body:  # `_wiki_fetch` 와 같은 이유 — 잘린 응답을 조용히 넘기지 않는다
        # 상한을 넘겨 본문이 잘렸다는 **유일한 신호**가 이 토큰이다 — 못 받은 것과 "도입부가 없다"가 응답
        # 모양으로는 구별이 안 되므로 여기서 터뜨린다(상한이 바뀌면 다시 샌다).
        raise RuntimeError(f"응답이 잘렸다(continue={body['continue']}) — _WIKI_BATCH({_WIKI_BATCH})가 API 상한을 넘는다")
    return map_requested(titles, body["query"])


def map_requested(titles: Sequence[str], q: dict) -> dict[str, tuple[str, str]]:
    """API `query` 응답 → 요청한 이름별 (최종 제목, 도입부). 정규화 → 리다이렉트 순으로 따라간다."""
    norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
    redir = {r["from"]: r["to"] for r in q.get("redirects", [])}
    pages = {p["title"]: p.get("extract") or "" for p in q.get("pages", {}).values() if p.get("title")}
    out = {}
    for asked in titles:
        title = norm.get(asked, asked)
        title = redir.get(title, title)
        if title in pages:
            out[asked] = (title, pages[title])
    return out


def _wiki_full(title: str) -> str:
    """본문 전문(plain, 절 제목은 `== 제목 ==`). 전문은 요청당 한 문서만 준다(TextExtracts 제약)."""
    query = urllib.parse.urlencode({
        "action": "query", "format": "json", "redirects": "1",
        "prop": "extracts", "explaintext": "1", "exsectionformat": "wiki", "titles": title,
    })
    req = urllib.request.Request(f"{_WIKI_API}?{query}", headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=30) as response:
        pages = json.load(response)["query"]["pages"]
    return next((p.get("extract") or "" for p in pages.values()), "")


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
