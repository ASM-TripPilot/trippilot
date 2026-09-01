"""EVENT_EXTRACTION 출구 게이트 (TRIP-421 웹소싱 추출 단계) — 항목 단위 격리.

place_extraction 선례와 동형: 위반 항목은 전체 실패가 아니라 해당 항목만 드롭한다.

**빈 결과 = 성공** (TRIP-260 #5): 입력이 네이버 검색 스니펫이라 "그 기간 그 지역에
행사가 없음"이 **정상 결과**다. 이걸 실패로 뒤집던 동안 대전 6회 연속 0건의 원인을
찾는 데 3단계 추론이 필요했다(2026-08-25 실측 — 게이트는 아무것도 안 버렸고 LLM이
애초에 0건이었다). 전량 드롭이어도 폴백이 바꿀 것이 없다(대체 추출 경로 없음) —
환각 방어의 증빙은 GateDropEvent가 따로 싣는다.

행사는 POI가 아니라 closed-set 후보 풀 교차(INV-1) 대상이 아니다. 대신 같은
정신의 환각 방어를 **원문 스니펫 대조**로 수행한다: LLM이 출력한 행사명의
핵심 토큰이 원문 스니펫에 부분 문자열로 실재하지 않으면 지어낸 행사로 보고
드롭한다 (공백 제거 비교 — 보수적, 과잉 거부는 폴백=결정론 경로로 안전 수렴).

검증 5종 (드롭 사유):
  ① 스키마 — dict 아님·필드 누락·타입 오류
  ② event_type ∉ {FESTIVAL, PERFORMANCE, EXHIBITION, OTHER} (관대 매핑 금지)
  ③ start·end ISO 파싱 실패 또는 start > end (기간 역전)
  ④ 대상 기간과 하루도 안 겹침
  ⑤ 행사명 핵심 토큰이 원문 스니펫에 부재 (지어낸 행사명 차단)
좌표는 다루지 않는다 — coord=None 고정 (지오코딩·근접 부착은 코드 몫).
시각(시·분)·소요시간 필드는 스키마에 자리 자체가 없다 (INV-2·INV-3).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date, datetime

from trippilot.llm_gateway.gates.base import GateOutcome, _load_json_object
from trippilot.domain.common import TraceId
from trippilot.domain.event import EventInfo, EventType
from trippilot.domain.llm import LlmFeature
from trippilot.domain.observability import GateDropEvent

# 관대 매핑 금지 — enum 값 문자열과 정확 일치만 통과 (대소문자 보정도 안 한다)
_EVENT_TYPES = frozenset(t.value for t in EventType)


@dataclass(frozen=True, slots=True)
class EventExtractionContext:
    """게이트 검증 컨텍스트 — GatewayFacade.call의 pool 자리로 관통한다.

    (선호 점수의 CandidatePool과 같은 채널 — 이 feature의 대조 원본은 풀이
    아니라 원문 스니펫이라 컨텍스트 실체만 다르다.)
    """

    snippets_text: str  # LLM이 본 스니펫 원문 그대로 (행사명 실재 대조)
    period_start: date  # 대상 기간 시작
    period_end: date    # 대상 기간 끝

    def __post_init__(self) -> None:
        if self.period_end < self.period_start:
            raise ValueError(f"기간 역전: {self.period_start} > {self.period_end}")


def _normalize(text: str) -> str:
    """공백 전부 제거 + 소문자 — 보수적 부분 문자열 대조의 정규화."""
    return "".join(text.split()).lower()


def _name_in_snippets(name: str, normalized_snippets: str) -> bool:
    """행사명 핵심 토큰(정규화 2자 이상)이 **전부** 원문에 부분 문자열로 존재해야 생존.

    "부산 불꽃 축제" ↔ 원문 "부산불꽃축제"처럼 띄어쓰기 차이는 흡수하고,
    원문에 없는 토큰이 하나라도 섞인 이름은 지어낸 것으로 본다 (보수적).
    핵심 토큰이 없으면(전부 1자) 이름 전체 정규화 문자열로 대조한다.
    """
    core = [t for t in (_normalize(tok) for tok in name.split()) if len(t) >= 2]
    if not core:
        core = [_normalize(name)]
    return all(t in normalized_snippets for t in core)


class EventExtractionGate:
    """EVENT_EXTRACTION 출구 게이트 — 항목 단위 격리 (모듈 docstring 참조)."""

    def apply(
        self,
        raw_text: str,
        pool: object,  # EventExtractionContext — pool 자리로 관통 (ExitGate 계약 호환)
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        if not isinstance(pool, EventExtractionContext):
            # 컨텍스트 없이는 ⑤(원문 대조)·④(기간 겹침)를 수행할 수 없다 — 호출 계약 위반
            return GateOutcome(
                value=(), drop_event=None,
                error="gate_error: EventExtractionContext 없음 (원문 스니펫·대상 기간 필요)",
            )
        try:
            items = _load_json_object(raw_text, "events")
            if not isinstance(items, list):
                raise ValueError("events가 배열이 아님")
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        normalized_snippets = _normalize(pool.snippets_text)
        survivors: list[EventInfo] = []
        dropped_count = 0
        for item in items:
            event = self._to_event(item, pool, normalized_snippets)
            if event is None:
                dropped_count += 1  # 카운트만 — 행사명을 유사 ID로 지표에 넣지 않는다 (TRIP-260 #3 동형)
            else:
                survivors.append(event)
        drop_event = (
            GateDropEvent(
                trace_id=trace_id, occurred_at=now, component="c1.gate",
                feature=feature.value, dropped_ids=(),  # 추출 드롭은 풀 ID가 아님 — 환각률 지표 순수성
                total_count=len(items), dropped_count=dropped_count,
            )
            if dropped_count else None
        )
        return GateOutcome(value=tuple(survivors), drop_event=drop_event, error=None)

    @staticmethod
    def _to_event(
        item: object,
        ctx: EventExtractionContext,
        normalized_snippets: str,
    ) -> EventInfo | None:
        if not isinstance(item, dict):
            return None
        name, event_type_raw = item.get("name"), item.get("event_type")
        if not isinstance(name, str) or not name.strip():
            return None
        # ② 관대 매핑 금지 — 4값 밖은 드롭
        if not isinstance(event_type_raw, str) or event_type_raw not in _EVENT_TYPES:
            return None
        # ③ ISO 날짜 + 기간 역전
        start_raw, end_raw = item.get("start"), item.get("end")
        if not isinstance(start_raw, str) or not isinstance(end_raw, str):
            return None
        try:
            start, end = date.fromisoformat(start_raw), date.fromisoformat(end_raw)
        except ValueError:
            return None
        if start > end:
            return None
        # ④ 대상 기간과 하루도 안 겹치면 드롭
        if start > ctx.period_end or end < ctx.period_start:
            return None
        address = item.get("address")
        if address is not None and not isinstance(address, str):
            return None
        # ⑤ 지어낸 행사명 차단 — 원문 스니펫 대조 (closed-set 정신)
        if not _name_in_snippets(name, normalized_snippets):
            return None
        # event_id는 name+start 결정론 해시 (같은 입력 → 같은 id, 재수집 멱등)
        event_id = "evx-" + hashlib.sha256(
            f"{name}|{start.isoformat()}".encode()
        ).hexdigest()[:16]
        return EventInfo(
            event_id=event_id, name=name, event_type=EventType(event_type_raw),
            start=start, end=end,
            coord=None,  # 좌표는 다루지 않음 — 임의 생성 금지 (place_extraction 가드 동형)
            address=address,
        )
