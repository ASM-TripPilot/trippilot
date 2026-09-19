"""AlternativeSelectionWorker — Plan-B 대체지 선택, 상위 티어 (planb-rag-design §3 [4]).

PlanBAgent 전속 도구 `llm.select_alternatives`. 개인 컨텍스트(선호·저장 장소)는
ContextResolver 재조회가 아니라 **KB-2 검색 결과 발췌**로 들어온다 — RAG 설계상
검색·조립은 PlanBAgent(호출측) 소유이고 (planb-rag-design §5.2), 워커는 이미
확정된 문자열 발췌만 받는다 (edit_translation 워커와 같은 전제).

실패·게이트 드롭이면 폴백 TypedResult를 그대로 반환 (BR-U4-09) — 규칙 랭킹
폴백의 실행은 호출측(PlanBAgent) 몫이고, 침묵 실패는 없다 (INV-4).
선택 순서는 제안일 뿐, 배치·시각 확정은 어셈블리 소유 (INV-2).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime

# 제3자 문자열(웹 수집 상호명·위키 발췌·네이버 스니펫)은 줄에 넣기 전에 한 줄로 누른다 —
# 줄바꿈이 남으면 우리 프롬프트 골격을 위조한다 (inline() docstring 에 실측).
from trippilot.llm_gateway.prompts import inline
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, TypedResult
from trippilot.domain.poi import Poi


@dataclass(frozen=True, slots=True)
class AlternativeSelectionInput:
    """선택 입력 — 컨텍스트 3종은 KB 검색 발췌(줄 단위 텍스트), 조립은 호출측 몫."""

    trigger_kind: str  # TriggerKind.value (예: "WEATHER")
    reason: str  # weather|closed|delay|canceled|fully_booked|fatigue|none
    schedule_context: str  # KB-1 발췌 — 영향 슬롯·일정
    situation_context: str  # KB-3 발췌 — 상황 대응 지식
    persona_context: str  # KB-2 발췌 — 선호·저장 장소
    max_alternatives: int
    excluded_poi_ids: frozenset[PoiId] = frozenset()  # 이미 방문·거절한 POI
    # KB-5 장소 지식 — {source_ref: 문서}. 후미 기본값이라 기존 호출 전부 무영향.
    # **후보 자격과 무관하다**(INV-1 은 closed_set_filter 소유) — 후보 줄에 설명을
    # 한 칸 더 붙일 뿐이고, 문서가 없는 후보는 칸 자체가 안 생긴다.
    place_knowledge: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.max_alternatives < 1:
            raise ValueError("max_alternatives ≥ 1")


def _category_label(poi: Poi) -> str:
    """대분류 + 세분류. 8종으로는 못 가르는 축을 모델에게 주는 유일한 자리다.

    우천 판정표가 FOOD·SIGHT 를 중립으로 두는 근거가 "실내외 혼재"인데
    (`assembly_engine/config.py`), 그 혼재를 푸는 것이 세분류다 — 명소 3,942곳에
    섞인 `유적지/사적지`(야외)와 `박물관`(실내)이 여기서 갈린다.
    """
    return "·".join((poi.category.value, *poi.tags))


def _candidate_line(poi: Poi, knowledge: Mapping[str, str]) -> str:
    """후보 한 줄. 장소 지식(KB-5)이 있으면 넷째 칸으로 붙는다.

    **문서가 없으면 칸 자체를 안 만든다.** 빈 칸을 남기면 모델이 그 공백을 결격으로
    읽는다 — 원천 커버리지가 균일하지 않아(위키백과 실측 문화 25% ↔ 카페 2.5%)
    문서 없는 후보가 다수인 구간이 정상이다. 그 사실은 프롬프트가 따로 말한다.
    """
    line = f"- {poi.poi_id} | {_category_label(poi)} | {inline(poi.name)}"
    doc = knowledge.get(poi.source_ref or "")
    # KB-5 문서는 위키백과 본문이다 — 문단 구분 줄바꿈이 **정상적으로** 들어 있어
    # 누르지 않으면 후보 한 줄이 여러 줄로 터진다(실측: 마크다운 제목까지 열린다).
    return f"{line} | {inline(doc)}" if doc else line


def build_alternative_selection_vars(
    pool: CandidatePool, inp: AlternativeSelectionInput
) -> dict[str, str]:
    """값 전부 str·결정론(후보는 poi_id 정렬)·좌표 미포함 (G181, PROMPT-P1 계열).

    후보는 poi_id·카테고리·상호명만 — 제외 POI는 목록에서 아예 빠져 모델이 고를 수
    있는 값 자체를 한정한다 (INV-1). 그래도 새는 참조는 게이트 + 호출측
    `closed_set_filter`가 이중으로 막는다.

    카테고리 칸에는 세분류(`Poi.tags`)가 있으면 이어 붙는다 — `FOOD·음식점·한식`.
    **칸을 새로 만들지 않는 이유**: 태그는 카테고리를 쪼갠 것이지 다른 축이 아니고,
    칸을 늘리면 프롬프트 골격이 바뀌어 버전을 올려야 하는데 정작 백엔드가 태그를
    노출하기 전까지는 그 칸이 항상 비어 있다(없는 칸을 설명하는 프롬프트가 된다).
    """
    candidates = "\n".join(
        _candidate_line(p, inp.place_knowledge)
        for p in sorted(pool.pois, key=lambda p: str(p.poi_id))
        if p.poi_id not in inp.excluded_poi_ids
    )
    return {
        "trigger_kind": inp.trigger_kind,
        "reason": inp.reason,
        "schedule_context": inp.schedule_context.strip() or "(검색 결과 없음)",
        "situation_context": inp.situation_context.strip() or "(검색 결과 없음)",
        "persona_context": inp.persona_context.strip() or "(검색 결과 없음)",
        "candidates": candidates or "(후보 없음)",
        "max_alternatives": str(inp.max_alternatives),
    }


class AlternativeSelectionWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def select(
        self,
        pool: CandidatePool,
        inp: AlternativeSelectionInput,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
        retry_timeout_sec: float | None = None,
    ) -> TypedResult:
        """`timeout_sec` 미지정이면 게이트웨이 기본(`C1Config.timeout_sec`, 현재 10s).
        `retry_timeout_sec` 는 1차 타임아웃 시 재시도 모델(`C1Config.retry_models`)의
        예산 — 없으면 재시도 없이 폴백 신호다(TRIP-522 2단 폴백).

        **호출측이 요청 예산에서 몫을 떼 넘기는 것이 정상 경로다** — `PlanBAgent`
        이 `deadline_ms × llm_budget_share` 로 계산해 준다(BR-U4-04 "요청 예산의 절반
        이하", TRIP-376 과 같은 관통 방식). 기본값은 예산이 없을 때의 안전망이다.

        이 통로가 없던 시절(~2026-09-01) 기본값은 2.5s 였고, `gpt-5.6-sol` 실측이
        5.1s 라 **컨테이너에서 100% 타임아웃해 Plan-B 가 항상 규칙 폴백으로 떨어졌다.**
        응답은 200 이라 증상이 안 보였다 — 폴백이 답을 채우기 때문이다. 그래서
        마감을 판단할 때는 성공/실패가 아니라 `fallback_level` 을 본다.
        """
        return self._gateway.call(
            LlmFeature.ALTERNATIVE_SELECTION,
            build_alternative_selection_vars(pool, inp),
            pool,  # selections 풀 교차 대상 (INV-1)
            trace_id,
            now,
            timeout_sec=timeout_sec,
            retry_timeout_sec=retry_timeout_sec,
        )
