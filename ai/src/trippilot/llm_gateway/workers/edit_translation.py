"""EditTranslationWorker — 편집 발화 → EditCommand 초안 번역 (경량 티어).

EditAgent 전속 도구 `llm.translate_edit` (BR-AF-08). **이미 EDIT_SCHEDULE로 확정된**
의도의 세부만 번역한다 — 라우팅 재해석이 아니다 (DL-3·BR-AF-02).
context_refs 재조회(D31)는 봉투 프로토콜상 EditAgent가 이미 수행하므로, 워커는
확정된 입력(발화·날짜·현재 슬롯·후보 풀)만 받는다 — 여기서 개인 데이터를 다시 끌어오지 않는다.

실패·게이트 드롭이면 폴백 TypedResult를 그대로 반환 (BR-U4-09) — 수동 편집 안내 등
후속 처리는 호출측(EditAgent) 몫이고, 침묵 실패는 없다 (INV-4).
실제 반영·어셈블리 검증은 이 티켓 범위 밖 (INV-2 — 시각·순서는 어셈블리가 확정).
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime

# 제3자 문자열(웹 수집 상호명·위키 발췌·네이버 스니펫)은 줄에 넣기 전에 한 줄로 누른다 —
# 줄바꿈이 남으면 우리 프롬프트 골격을 위조한다 (inline() docstring 에 실측).
from trippilot.llm_gateway.prompts import inline
from trippilot.llm_gateway.gates.edit_translation import EditTranslationContext
from trippilot.llm_gateway.gates.reminder_copy import _display_form
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.edit import TRANSLATABLE_OPS, EditOp
from trippilot.domain.llm import CandidatePool, LlmFeature, TypedResult
from trippilot.domain.poi import Poi

# op 별 뜻과 채울 자리. 이름만 주입하던 동안(0.1.0) 모델은 "카페 하나 추가해줘" 를
# ADD_SLOT 으로 잇지 못하고 전 모델이 번역 불가를 냈다(2026-10-14 실측 12발화 중
# 추가·종류 교체 4건이 4개 조합 전부). 표가 EditOp 전원을 덮는지는 테스트가 고정한다.
_OP_GUIDE: dict[EditOp, str] = {
    EditOp.ADD_SLOT: "후보 1곳을 그 날에 추가 — params.targetPoiId=후보 poiId, affectedSlots=[]",
    EditOp.REMOVE_SLOT: "기존 슬롯 삭제 — affectedSlots=[뺄 슬롯 poiId]",
    EditOp.MOVE_SLOT: (
        "기존 슬롯 1곳의 순서 이동 — affectedSlots=[옮길 슬롯 poiId], 그리고 "
        "params.afterPoiId=옮긴 뒤 바로 앞에 올 현재 슬롯 poiId 또는 "
        "params.beforePoiId=바로 뒤에 올 현재 슬롯 poiId 중 정확히 하나"),
    EditOp.REPLACE_SLOT: (
        "기존 슬롯 1곳을 후보로 교체 — affectedSlots=[바꿀 슬롯 poiId], "
        "params.targetPoiId=후보 poiId"),
    EditOp.REORDER_DAY: "그 날 순서 재배열 — affectedSlots=그 날 슬롯 전부를 새 순서대로",
    EditOp.CLEAR_DAY: "그 날 일정 전부 비우기 — affectedSlots=[]",
    EditOp.REPLAN: "위 op 로 표현할 수 없는 일정 전반의 재구성 요청",
}

# 후보는 카테고리마다 풀 순위(영업시간 보유 → 인기) 앞에서 이만큼만 싣는다. 풀은 앵커
# 반경 전량이라 큰 지역에선 1,300곳·74k자였고(2026-10-14 실측), 번역이 쓰는 건 그중
# 한 곳이다. 상한 이하인 풀은 렌더가 그대로다(테스트 고정).
_CANDIDATES_PER_CATEGORY = 40
# 상한 밖이라도 발화에 이름이 든 후보는 따로 싣는다 — 상한만 두던 동안 이름으로 찾는 요청("효창공원을 경리단길
# 끝나고 넣어줘")은 그곳이 상한 밖이면 번역 불가였다. 풀 안에서만 고르니 INV-1 은 그대로(게이트·validate_command
# 무변경)고, 그런 이름이 없으면 렌더는 바이트까지 같다(테스트 고정). 따로 싣는 수는 풀 순위 앞 이만큼 — 한 말이
# 집는 곳은 한두 곳인데 같은 이름이 한 시군구에 여럿이라(공유본 최대 4곳 '돌하르방식당', 2026-10-30 측정) 그 묶음은
# 담고, 줄당 ≈57자(위 74k자/1,300곳)라 5줄이 ≈290자다.
# ponytail: 풀 밖(기본 풀 5,000곳 절단)은 여전히 못 싣는다 — 등록 장소 이름 조회(대화의
# `PlaceSqlLookup.find_place` 와 같은 길)나 구간 풀(`EditTask.segment_pool`) 합류가 필요하고, 그때는
# validate_command 의 풀 소속 검사(INV-1)도 합친 풀로 봐야 한다.
_NAMED_EXTRA = 5
# 이름 대조 — planb `request_verification.normalize`·편집 `insert_between._norm` 과 같은 꼴(하위 계층이라 agents 를
# import 못 한다 L-1 — 고치면 셋 다). 이름은 표시형(괄호 부기·뒤 로마자를 뗀 것, 알림 게이트와 같은 규칙)으로 본다 —
# 공유본 이름의 7.2%가 다르다("성불사(울릉)"·"자이소 JAISO"). 두 글자 이하는 흔한 말이 상호라(공유본 5.0%:
# "카페"·"정원"·"하루"·"숲") 발화에 우연히 든다 — 세 글자("마라도"·"쇠소깍")부터 본다.
_NAME_NOISE = re.compile(r"[\s\-·.,'\"()\[\]]+")
_MIN_NAME_CHARS = 3


def _norm(text: str) -> str:
    return _NAME_NOISE.sub("", text).lower()


def _named_beyond_cap(over: list[Poi], utterance: str, slot_names: list[str]) -> list[Poi]:
    """상한 밖 후보 중 발화에 이름(표시형)이 든 곳 — 풀 순위 앞 `_NAMED_EXTRA` 곳.

    현재 슬롯과 이름이 같은 곳(출처만 다른 쌍둥이 — 공유본에 200m 안 같은 이름 짝이 1,230쌍)은 뺀다: 슬롯을 가리킨
    말("도두봉 빼줘")에 같은 이름이 두 목록에 뜨면 번역이 후보 쪽 id 를 집을 수 있다(그러면 게이트가 명령을 버린다)."""
    said = _norm(utterance)
    taken = {_norm(_display_form(name)) for name in slot_names}
    named = [p for p in over if len(key := _norm(_display_form(p.name))) >= _MIN_NAME_CHARS
             and key in said and key not in taken]
    return named[:_NAMED_EXTRA]


@dataclass(frozen=True, slots=True)
class EditTranslationInput:
    """번역 입력 — 발화는 뉘앙스 참고 전용(재해석 금지, DL-3)."""

    utterance: str
    target_date: str  # 서버 확정 표시 문자열 (예: "2026-08-10")
    current_slots: tuple[PoiId, ...]  # 현재 일정 순서 (poiId만)
    # 현재 슬롯의 표시 정보 — 호출측이 이미 들고 있는 등록 POI(백엔드 find_by_ids).
    # 풀에서 찾지 않는 이유는 TRIP-527: 풀은 요청마다 잘리는 조각이라 현재 슬롯이
    # 풀 밖일 수 있다. 없는 슬롯은 이름을 지어내지 않고 "(정보 없음)"으로 남는다.
    slot_pois: Mapping[PoiId, Poi] = field(default_factory=dict)


def build_edit_translation_vars(
    pool: CandidatePool, inp: EditTranslationInput
) -> dict[str, str]:
    """값 전부 str·결정론(후보는 poi_id 정렬)·좌표 미포함 (G181, PROMPT-P1 계열).

    현재 슬롯 렌더는 풀이 아니라 **호출측이 넘긴 슬롯 정보**를 쓴다 (TRIP-527) —
    풀은 요청마다 잘리는 조각이라 원 일정의 슬롯이 풀 밖인 것은 정상이고, 그걸
    호출측 버그로 보고 raise 하면 편집 경계가 422로 죽는다(백엔드는 4xx를 최소본
    폴백 신호로 쓴다). 이름·카테고리를 모르면 지어내지 않고 "(정보 없음)".
    """
    by_id = {p.poi_id: p for p in pool.pois}
    by_id.update(inp.slot_pois)  # 호출측 정보 우선 — 슬롯의 등록 원본
    slot_lines = []
    for order, pid in enumerate(inp.current_slots, start=1):
        poi = by_id.get(pid)
        slot_lines.append(
            f"{order}. {pid} | {poi.category.value} | {inline(poi.name)}"
            if poi is not None
            else f"{order}. {pid} | (정보 없음)"
        )
    in_use = set(inp.current_slots)
    kept: list[Poi] = []
    over: list[Poi] = []
    per_category: dict = {}
    for p in pool.pois:  # 풀 순서 = 순위
        if p.poi_id in in_use:
            continue
        n = per_category.get(p.category, 0)
        if n < _CANDIDATES_PER_CATEGORY:
            per_category[p.category] = n + 1
            kept.append(p)
        else:
            over.append(p)
    kept += _named_beyond_cap(over, inp.utterance, [by_id[pid].name for pid in inp.current_slots if pid in by_id])
    candidate_lines = [
        f"- {p.poi_id} | {p.category.value} | {inline(p.name)}"
        for p in sorted(kept, key=lambda p: str(p.poi_id))
    ]
    return {
        "utterance": inline(inp.utterance).strip() or "(발화 없음)",
        "target_date": inp.target_date or "미지정",
        # 편집 op closed-set을 서버가 주입 (정본 §2.4) — enum 순서라 결정론
        "edit_ops": "\n".join(f"- {op.value}: {_OP_GUIDE[op]}" for op in TRANSLATABLE_OPS),
        "slots": "\n".join(slot_lines) or "(슬롯 없음)",
        "candidates": "\n".join(candidate_lines) or "(후보 없음)",
    }


class EditTranslationWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def translate(
        self,
        pool: CandidatePool,
        inp: EditTranslationInput,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult:
        # 호출측 예산이 게이트웨이 타임아웃까지 **관통** (TRIP-381 — 점수·설명과 동형).
        # 미관통이면 기본 2.5s가 실호출(바닥 ~3s)을 항상 잘라 자연어 편집이 전멸한다
        # (TRIP-431 실측: 직접 호출 성공 · 경계 호출 TRANSLATION_FAILED).
        return self._gateway.call(
            LlmFeature.EDIT_TRANSLATION,
            build_edit_translation_vars(pool, inp),
            # pool 자리 = 게이트 대조 집합 2종 (TRIP-527): 새로 넣는 POI는 풀(INV-1),
            # 기존 슬롯 지목은 현재 슬롯. 프롬프트에 렌더한 목록 그대로 넘기므로
            # "모델이 본 슬롯"과 "게이트가 허용하는 슬롯"이 어긋날 수 없다.
            EditTranslationContext(
                pool=pool, current_slots=frozenset(inp.current_slots)),
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
