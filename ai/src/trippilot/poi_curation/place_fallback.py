"""KB-5 대체 문서 — 진짜 문서(위키·관광공사 개요)가 없는 장소에 붙는 **장소 카드 + 웹 확인 사실** (2026-10-23 사용자 지시:
"지금 있는 POI 전부에 문서를").

- 장소 카드(`data/place_cards.jsonl.gz`, `scripts/collect/build_place_cards.py`): 관광공사 상세(대표메뉴·주차 등)가 있는 곳의 한 줄.
- 웹 확인 사실(`data/place_web_facts.jsonl.gz`, `scripts/collect/collect_place_web_facts.py`): 벤더 웹 검색이 본 페이지에 적힌
  사실만(사실마다 검색 인용 URL). 있으면 카드 뒤에 붙인다. 블로그 근거도 싣는다(2026-10-30 사용자 결정 — 약관 위험 수용).
- 둘 다 빌드 때 진짜 문서·소개와 같은 게이트를 지났다(시각·소요·연락처·주입 문장 제거 · 너무 짧으면 없음).

진짜 문서를 **점수로 밀어내지 않는다** — 짧은 글은 상황 질의 점수에서 긴 개요 조각을 86~95% 이긴다(2026-10-23 실측). 그래서 벡터에
넣지 않고, 진짜 문서가 없는 자리에만 키로 바로 붙인다(공개 리포에 벡터 수백 MB 를 쌓지 않는 것도 같은 이유다).

켜기: `TRIPPILOT_KB5_FALLBACK=on` — **기본 꺼짐.** 켜기 전에 KB-5 담당 세션의 조건(2026-10-30)을 채운다:
`measure_kb5_overview.py` ab 로 '진짜 문서만' 대 '대체 문서 추가'를 재서 같은 입력끼리의 흔들림(≈12:7)보다 확실히 이길 것.
"""

from __future__ import annotations

import gzip
import json
import logging
import os
import threading
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path

log = logging.getLogger(__name__)

_DATA = Path(__file__).resolve().parents[3] / "data"
CARDS_PATH, WEB_PATH = _DATA / "place_cards.jsonl.gz", _DATA / "place_web_facts.jsonl.gz"
SWITCH = "TRIPPILOT_KB5_FALLBACK"
WEB_FACTS_PER_DOC = 4


def enabled() -> bool:
    return os.environ.get(SWITCH, "off").strip().lower() in ("on", "1", "true", "yes")


def compose(card: str, facts: list[str]) -> str:
    """카드 + "웹 확인:" 사실들(사실 하나가 한 문장 — 소개 게이트가 걸린 문장만 뺄 수 있게). 카드가 없으면 사실만."""
    web = "웹 확인: " + ". ".join(facts[:WEB_FACTS_PER_DOC]) + "." if facts else ""
    return " ".join(x for x in (card, web) if x)


def _rows(path: Path):
    if not path.exists():
        return
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


@lru_cache(maxsize=1)
def fallback_docs() -> Mapping[str, str]:
    """{source_ref: 대체 문서}. 파일 장애는 그 파일 몫만 빈다 — 부가 정보라 없이 간다(INV-4, 사유는 로그)."""
    try:
        cards = {r["poi_ref"]: r["text"] for r in _rows(CARDS_PATH)}
    except Exception as e:  # noqa: BLE001 — 깨진 파일 하나가 대안 선택을 막으면 안 된다
        log.warning("kb5 fallback cards unavailable: %s: %s", type(e).__name__, e)
        cards = {}
    out, web = dict(cards), 0
    try:
        for r in _rows(WEB_PATH):
            facts = [f["text"] for f in r.get("facts") or () if f.get("text")]
            if facts:
                out[r["poi_ref"]] = compose(cards.get(r["poi_ref"], ""), facts)
                web += 1
    except Exception as e:  # noqa: BLE001
        log.warning("kb5 fallback web facts unavailable after %d: %s: %s", web, type(e).__name__, e)
    log.info("kb5 fallback loaded cards=%d web=%d", len(cards), web)
    return out


def warm() -> None:
    """켜져 있으면 기동 때 백그라운드로 표를 읽어 둔다 — 첫 요청이 파일 읽기(약 0.15초)를 떠안지 않게. 꺼져 있으면 읽지 않는다."""
    if enabled():
        threading.Thread(target=fallback_docs, name="kb5-fallback", daemon=True).start()


def doc(source_ref: str) -> str:
    """장소 하나의 대체 문서 — 꺼져 있거나 없으면 빈 문자열."""
    return fallback_docs().get(source_ref, "") if enabled() and source_ref else ""
