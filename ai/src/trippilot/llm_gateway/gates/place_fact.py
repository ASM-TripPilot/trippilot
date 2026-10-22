"""PLACE_FACT_LOOKUP 출구 게이트 — 웹 검색으로 찾은 장소 정보 칸을 형식으로만 통과시킨다(UnknownHandlingAgent).

닫힌 집합은 후보 풀이 아니라 **검색이 실제로 단 인용 URL**(`LlmResponse.citations`, 게이트웨이가 웹 검색 기능이면 이것을
넘긴다)이다. 출처는 모델이 쓴 문자열이 아니라 그 집합에서 고른다 — 인용이 없으면 값이 있어도 버린다(지어낸 출처·기억으로 짐작한
값을 "찾은 값"으로 저장하지 않는다). 칸마다 좁은 꼴만 받고 꼴 밖이면 그 칸만 버린다. 검색 결과 글은 제3자 문자열이라 칸 값에
주입·연락처 꼴이 섞이면 버린다(보이는 문장 오염이 피해의 전부다 — prompt-injection 감사 2026-09-19).
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from urllib.parse import urlsplit

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.llm_gateway.gates.base import GateOutcome, has_contact_like, has_injection_like, strip_code_fence
from trippilot.ports.place_fact_store_port import FIELDS, PlaceFacts

_CLOCK = r"(?:[01]?\d|2[0-4]):[0-5]\d"
_HOURS = re.compile(rf"({_CLOCK})\s*[~\-–]\s*({_CLOCK})")
_DAY = r"[월화수목금토일]요일"
_CLOSED = re.compile(rf"연중무휴|매주 {_DAY}(?:\s*[,·]\s*{_DAY})*|매월 (?:첫|둘|셋|넷|마지막)째 주 {_DAY}")
_FEE = re.compile(r"무료|(\d{1,3}(?:,\d{3})+|\d{1,6})원")
# 출처 고르기 — 공공·기관 누리집을 먼저(같은 인용 집합 안에서만 고른다). 블로그·SNS·동영상은 출처로 치지 않는다(그것뿐이면 저장 안 함)
_OFFICIAL = (".go.kr", ".or.kr", ".ac.kr", ".re.kr", "visitkorea.or.kr")
_UGC = ("blogspot.com", "tistory.com", "blog.naver.com", "m.blog.naver.com", "cafe.naver.com", "brunch.co.kr", "velog.io",
        "instagram.com", "facebook.com", "youtube.com", "youtu.be", "x.com", "twitter.com", "threads.net", "namu.wiki")


def _clean(field: str, raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    text = " ".join(raw.split())
    if not text or has_injection_like(text) or has_contact_like(text):
        return None
    if field == "hours":
        m = _HOURS.fullmatch(text)
        return f"{_pad(m[1])}~{_pad(m[2])}" if m else None
    if field == "last_entry":
        return _pad(text) if re.fullmatch(_CLOCK, text) else None
    if field == "closed":
        return text if _CLOSED.fullmatch(text) else None
    m = _FEE.fullmatch(text.replace(" ", ""))
    if not m:
        return None
    return "무료" if m[0] == "무료" else f"{int(m[1].replace(',', '')):,}원"


def _pad(clock: str) -> str:
    h, m = clock.split(":")
    return f"{int(h):02d}:{m}"


def _ugc(host: str) -> bool:
    return any(host == d or host.endswith("." + d) for d in _UGC)


def pick_source(citations: tuple[str, ...], said: object = None) -> tuple[str, str] | None:
    """출처 하나 — 검색이 본 URL 중 https·블로그 아님만. 모델이 근거로 든 `said` 가 그 안에 있으면 그것, 아니면 공공·기관 누리집 먼저.
    (url, 보일 호스트) 또는 None."""
    usable = [(u, h) for u in citations if urlsplit(u).scheme == "https" and (h := urlsplit(u).hostname or "") and not _ugc(h)]
    if not usable:
        return None
    usable.sort(key=lambda uh: (uh[0] != said, not uh[1].endswith(_OFFICIAL)))  # 안정 정렬 — 그 안은 인용 순서
    url, host = usable[0]
    return url, host.removeprefix("www.")


class PlaceFactGate:
    """{"hours","last_entry","closed","fee"} → `PlaceFacts`. 칸이 하나도 안 남으면 value None(성공·0건 = 못 찾음).
    인용이 없으면 실패(no_citation) — 출처 없는 값은 저장하지 않는다."""

    def apply(
        self,
        raw_text: str,
        pool: object,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        try:
            data = json.loads(strip_code_fence(raw_text))
        except json.JSONDecodeError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: JSON 아님: {e.msg}")
        if not isinstance(data, dict):
            return GateOutcome(value=None, drop_event=None, error="parse_error: 객체가 아님")
        given = {f: data.get(f) for f in FIELDS if data.get(f) is not None}
        kept = {f: _clean(f, v) for f, v in given.items()}
        dropped = sorted(f for f, v in kept.items() if v is None)
        drop = GateDropEvent(trace_id=trace_id, occurred_at=now, component="c1.gate", feature=feature.value,
                             dropped_ids=tuple(dropped), total_count=len(given), dropped_count=len(dropped)) if dropped else None
        if not any(kept.values()):
            return GateOutcome(value=None, drop_event=drop, error=None)
        source = pick_source(tuple(pool) if isinstance(pool, tuple) else (), data.get("source_url"))
        if source is None:
            return GateOutcome(value=None, drop_event=drop, error="no_citation")
        return GateOutcome(value=PlaceFacts(**{f: kept.get(f) for f in FIELDS}, source_url=source[0], source_host=source[1]),
                           drop_event=drop, error=None)
