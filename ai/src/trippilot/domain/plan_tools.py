"""도구 계획(DIALOGUE_PLAN, 2‴) 레지스트리 — 계획 LLM 이 고를 수 있는 읽기 전용 조회 도구의 **표 하나**
(assistant-orchestrator FD BR-AO-28 · DE §2.11).

도구를 새로 만들지 않는다. 도구 = 정보 핸들러다:
- 실행자: `orchestrator.dialogue_handlers.HANDLERS[intent]` (plan/assemble 그대로 — LLM 0, PlanB 는 use_llm=False)
- 인자 스키마: 인자표(`domain.dialogue.ARGUMENT_TABLE`)의 asked 인자 — 분류 `$intents` 와 **같은** `tool_specs`
- 여기서 손으로 쓰는 것: 도구마다 모델에게 보일 설명 한 줄과 쓰는 포트(`HandlerPorts` 칸 이름)뿐

도메인에 두는 이유: 프롬프트 변수(`$tools`)를 만드는 쪽(c1 워커·게이트)이 import 할 수 있어야 한다(L-1 — c1 은 orchestrator 를
import 하지 않는다). 포트 이름은 문자열로만 적고, 실제 배선 여부는 조립부(orchestrator·api)가 본다.

빼는 것(`NEVER_TOOLS`): 저장 경로로 이어지는 편집(EDIT_SCHEDULE — BE 제안·저장), 사실 없이 화면만 옮기는 넘기기 6종,
범위 밖. Provider 를 핸들러 없이 직접 도구로 내지 않는다 — 그러면 LLM 이 좌표·POI id 를 만들어야 하고 INV-1 이 깨진다.
새 능력은 Intent 멤버 · 인자표 행 · HANDLERS 행 · 여기 PLAN_TOOLS 행 넷을 더하면 프롬프트·게이트·실행이 따라온다.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass

from trippilot.domain.dialogue import ArgumentKind, asked_specs_of, tool_specs
from trippilot.domain.intent import DIALOGUE_INTENTS, Intent

MAX_PLAN_CALLS = 2  # 한 턴의 도구 호출 상한 — 팬아웃 1회(한 파, 병렬), 호출끼리 결과를 주고받지 않는다
MAX_ARG_CHARS = 40  # 인자 값 상한 — 발화에 나온 짧은 표현만(시각·연락처·주입 꼴은 게이트가 버린다)
# 도구로 답할 수 없는 말의 가장 가까운 분류 — **관측 전용** 닫힌 집합(다음 도구 우선순위 재료, 미결 #23).
# 화면·다음 프롬프트로 가지 않는다.
PLAN_GAPS: tuple[str, ...] = (
    "EVENTS", "REGION_WEATHER", "PLACE_DETAIL", "TRANSPORT", "AMENITY", "BOOKING", "LODGING",
    "KNOWLEDGE", "ACCOUNT", "CHAT", "OTHER",
)
NEVER_TOOLS: frozenset[Intent] = frozenset({
    Intent.EDIT_SCHEDULE, Intent.GENERATE_SCHEDULE, Intent.REGENERATE, Intent.REPLAN,
    Intent.GENERATE_REFLECTION, Intent.TRIP_SUMMARY, Intent.STYLE_ANALYSIS, Intent.OUT_OF_SCOPE,
})
_SUMMARY_MAX = 80


@dataclass(frozen=True, slots=True)
class PlanTool:
    summary: str  # 모델에게 보일 "무엇을 돌려주나 · 못 하는 것" 한 줄 (1..80자)
    needs: tuple[str, ...] = ()  # 쓰는 `HandlerPorts` 칸 — 하나라도 미배선이면 노출하지 않는다(늘 UNAVAILABLE 로 끝날 계획을 막는다)
    # 인자표에는 있지만 핸들러가 읽지 않는 인자 — 광고(`$tools`)에서도 게이트 허용 키에서도 뺀다. 광고하면 모델이 채우고 핸들러는
    # 버려, 다른 질문의 답이 나간다(GET_WEATHER period: "주말에 비 오면"에 오늘 강수확률, 2026-10-19 코드 대조 실측)
    hide: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not 1 <= len(self.summary) <= _SUMMARY_MAX or "\n" in self.summary:
            raise ValueError(f"PlanTool.summary 는 한 줄 1..{_SUMMARY_MAX}자: {self.summary!r}")


PLAN_TOOLS: Mapping[Intent, PlanTool] = {
    Intent.SHOW_SCHEDULE: PlanTool("여행 일정표 — 날짜별 장소와 계획 시각(전체·남은 것·하루)"),
    Intent.GET_NEXT_SLOT: PlanTool("지금 이후 다음 일정 한 곳과 그 계획 시각"),
    Intent.GET_WEATHER: PlanTool("일정 장소 기준 날짜 하루만의 최대 강수확률 — 주말·기간은 못 본다, 기온·바람·다른 지역 날씨도 없다",
                                 ("poi_info", "weather"), hide=("period",)),
    Intent.GET_DISTANCE: PlanTool("일정 안 한 장소까지 바로 앞 일정에서의 거리 — 소요시간은 없다", ("poi_info", "transit")),
    Intent.GET_POI_INFO: PlanTool("일정 안 장소의 분류·영업시간·입장료 — 일정 밖 장소는 못 찾는다", ("poi_info",)),
    Intent.SUGGEST_ALTERNATIVE: PlanTool("일정의 한 곳 대신 갈 근처 등록 장소 최대 5곳", ("poi_info", "pool_builder", "planb")),
    Intent.EXPLORE_PLACES: PlanTool("지역 또는 일정 근처의 등록 장소 최대 5곳(명소·맛집·카페·야경·자연·쇼핑·문화·액티비티, "
                                    "요즘 인기 우선) — 예약·가격·생활 시설은 없다", ("pool_builder",)),
}


def validate_plan_tools(tools: Mapping[Intent, PlanTool]) -> None:
    """도구 표의 기동 검사 — 도우미 의도 안 · 쓰기·넘기기 없음 · 인자는 전부 문자열 스칼라(게이트가 값을 문자열 하나로만 받는다)."""
    outside = set(tools) - DIALOGUE_INTENTS
    if outside:
        raise ValueError(f"도구는 도우미 의도만: {sorted(i.value for i in outside)}")
    never = set(tools) & NEVER_TOOLS
    if never:
        raise ValueError(f"쓰기·넘기기 의도는 도구가 될 수 없다: {sorted(i.value for i in never)}")
    for intent, tool in tools.items():
        for spec in asked_specs_of(intent):
            if spec.multiple or spec.kinds[0] is ArgumentKind.COUNT:
                raise ValueError(f"도구 인자는 문자열 스칼라만: {intent.value}.{spec.name}")
        asked = {s.name: s for s in asked_specs_of(intent)}
        for name in tool.hide:  # 숨길 수 있는 것은 묻는 선택 인자뿐 — 필수를 숨기면 그 도구는 영영 못 부른다
            if name not in asked or asked[name].required:
                raise ValueError(f"숨길 인자는 묻는 선택 인자만: {intent.value}.{name}")


validate_plan_tools(PLAN_TOOLS)
if set(PLAN_TOOLS) | NEVER_TOOLS != DIALOGUE_INTENTS | {Intent.OUT_OF_SCOPE}:  # 의도가 늘면 도구인지 아닌지 정해야 기동한다
    raise ValueError("도우미 의도는 전부 PLAN_TOOLS 또는 NEVER_TOOLS 에 있어야 한다")


def plan_argument_names(intent: Intent) -> frozenset[str]:
    """계획 게이트가 받는 인자 키 — 인자표의 asked 인자에서 숨긴 인자를 뺀 것(광고하는 키와 같은 집합)."""
    return frozenset(s.name for s in asked_specs_of(intent)) - set(PLAN_TOOLS[intent].hide)


def plan_tool_specs_json(descriptions: Mapping[Intent, str]) -> str:
    """`$tools` — parameters 는 분류 `$intents` 와 같은 `tool_specs`(한 표)에서 숨긴 인자만 빼고, description 만 도구 설명으로
    바꿔 낀다. 결정론(의도 이름순 · sort_keys). 배포마다 고정이라 프롬프트 고정부(벤더 캐시 접두)에 실린다."""
    specs = []
    for spec in tool_specs(frozenset(descriptions)):
        intent = Intent(spec["name"])
        hidden = set(PLAN_TOOLS[intent].hide)
        params = {**spec["parameters"],
                  "properties": {k: v for k, v in spec["parameters"]["properties"].items() if k not in hidden}}
        specs.append({**spec, "parameters": params, "description": descriptions[intent]})
    return json.dumps(specs, ensure_ascii=False, sort_keys=True)
