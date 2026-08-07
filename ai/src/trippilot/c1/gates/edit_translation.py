"""EDIT_TRANSLATION 출구 게이트 (정본 §2.4 + agent-foundation FD §1).

번역 결과는 **명령 1건**이라 항목 격리(place_extraction 선례)가 성립하지 않는다 —
affectedSlots 일부만 살리면 명령의 의미가 바뀌므로, 풀 밖 ID가 하나라도 있으면
명령 전체를 드롭한다 (부분 반영 금지).

검증 4종:
  ① op ∈ EditOp (closed-set — enum 밖 값은 명령 자체가 존재 불가)
  ② POI 참조 ⊆ 후보 풀 (INV-1 풀 교차, explanation 게이트 선례) —
     affectedSlots뿐 아니라 **params의 `*PoiId` 키**까지 (REPLACE_SLOT의 대상 POI가
     params로 새는 경로 차단). POI "이름" 문자열은 교차 대상이 아니다 — 이름 해소는
     코드(fuzzy match, AI-D04) 몫이고 그 지점에서 다시 풀 교차된다.
  ③ params에 시각·소요시간 필드 없음 (INV-3 + INV-2의 시각 측면 — 시각은 솔버 소유).
     순서·위치 제안은 허용한다: 워커는 제안만 하고 확정은 솔버라는 INV-2 원문 그대로,
     "3번째로 옮겨줘"의 위치는 사용자 요구지 확정 시각이 아니다.
  ④ params는 평면 객체 (중첩 dict·list 금지) — 중첩으로 ②③ 검사를 우회하지 못한다.
그리고 apply_mode는 LLM 제안을 버리고 코드가 확정한다 (하이브리드 AI-D02):
`domain.edit.resolve_apply_mode` 재사용 — 게이트는 판정 로직을 새로 만들지 않는다.
번역 불가(`{"editCommand": null}`)는 성공으로 위장하지 않고 폴백 신호로 낸다 (INV-4).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from trippilot.c1.gates.base import GateOutcome, _load_json_object
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.edit import ApplyMode, EditCommand, EditOp, resolve_apply_mode
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent

# INV-2(시각)·INV-3 방어 — 편집 명령은 "무엇을"만 표현한다 (시각·소요시간은 솔버 소유).
# 키 목록이 아니라 **부분 문자열 토큰**으로 본다: 정확 목록은 durationSec·visitMinutes·
# startAt 같은 변형에 항상 뚫린다 (denylist 완전성은 불가능하므로 넓게 잡고, 과잉 거부는
# 폴백=결정론 경로로 안전하게 수렴시킨다).
_TIME_KEY_TOKENS = (
    "time", "duration", "minute", "hour", "sec", "arrive", "depart", "startat", "endat",
)
_TIME_KEY_EXACT = frozenset({"eta"})  # 부분일치로 잡으면 metadata 등 무해한 키까지 걸린다

# POI를 가리키는 params 키 — 값은 반드시 후보 풀 안의 poiId (INV-1).
_POI_REF_TOKEN = "poiid"


def _normalize(key: str) -> str:
    return key.lower().replace("_", "").replace("-", "").replace(" ", "")


def _is_time_key(normalized: str) -> bool:
    return normalized in _TIME_KEY_EXACT or any(
        token in normalized for token in _TIME_KEY_TOKENS
    )


@dataclass(frozen=True, slots=True)
class EditTranslation:
    """번역 결과 = 명령 초안 + **코드가 확정한** 반영 모드.

    LLM이 제안한 applyMode는 여기 도달하지 못한다 (게이트가 버리고 재계산).
    솔버 검증·실제 반영은 EditAgent(U5) 몫 — 이 타입은 초안까지다 (INV-2).
    """

    command: EditCommand
    apply_mode: ApplyMode

    def to_dict(self) -> dict:
        return {"command": self.command.to_dict(), "applyMode": self.apply_mode.value}

    @classmethod
    def from_dict(cls, d: dict) -> "EditTranslation":
        return cls(
            command=EditCommand.from_dict(d["command"]),
            apply_mode=ApplyMode(d["applyMode"]),
        )


class EditTranslationGate:
    """EDIT_TRANSLATION 출구 게이트 — {"editCommand": {op, params, affectedSlots}} 강제."""

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
            return GateOutcome(value=None, drop_event=None, error="gate_error: 후보 풀 없음")
        try:
            op, params, slot_ids, param_refs = self._parse(raw_text)
        except ValueError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")

        # ② 풀 교차 (INV-1) — 하나라도 밖이면 명령 전체 드롭. 중복은 첫 등장만 채택
        #    (중복이 affected 수를 부풀려 반영 모드 판정을 흔드는 것 방지).
        unique: list[PoiId] = []
        for pid in slot_ids:
            if pid not in unique:
                unique.append(pid)
        checked = [*unique, *(pid for pid in param_refs if pid not in unique)]
        outside = tuple(pid for pid in checked if not pool.contains(pid))
        if outside:
            return GateOutcome(
                value=None,
                drop_event=GateDropEvent(
                    trace_id=trace_id,
                    occurred_at=now,
                    component="c1.gate",
                    feature=feature.value,
                    dropped_ids=outside,
                    total_count=len(checked),
                    dropped_count=len(outside),
                ),
                error=f"closed_set_violation: 풀 밖 poiId {len(outside)}건 — 명령 전체 드롭",
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
            if _is_time_key(normalized):
                # 조용히 지우지 않고 명령을 거부한다 (침묵 수정 금지)
                raise ValueError(f"params에 시각·소요시간 필드: {key!r} — 시각은 솔버가 정함")
            if isinstance(value, (dict, list)):
                raise ValueError(f"params가 평면이 아님: {key!r} (중첩 검사 우회 차단)")
            if _POI_REF_TOKEN in normalized:
                if not isinstance(value, str) or not value:
                    raise ValueError(f"params의 POI 참조 {key!r}가 비정상")
                refs.append(PoiId(value))
        return raw, tuple(refs)
