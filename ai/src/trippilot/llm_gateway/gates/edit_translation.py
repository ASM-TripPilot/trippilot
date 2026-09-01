"""EDIT_TRANSLATION 출구 게이트 (정본 §2.4 + agent-foundation FD §1).

번역 결과는 **명령 1건**이라 항목 격리(place_extraction 선례)가 성립하지 않는다 —
affectedSlots 일부만 살리면 명령의 의미가 바뀌므로, 대조 집합 밖 ID가 하나라도 있으면
명령 전체를 드롭한다 (부분 반영 금지).

검증 4종:
  ① op ∈ EditOp (closed-set — enum 밖 값은 명령 자체가 존재 불가)
  ② POI 참조 교차 — **대조 집합이 둘이다** (TRIP-527):
     · params의 `*PoiId`(= 새로 넣는 POI) ⊆ 후보 풀 — INV-1 그대로. REPLACE_SLOT의
       대상 POI가 params로 새는 경로를 여기서 막는다.
     · affectedSlots(= 이미 일정에 있는 슬롯 지목) ⊆ 현재 슬롯. 고르는 행위가 아니라
       가리키는 행위라 풀 자격을 다시 물을 대상이 아니다 — 그 POI는 생성 시 이미 풀을
       통과했고, 편집 경로가 백엔드 find_by_ids로 실물을 받아온 등록 POI다.
     풀은 요청마다 앵커 반경·예산·품질로 잘리는 조각이라(poi_curation.pool_builder),
     다른 조건으로 생성된 원 일정의 슬롯이 풀 밖인 것은 정상이다. 이걸 풀로 교차하던
     동안 그런 슬롯은 자연어로 영원히 편집 불가였다 (TRIP-527).
     대조 집합은 구조화 진입(`agents.edit_agent.validate_command`)의 규칙과 같다 —
     두 진입이 같은 슬롯에 다른 판정을 내지 않는다 (TRIP-431 수렴 결정).
     POI "이름" 문자열은 교차 대상이 아니다 — 이름 해소는 코드(fuzzy match, AI-D04)
     몫이고 그 지점에서 다시 풀 교차된다.
  ③ params에 시각·소요시간 필드 없음 (INV-3 + INV-2의 시각 측면 — 시각은 솔버 소유).
     순서·위치 제안은 허용한다: 워커는 제안만 하고 확정은 솔버라는 INV-2 원문 그대로,
     "3번째로 옮겨줘"의 위치는 사용자 요구지 확정 시각이 아니다.
  ④ params는 평면 객체 (중첩 dict·list 금지) — 중첩으로 ②③ 검사를 우회하지 못한다.
그리고 apply_mode는 LLM 제안을 버리고 코드가 확정한다 (하이브리드 AI-D02):
`domain.edit.resolve_apply_mode` 재사용 — 게이트는 판정 로직을 새로 만들지 않는다.
번역 불가(`{"editCommand": null}`)는 성공으로 위장하지 않고 폴백 신호로 낸다 (INV-4).
산출이 **명령 1건**이라 "빈 결과"라는 상태가 없다 — 성립하거나 error다
(TRIP-260 #5의 empty 정책이 적용될 자리가 아니다).

출력 타입 `EditTranslation`은 `domain/edit.py` 소유다 — 게이트를 통과한 값만 도메인
타입으로 승격한다는 u4 FD domain-entities §4 규칙 그대로 (게이트는 생성만 한다).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from trippilot.llm_gateway.gates.base import GateOutcome, _load_json_object
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.edit import (
    EditCommand,
    EditOp,
    EditTranslation,
    resolve_apply_mode,
)
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent

# INV-2(시각)·INV-3 방어 — 편집 명령은 "무엇을"만 표현한다 (시각·소요시간은 솔버 소유).
# 키 목록이 아니라 **부분 문자열 토큰**으로 본다: 정확 목록은 durationSec·visitMinutes·
# startAt 같은 변형에 항상 뚫린다 (denylist 완전성은 불가능하므로 넓게 잡고, 과잉 거부는
# 폴백=결정론 경로로 안전하게 수렴시킨다).
_TIME_KEY_TOKENS = (
    "time", "duration", "minute", "hour", "sec", "arrive", "depart", "startat", "endat",
)
# 정확일치 — 부분일치로 잡으면 무해한 키까지 걸리는 것들: eta는 metadata를,
# start·end는 startPoiId·endPoiId 같은 POI 참조 키를 오탐한다 (구 edit_agent의
# 맨몸 start·end 토큰이 실제로 오탐하던 범위 — 정확일치로 좁혀 커버는 유지).
_TIME_KEY_EXACT = frozenset({"eta", "start", "end"})

# POI를 가리키는 params 키 — 값은 반드시 후보 풀 안의 poiId (INV-1).
_POI_REF_TOKEN = "poiid"


def _normalize(key: str) -> str:
    return key.lower().replace("_", "").replace("-", "").replace(" ", "")


def is_time_param_key(key: str) -> bool:
    """편집 params의 시각·소요시간 키 판정 — 단일 검사기 (INV-2 시각 + INV-3).

    자연어 진입(이 게이트 ③)과 구조화 진입(agents.edit_agent.validate_command)이
    같은 이 함수를 호출한다 — 목록을 두 곳에 복사해 어긋났던 결함(edit_agent 쪽만
    eta·arriveBy·travelSecs 통과, invariant-reviewer 재현)의 재발을 구조로 막는다.
    """
    normalized = _normalize(key)
    return normalized in _TIME_KEY_EXACT or any(
        token in normalized for token in _TIME_KEY_TOKENS
    )


@dataclass(frozen=True, slots=True)
class EditTranslationContext:
    """게이트 검증 컨텍스트 — GatewayFacade.call의 pool 자리로 관통 (reflection_template 선례).

    대조 집합 2종을 **분리해** 싣는다 (TRIP-527 — 모듈 docstring ② 참조):
    - `pool`: 새로 넣는 POI의 자격 (INV-1 닫힌 후보 풀)
    - `current_slots`: 지목 가능한 기존 슬롯. 워커가 프롬프트에 렌더한 슬롯 목록
      그대로라, 모델이 본 것과 게이트가 허용하는 것이 어긋날 수 없다.
    """

    pool: CandidatePool
    current_slots: frozenset[PoiId]


class EditTranslationGate:
    """EDIT_TRANSLATION 출구 게이트 — {"editCommand": {op, params, affectedSlots}} 강제."""

    def apply(
        self,
        raw_text: str,
        pool: object,  # EditTranslationContext — pool 자리로 관통 (ExitGate 계약 호환)
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        if not isinstance(pool, EditTranslationContext):
            # 대조 집합이 둘이라 풀만으로는 ②를 판정할 수 없다 (TRIP-527)
            return GateOutcome(
                value=None,
                drop_event=None,
                error="gate_error: EditTranslationContext 없음 (풀·현재 슬롯 대조 집합 필요)",
            )
        ctx = pool
        try:
            op, params, slot_ids, param_refs = self._parse(raw_text)
        except ValueError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")

        # ② 대조 집합 2종 교차 — 하나라도 밖이면 명령 전체 드롭. 중복은 첫 등장만 채택
        #    (중복이 affected 수를 부풀려 반영 모드 판정을 흔드는 것 방지).
        unique: list[PoiId] = []
        for pid in slot_ids:
            if pid not in unique:
                unique.append(pid)
        unknown = tuple(pid for pid in unique if pid not in ctx.current_slots)
        outside = tuple(pid for pid in param_refs if not ctx.pool.contains(pid))
        if unknown or outside:
            reasons = []
            if unknown:
                reasons.append(f"unknown_slot: 현재 일정에 없는 슬롯 {len(unknown)}건")
            if outside:
                reasons.append(f"closed_set_violation: 풀 밖 poiId {len(outside)}건")
            return GateOutcome(
                value=None,
                drop_event=GateDropEvent(
                    trace_id=trace_id,
                    occurred_at=now,
                    component="c1.gate",
                    feature=feature.value,
                    dropped_ids=unknown + outside,
                    total_count=len(unique) + len(param_refs),
                    dropped_count=len(unknown) + len(outside),
                ),
                error=" / ".join(reasons) + " — 명령 전체 드롭",
            )

        command = EditCommand(op=op, params=params, affected_slots=tuple(unique))
        # 반영 모드는 코드가 확정 (M16-P2) — LLM의 applyMode 제안은 읽지 않는다.
        return GateOutcome(
            value=EditTranslation(command=command, apply_mode=resolve_apply_mode(command)),
            drop_event=None,
            error=None,
        )

    @staticmethod
    def _parse(raw_text: str) -> tuple[EditOp, dict, tuple[PoiId, ...], tuple[PoiId, ...]]:
        node = _load_json_object(raw_text, "editCommand")
        if node is None:
            # 번역 불가를 성공으로 위장하지 않는다 — 폴백 신호 (INV-4)
            raise ValueError("not_translatable: 편집 명령으로 번역 불가")
        if not isinstance(node, dict):
            raise ValueError("editCommand가 객체가 아님")
        # ① op closed-set — enum 밖 값은 폴백 신호 (환각 op로 편집을 시도하지 않는다)
        try:
            op = EditOp(node.get("op"))
        except (ValueError, TypeError):
            raise ValueError(f"op가 EditOp 밖: {node.get('op')!r}") from None
        params, param_refs = EditTranslationGate._parse_params(node.get("params"))
        raw_slots = node.get("affectedSlots")
        if raw_slots is None:
            raw_slots = []
        if not isinstance(raw_slots, list):
            raise ValueError("affectedSlots가 배열이 아님")
        slot_ids: list[PoiId] = []
        for i, value in enumerate(raw_slots):
            if not isinstance(value, str) or not value:
                raise ValueError(f"affectedSlots[{i}] 비정상")
            slot_ids.append(PoiId(value))
        return op, params, tuple(slot_ids), param_refs

    @staticmethod
    def _parse_params(raw: object) -> tuple[dict, tuple[PoiId, ...]]:
        """params 검사 — ③ 시각 키 거부 · ④ 평면 강제 · ② POI 참조 수집."""
        if raw is None:
            return {}, ()
        if not isinstance(raw, dict):
            raise ValueError("params가 객체가 아님")
        refs: list[PoiId] = []
        for key, value in raw.items():  # JSON 객체 키는 항상 str
            normalized = _normalize(key)
            if is_time_param_key(key):
                # 조용히 지우지 않고 명령을 거부한다 (침묵 수정 금지)
                raise ValueError(f"params에 시각·소요시간 필드: {key!r} — 시각은 솔버가 정함")
            if isinstance(value, (dict, list)):
                raise ValueError(f"params가 평면이 아님: {key!r} (중첩 검사 우회 차단)")
            if _POI_REF_TOKEN in normalized:
                if not isinstance(value, str) or not value:
                    raise ValueError(f"params의 POI 참조 {key!r}가 비정상")
                refs.append(PoiId(value))
        return raw, tuple(refs)
