"""EXPLANATION 출구 게이트 (정본 §2.2) — 슬롯별 추천 이유."""

from __future__ import annotations

import re
from datetime import datetime

from trippilot.llm_gateway.gates.base import (
    GateOutcome,
    has_contact_like,
    _load_json_object,
    empty_result_error,
)
from trippilot.domain.common import PoiId, TraceId
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR
from trippilot.domain.llm import CandidatePool, LlmFeature, PoiExplanation
from trippilot.domain.observability import GateDropEvent

# 슬롯당 해시태그 개수 — **고정** (팀 결정 2026-09-24, "차후 필요하면 바꾼다"). 프롬프트가
# 같은 수를 요구하고, 게이트는 초과분만 자른다(부족은 그대로 — 정상 답을 통째로 버리는
# 과잉 드롭이 더 큰 손해다, share_card_copy 게이트의 같은 판단).
HASHTAG_COUNT = 5
# 태그 본문('#' 제외) 길이 상한 — 문장을 태그 하나로 위장한 출력을 막는다. 프롬프트의
# "10자 이내"와 같은 값이어야 한다(정합은 테스트가 고정).
HASHTAG_MAX_LEN = 10
# '#' 하나 + 공백·'#' 없는 본문. 공백이 들어가면 태그가 아니라 문장이다.
_HASHTAG = re.compile(rf"^#[^\s#]{{1,{HASHTAG_MAX_LEN}}}$")


class ExplanationGate:
    """EXPLANATION 출구 게이트 (정본 §2.2) — poiId ⊆ 풀 교차 (INV-1).

    한 게이트가 **feature 로 두 출력형을 가른다** (배선 실수로 모드가 어긋날 자리를 없앤다):
    - `EXPLANATION` (슬롯 추천 이유, 프롬프트 v0.3.0) — `{"explanations": [{"poiId", "tags": [...]}]}`.
      태그를 개별 검사(형식·시간 표현·연락처 꼴)해 걸러내고 앞에서 `HASHTAG_COUNT`개까지
      공백으로 이어 붙여 `PoiExplanation.text` 에 담는다. 와이어는 그대로 문자열 하나다.
    - 그 외(`ALTERNATIVE_EXPLANATION`, TRIP-887) — `{"poiId", "text"}` 문장. 종전 처리 그대로.

    중복 poiId 는 첫 등장 채택.

    **빈 결과 = 실패** (TRIP-260 #5): 설명 0건은 "설명 없음"과 같아 보이지만,
    호출측(orchestrator `_explain`·wiring `explanations`)은 그 둘을 다르게 보고한다
    — 폴백 사유를 실어야 사용자에게 "왜 설명이 없는지"가 남는다 (INV-4).
    """

    def apply(
        self,
        raw_text: str,
        pool: CandidatePool | None,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        if pool is None:
            return GateOutcome(value=(), drop_event=None, error="gate_error: 후보 풀 없음")
        hashtags = feature is LlmFeature.EXPLANATION
        try:
            items = _load_json_object(raw_text, "explanations")
            if not isinstance(items, list):
                raise ValueError("explanations가 배열이 아님")
            parsed: list[tuple[str, str]] = []
            for i, item in enumerate(items):
                if not isinstance(item, dict):
                    raise ValueError(f"explanations[{i}]가 객체가 아님")
                poi_id = item.get("poiId")
                if not isinstance(poi_id, str) or not poi_id:
                    raise ValueError(f"explanations[{i}].poiId 비정상")
                text = _hashtag_text(item, i) if hashtags else _sentence_text(item, i)
                parsed.append((poi_id, text))
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        seen: set[str] = set()
        survivors: list[PoiExplanation] = []
        dropped: list[PoiId] = []
        for pid_str, text in parsed:
            if pid_str in seen:
                continue
            seen.add(pid_str)
            pid = PoiId(pid_str)
            if pool.contains(pid):
                # 형제 게이트(alternative_selection)와 같은 처리 — 문장만 버리고 슬롯은 살린다.
                # ⑴ 시간·소요시간 표현: 이 text 는 백엔드 `visit_slot.placement_reason` 과
                #    리비전 스냅샷에 **영속된다**. 걸러 내지 않으면 INV-3 위반이 화면과 DB
                #    양쪽에 남는다. 정규식은 reflection_template 것을 **공유**한다 —
                #    두 벌을 두면 한쪽만 고쳐진다(alternative_selection 의 같은 주석 참조).
                # ⑵ 링크·연락처 꼴: 프롬프트에 실린 제3자 문자열(웹 수집 상호명 등)이 유도한
                #    유인 문구를 앱이 자기 목소리로 말하지 않게 한다.
                # 해시태그 경로는 태그마다 이미 같은 검사를 거쳤다 — 여기는 문장 경로 몫이고,
                # 이어 붙인 태그 문자열에는 걸리지 않는다('#'이 표현을 끊는다).
                safe = "" if (_TIME_EXPR.search(text) or has_contact_like(text)) else text
                survivors.append(PoiExplanation(poi_id=pid, text=safe))
            else:
                dropped.append(pid)
        drop_event = (
            GateDropEvent(
                trace_id=trace_id, occurred_at=now, component="c1.gate",
                feature=feature.value, dropped_ids=tuple(dropped),
                total_count=len(seen), dropped_count=len(dropped),
            )
            if dropped else None
        )
        return GateOutcome(
            value=tuple(survivors),
            drop_event=drop_event,
            error=empty_result_error(survivors, drop_event),
        )


def _sentence_text(item: dict, i: int) -> str:
    """문장 경로 — 빈 text 는 형태 위반(종전 규칙 그대로)."""
    text = item.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"explanations[{i}].text 비정상")
    return text


def _hashtag_text(item: dict, i: int) -> str:
    """해시태그 경로 — 형태 위반은 엄격하게(배열·문자열 아님 = parse_error), 내용 위반은 태그
    단위로 걸러낸다. 걸러낸 뒤 0개면 빈 문자열 — "슬롯은 살리고 문장만 비운다"와 같은 자리다.
    """
    tags = item.get("tags")
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        raise ValueError(f"explanations[{i}].tags 비정상")
    # 순서 보존 중복 제거 → 태그 단위 검사 → 앞에서 HASHTAG_COUNT 개
    kept = [t for t in dict.fromkeys(t.strip() for t in tags) if _tag_ok(t)]
    return " ".join(kept[:HASHTAG_COUNT])


def _tag_ok(tag: str) -> bool:
    return (
        _HASHTAG.fullmatch(tag) is not None
        and not _TIME_EXPR.search(tag)
        and not has_contact_like(tag)
    )
