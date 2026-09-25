"""인자표 — 의도별로 "발화에서 무엇을 뽑아야 하는가" 의 정본.

`assistant-dialogue` FD §2 (`ai/aidlc-docs/construction/assistant-dialogue/functional-design/`).

**이 표 하나가 두 곳의 재료다** — 도구 호출 스키마(`tool_specs`)와 규칙 추출기 대상 목록.
따로 적으면 반드시 갈라진다. 지금 3차 프롬프트가 쓰는 의도 무관 3칸(`date`·`category`·
`constraint`, `prompts/intent.yaml`)을 대체한다.

**표는 계약 문서가 아니라 코드에 대고 만들었다** (BR-DLG-00). 초안을 `agent-io-contracts.md`
기준으로 썼더니 의도 13종이 **전부** 실제 핸들러와 달랐다(2026-09-19 실측) — 계약과 코드가
갈라져 있었고 표는 계약 쪽만 보고 있었다. 그래서 각 인자에 `lands_in`(실제로 들어가는 코드 필드)
을 달고, 그것이 `None` 인 인자는 **필수가 될 수 없게** 막는다.

판정 기준은 하나다 — **그 값이 없으면 처리자가 일을 시작조차 못 하는가.**
오케스트레이터가 수집하는 것(후보 풀·페르소나·날씨·예산·시한)과 `context_refs` 재조회로
메울 수 있는 것은 인자가 아니다. 그래서 **필수 인자는 13종 중 4종에만 있다** — 도우미는
여행 화면에서 호출되고 지역·기간·예산·동행은 전부 여행 기록에서 온다.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from enum import Enum

from trippilot.domain.common import BudgetLevel, TransportMode
from trippilot.domain.edit import EditOp
from trippilot.domain.intent import ROUTABLE_INTENTS, Intent
from trippilot.domain.persona import CompanionType
from trippilot.domain.trigger import ReplanScope


class ArgumentKind(Enum):
    """인자의 종류 — **추출기는 의도가 아니라 이 종류마다 하나**다.

    같은 `date` 를 의도마다 다른 정규식으로 뽑으면 한 곳만 고친 드리프트가 난다.
    """

    DATE = "DATE"  # 하루 — 오늘·내일·글피·9월 20일
    DATE_RANGE = "DATE_RANGE"  # 기간 — 3박 4일·20일부터 23일까지·이번 주말
    REGION = "REGION"  # 여행지·행정구역 — 여수·제주
    PLACE_REF = "PLACE_REF"  # 장소를 가리키는 **문자열** (POI id 아님) — 경복궁
    SLOT_REF = "SLOT_REF"  # 일정 안의 항목 지시 — 둘째 날 점심·다음 일정
    ORDINAL = "ORDINAL"  # 순번 — 2일 차·세 번째
    COUNT = "COUNT"  # 개수 — 두 곳·3개
    ENUM = "ENUM"  # 자체 closed-set 어휘를 갖는 인자
    FREE_TEXT = "FREE_TEXT"  # 규칙으로 못 뽑는 자유 서술


# 받을 칸이 아직 합의되지 않은 자리 — `None`(받을 칸이 없음이 확인된 것)과 구분한다.
# 전자는 필수가 될 수 있고 후자는 될 수 없다.
BACKEND_PENDING = "백엔드 봉투 (미합의 — business-rules 미결 #13)"

# 설명문에서 **첫 문장**을 자르는 경계 — 한국어 종결("…다."), 일반 마침표, 그리고
# 근거를 덧붙일 때 쓰는 em 대시. `ArgumentSpec.headline` 참조.
_HEADLINE = re.compile(r"(?<=다)\.\s|\.\s|\s—\s")


@dataclass(frozen=True, slots=True)
class ArgumentSpec:
    """인자 하나의 규격.

    `kinds` 가 튜플인 이유: `target`·`origin`·`destination` 은 `SLOT_REF`("다음 목적지까지")와
    `PLACE_REF`("{장소}까지")가 **둘 다 실제로 나온다**. 한 칸으로 적으면 추출기 선택과
    도구 스키마 파생이 서로 다른 답을 낸다. 추출기는 **순서대로 시도하고 먼저 걸리는 것**을 쓴다.
    """

    name: str
    kinds: tuple[ArgumentKind, ...]
    required: bool
    description: str
    # ENUM 일 때의 어휘. **비어 있으면 "아직 타입이 아니다"** — 코드에 enum 이 없고 주석 어휘뿐.
    choices: tuple[str, ...] = ()
    # 처리자가 목록으로 받는가. REPLAN 은 `reasons: list[str]`, SUGGEST_ALTERNATIVE 는 `reason: str`
    # — 같은 이름을 복사하면 복수 사유가 조용히 잘린다.
    multiple: bool = False
    # 같은 그룹의 인자는 **하나만 차면 그룹이 충족된다.** EDIT_SCHEDULE 은 "day 가 있거나
    # target 이 한 날짜로 해소되거나" 중 하나면 착수한다 — bool 로는 못 적는 조건이다.
    requires_group: str | None = None
    # 이 값이 실제로 들어가는 코드 필드. **None = 받을 칸이 없음(확인됨)** — 뽑아도 버려진다.
    lands_in: str | None = None
    # 라우터가 **물어도 되는** 인자인가. 받을 칸은 있는데 **정하는 주인이 따로 있는** 경우
    # `False` 다 — `lands_in is None`(칸이 없다)과 이유가 다르므로 따로 적는다.
    # 지금 해당하는 것은 `EDIT_SCHEDULE.op` 하나다(그 행의 근거 참조).
    asked_by_router: bool = True

    def asked(self) -> bool:
        """3차 프롬프트·도구 스키마에 실을 인자인가.

        두 가지를 합친 것이다 — 값이 버려지거나(`lands_in is None`) 주인이 따로 있으면
        **묻지 않는다.** 묻는 순간 토큰을 쓰고 모델에게 지어낼 자리를 주는데 결과는 버려진다.
        """
        return self.asked_by_router and self.lands_in is not None

    def headline(self) -> str:
        """설명문의 **첫 문장** — 모델에게 보여 줄 몫.

        `description` 은 사람이 읽는 설계 근거까지 담는다("라우터가 정하면 더 적은 정보로
        더 이른 자리에서 같은 판단을 하는 것이다"). 그걸 프롬프트에 실으면 잡음이고, 모델용
        문구를 따로 두면 **두 벌이 되어 갈라진다.** 첫 문장만 잘라 쓰면 한 벌로 둘 다 된다
        — 표를 쓸 때 "첫 문장은 무엇인가를, 나머지는 왜인가를 적는다"만 지키면 된다.
        """
        return _HEADLINE.split(self.description, maxsplit=1)[0]

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("인자 이름이 비었다")
        if not self.kinds:
            raise ValueError(f"{self.name}: kinds 가 비었다")
        if len(set(self.kinds)) != len(self.kinds):
            raise ValueError(f"{self.name}: kinds 에 중복이 있다")
        if self.choices and ArgumentKind.ENUM not in self.kinds:
            raise ValueError(f"{self.name}: choices 는 ENUM 인자에만 쓴다")
        # 받을 칸이 없는 값을 필수로 두면 **되묻기가 발생하고 채워도 버려진다** (FD §2.0 ⑤)
        if self.required and self.lands_in is None:
            raise ValueError(f"{self.name}: lands_in 이 없는 인자는 필수가 될 수 없다")
        # 아무도 묻지 않는 값을 필수로 두면 **영원히 안 차서 되묻기 루프**가 된다
        if self.required and not self.asked_by_router:
            raise ValueError(f"{self.name}: 라우터가 묻지 않는 인자는 필수가 될 수 없다")
        if self.requires_group is not None and not self.required:
            raise ValueError(f"{self.name}: requires_group 은 필수 인자끼리만 묶는다")


def _spec(name, kinds, required, description, **kw) -> ArgumentSpec:
    return ArgumentSpec(name=name, kinds=tuple(kinds), required=required,
                        description=description, **kw)


_D = ArgumentKind.DATE
_DR = ArgumentKind.DATE_RANGE
_RG = ArgumentKind.REGION
_PL = ArgumentKind.PLACE_REF
_SL = ArgumentKind.SLOT_REF
_OR = ArgumentKind.ORDINAL
_CN = ArgumentKind.COUNT
_EN = ArgumentKind.ENUM
_FT = ArgumentKind.FREE_TEXT


def _values(enum_cls) -> tuple[str, ...]:
    """어휘를 실제 enum 에서 가져온다 — 손으로 베끼면 갈라진다."""
    return tuple(m.value for m in enum_cls)


# ── 인자표 (FD §2.1 코드 실측본) ──────────────────────────────────────────
#
# 필수 인자가 있는 의도는 **4종뿐**이다: SUGGEST_ALTERNATIVE · EDIT_SCHEDULE ·
# GET_DISTANCE · GET_POI_INFO. 나머지는 여행 기록과 Provider 수집으로 메워진다.
ARGUMENT_TABLE: dict[Intent, tuple[ArgumentSpec, ...]] = {
    Intent.GENERATE_SCHEDULE: (
        # 필수 0 — 처리자가 실제로 거부하는 유일한 조건은 앵커 좌표 부재이지 목적지 이름이 아니다
        # (`api/wiring.py`). 초안은 region·period 를 필수로 뒀는데, 그러면 뱅크의 가장 전형적인
        # 문장 "일정 만들어줘" 가 **항상 되묻기**로 빠진다 — 사용자는 이미 그 여행 화면에 있다.
        _spec("region", (_RG,), False,
              "목적지. 여행 기록에 이미 있고, 발화값은 여러 목적지 중 하나로 좁힐 때 쓴다",
              lands_in=None),  # trip_context.destinations 는 소비자 0건
        _spec("date_range", (_DR,), False,
              "대상 기간. 전체가 아니라 '이틀치만' 같은 부분집합 지정으로 쓰인다",
              lands_in="GenerateItineraryRequest.days (부분집합)"),
        _spec("start_date", (_D,), False,
              "'3박 4일' 처럼 기점 없는 기간을 절대 일자로 접는 기준",
              lands_in="GenerateItineraryRequest.days"),
        _spec("companions", (_EN,), False,
              "동행. 평소엔 PERSONA Provider 가 채우고, 이번 여행이 저장된 취향과 다를 때 덮어쓴다",
              choices=_values(CompanionType), lands_in="PersonaContext.companion"),
        _spec("budget_level", (_EN,), False,
              "예산 등급. 여행 기록·취향으로 메워지고 '가성비로 짜줘' 같은 발화가 덮어쓴다",
              choices=_values(BudgetLevel), lands_in="GenerateItineraryRequest.budget"),
    ),
    Intent.REGENERATE: (
        # GENERATE_SCHEDULE 과 **같은 처리자·같은 요청 타입**이다. 대상 일정이 context_refs 면
        # 대상 여행도 context_refs 다 — 두 의도의 필수 판정이 갈릴 이유가 없다.
        _spec("exclude", (_PL,), False,
              "이번엔 빼고 다시 짤 장소",
              lands_in="GenerateItineraryRequest.excluded_poi_ids"),
        _spec("keep", (_SL, _PL), False,
              "그대로 두고 나머지만 다시 짤 항목 — 고정 블록으로 승격돼 HC3 보호를 받는다",
              lands_in="GenerateItineraryRequest.fixed_blocks"),
        _spec("reason", (_FT,), False,
              "다시 짜는 방향('다른 스타일로'·'느긋하게'). 사유보다 방향 지시가 다수다",
              lands_in=None),
    ),
    Intent.REPLAN: (
        _spec("reason", (_EN,), False,
              "재계획 사유. **복수다** — 화면이 다중 선택이고 와이어도 목록이다",
              choices=(), multiple=True,  # 코드에 enum 이 없다 — 주석 어휘뿐
              lands_in="ReplanRequest.reasons"),
        _spec("target_date", (_D,), False, "재계획 대상 날짜",
              lands_in="ReplanRequest.target_date"),
        _spec("scope", (_EN,), False, "남은 슬롯만인지 하루 전체인지",
              choices=_values(ReplanScope), lands_in="ReplanRequest.scope"),
        _spec("from_slot", (_SL,), False,
              "어느 항목부터 다시 짤지",
              lands_in=None),  # AI 와이어에도 PlanBAgentInput 에도 slot ref 자리가 없다
        _spec("free_text", (_FT,), False,
              "'실내 위주로'·'짧게' 같은 자유 지시. REPLAN 발화에서 가장 흔한 신호다",
              lands_in="replan_session.free_text (백엔드)"),
    ),
    Intent.SUGGEST_ALTERNATIVE: (
        _spec("target", (_SL, _PL), True,
              "무엇 대신인가. 이것이 정해지지 않으면 대체 대상을 풀에서 뺄 수도, 원래 추천 취지를 "
              "이을 수도 없다 — PlanB 경로가 시작되지 않는다",
              lands_in="AlternativesRequest.excluded_poi_ids · affected_reasons 키"),
        _spec("reason", (_EN,), False, "대체 사유. 없어도 규칙 랭킹까지 완주한다",
              choices=(), lands_in="AlternativesRequest.reason"),
        _spec("count", (_CN,), False, "몇 곳을 볼지",
              lands_in=None),  # 개수는 요청 필드가 아니라 클래스 기본값이다
        _spec("constraint", (_FT,), False,
              "'실내로'·'덜 붐비는'·'같은 분위기' — reason 7종이 담지 못하는 조건",
              lands_in=None),
    ),
    Intent.GENERATE_REFLECTION: (
        _spec("date", (_D,), False,
              "대상 하루. 없으면 일자 경계 기본값으로 조립이 성립한다",
              lands_in="ReflectionRequest.start_date · end_date"),
    ),
    Intent.TRIP_SUMMARY: (
        # 끝난 여행이 여러 건이면 발화만이 구분자다. 없으면 백엔드가 최근 종료 여행으로 메운다.
        _spec("region", (_RG,), False, "어느 여행인지 — 지역으로 지목",
              lands_in="ReflectionRequest.region"),
        _spec("period", (_DR,), False, "어느 여행인지 — 기간으로 지목",
              lands_in="ReflectionRequest.start_date · end_date"),
    ),
    Intent.STYLE_ANALYSIS: (
        # AI 에 처리 경로가 없다. 축 지목은 발화에만 있어 라우터가 안 뽑으면 영구 소실이다.
        _spec("focus_axis", (_EN,), False, "'계획형이야 즉흥형이야' 처럼 특정 축을 지목한 경우",
              choices=(), lands_in=None),
    ),
    Intent.EDIT_SCHEDULE: (
        # day 와 target 은 **같은 그룹**이다 — 둘 중 하나만 차면 착수한다.
        # target 이 현재 일정에서 한 날짜로 해소되면 day 는 재조회로 메워진다.
        _spec("day", (_D, _OR), True,
              "편집 대상 하루. 핸들러의 시야가 이 값으로 잘린다 — 슬롯 목록·게이트 대조 집합·"
              "해 변형 대상이 전부 그 하루다",
              requires_group="edit_scope", lands_in="EditTask.target_date"),
        _spec("target", (_SL, _PL), True,
              "편집 대상 항목. 해소되면 day 를 대신한다",
              requires_group="edit_scope", lands_in="EditCommand.affected_slots"),
        # 받을 칸은 있는데 **주인이 핸들러**다. 그래서 `asked_by_router=False` — 표에는 남기되
        # 3차 프롬프트·도구 스키마에서는 뺀다. 물으면 토큰을 쓰고 모델에게 지어낼 자리를 주는데,
        # 정작 워커가 그 날 슬롯과 후보 풀을 손에 들고 다시 고른다.
        _spec("op", (_EN,), False,
              "편집 연산. **핸들러가 정한다** — 워커가 그 날 슬롯과 후보 풀을 손에 들고 고른다. "
              "라우터가 정하면 더 적은 정보로 더 이른 자리에서 같은 판단을 하는 것이다",
              choices=_values(EditOp), lands_in="EditCommand.op", asked_by_router=False),
        _spec("replacement", (_PL,), False, "무엇으로 바꿀지",
              lands_in="EditCommand.params.targetPoiId"),
        _spec("position", (_SL,), False,
              "어디로 옮길지. 비면 '맨 앞으로' 라는 뜻 있는 기본값이라 되물을 자리가 아니다",
              lands_in="EditCommand.params.afterPoiId"),
    ),
    Intent.GET_NEXT_SLOT: (
        # AI 처리 경로 없음(백엔드 DB 조회). 기준점("이거 끝나고")은 inline_context·context_refs 가
        # 싣는 값이라 인자가 아니다 — 초안의 from_time 은 코퍼스에 근거가 0건이라 뺐다.
        _spec("aspect", (_FT,), False, "장소를 묻는지 시작 시각을 묻는지",
              lands_in=BACKEND_PENDING),
    ),
    Intent.SHOW_SCHEDULE: (
        _spec("day", (_OR,), False, "여행 N일차", lands_in=BACKEND_PENDING),
        _spec("date", (_D,), False, "달력 하루", lands_in=BACKEND_PENDING),
        _spec("scope", (_EN,), False,
              "남은 것만인지 전체인지. 이게 없으면 '오늘 남은 일정만'과 '전체 일정'이 "
              "처리자에게 같은 입력이 된다",
              choices=("REMAINING", "ALL"), lands_in=BACKEND_PENDING),
    ),
    Intent.GET_WEATHER: (
        _spec("date", (_D,), False, "어느 날 날씨인지", lands_in="WeatherProvider params.days"),
        _spec("region", (_RG,), False,
              "어디 날씨인지. 처리자 인자는 좌표라 지역명→좌표 변환이 필요한데 그 경로가 없다",
              lands_in=None),
        _spec("aspect", (_FT,), False,
              "비·기온·바람·미세먼지 중 무엇을 묻는지. 처리자가 줄 수 있는 값은 강수확률 하나라 "
              "이게 없으면 '답할 수 없는 질문'과 '답한 질문'이 구분되지 않는다",
              lands_in=None),
        _spec("period", (_DR,), False, "'이번 주말' 처럼 하루가 아닌 경우",
              lands_in="WeatherProvider params.days"),
    ),
    Intent.GET_DISTANCE: (
        _spec("destination", (_PL, _SL), True,
              "어디까지인가. 발화가 유일한 출처다 — 일정에 슬롯이 여럿이면 '어느 것'을 고르는 "
              "정보가 발화에만 있다",
              lands_in="TransitRequest.destination"),
        _spec("origin", (_PL, _SL), False,
              "어디서부터인가. 현재 위치는 inline_context 가 싣고, 없으면 현재/직전 슬롯으로 메워진다",
              lands_in="TransitRequest.origin"),
        # **배선 때 라우터가 기본값을 채워야 한다 — 그리고 채운 사실을 남겨야 한다.**
        # 발화에서 이 값이 나오는 비율이 **26발화 중 2건(7.7%)** 이다(뱅크 seed+증강+평가셋
        # 실측 2026-09-24). `_build_transit_request` 가 `params["mode"]` 를 필수로 읽으므로
        # 안 채우면 "얼마나 멀어?" 계열의 92% 가 영구 `UNAVAILABLE` 이다.
        # 기본값은 **조립기가 아니라 호출측**에 둔다: 조립기를 느슨하게 하면 같은 조립기를
        # 쓰는 delay_check 경로까지 느슨해지는데 거기서는 수단 누락이 진짜 결함이다.
        #
        # 가정을 **조용히 하면 안 된다.** "거리만 내보내니(INV-3) 수단 가정은 싸다"는
        # 폴백 추정기에서만 참이다(`travel.py`: 직선 × detour_factor — 거리는 수단 무관).
        # 실 Tmap 어댑터는 수단별로 **다른 엔드포인트**를 치고 그 경로의 `totalDistance` 를
        # 쓴다(CAR `/tmap/routes` · WALK `/tmap/routes/pedestrian` · PUBLIC `/transit/routes`)
        # — 수단을 잘못 가정하면 **거리 자체가 달라진다**. 그래서 가정한 수단을 응답이나
        # 관측에 남긴다. 안 남기면 사용자가 "왜 이렇게 멀지"를 물을 곳이 없다.
        # 어휘 공백: "택시" 는 `TransportMode` 에 없어 `None` 이다(CAR 로 접을지는 별건).
        _spec("mode", (_EN,), False, "이동 수단",
              choices=_values(TransportMode), lands_in="TransitRequest.mode"),
    ),
    Intent.GET_POI_INFO: (
        _spec("place", (_PL,), True,
              "어느 장소인가. 대가를 함께 적는다 — 평가 발화의 다수가 지시사('여기·그 식당')라 "
              "클라이언트가 '보고 있는 POI' 를 넘길 자리가 생기기 전까지는 되묻기가 잦다",
              lands_in=BACKEND_PENDING),
        _spec("aspect", (_FT,), False, "영업시간·입장료·휴무·주차 중 무엇을 묻는지",
              lands_in=None),
        _spec("date", (_D,), False, "'월요일에 쉬어?' 처럼 요일·날짜가 걸린 경우",
              lands_in=BACKEND_PENDING),
    ),
}


def specs_of(intent: Intent) -> tuple[ArgumentSpec, ...]:
    """의도의 인자 규격. 라우팅 대상이 아닌 라벨은 인자가 없다."""
    return ARGUMENT_TABLE.get(intent, ())


def missing_arguments(intent: Intent, filled: frozenset[str]) -> tuple[str, ...]:
    """아직 못 채운 **필수** 인자 — `IntentFrame.missing` 의 재료.

    같은 `requires_group` 은 하나만 차면 충족된 것으로 보고, 미충족이면 그 그룹의 **첫 인자**를
    대표로 돌려준다(표 순서 = 결정론). 되묻기는 그 하나를 물으면 된다.
    """
    groups: dict[str, list[ArgumentSpec]] = {}
    out: list[str] = []
    for spec in specs_of(intent):
        if not spec.required:
            continue
        if spec.requires_group is None:
            if spec.name not in filled:
                out.append(spec.name)
        else:
            groups.setdefault(spec.requires_group, []).append(spec)
    for members in groups.values():
        if not any(m.name in filled for m in members):
            out.append(members[0].name)
    return tuple(out)


_JSON_TYPE = {
    ArgumentKind.COUNT: "integer",
}


def asked_specs_of(intent: Intent) -> tuple[ArgumentSpec, ...]:
    """그 의도에서 **라우터가 묻는** 인자만 (`ArgumentSpec.asked`).

    프롬프트 스키마와 게이트의 허용 키가 이 하나를 본다 — 둘이 갈리면 모델이 낸 값을
    게이트가 버리거나(묻고 버림) 안 물은 값이 통과한다.
    """
    return tuple(s for s in specs_of(intent) if s.asked())


def asked_argument_names(intent: Intent) -> frozenset[str]:
    """3차 산출물의 `slots` 가 가질 수 있는 키 — 게이트의 closed-set."""
    return frozenset(s.name for s in asked_specs_of(intent))


def _schema_for(spec: ArgumentSpec) -> dict:
    # 설명은 **첫 문장만** — 설계 근거는 모델에게 잡음이다 (`ArgumentSpec.headline`).
    head = spec.headline()
    base: dict = {"type": _JSON_TYPE.get(spec.kinds[0], "string"), "description": head}
    if spec.choices:
        base["enum"] = list(spec.choices)
    if spec.multiple:
        base = {"type": "array", "items": base, "description": head}
    return base


def tool_specs() -> tuple[dict, ...]:
    """인자표 → 도구 13종의 JSON Schema. **3차 프롬프트가 싣는 것도 이것이다.**

    **손으로 적은 스키마 파일을 두지 않는다** — 표가 정본이고 이건 순수 변환이다.
    `OUT_OF_SCOPE` 는 싣지 않는다: 3차는 "이 중 하나를 골라라" 이고, 고를 수 없는 라벨을
    목록에 넣으면 모델이 그걸 고른다(분류 불가는 `{"intent": null}` 로 받는다).

    **묻지 않는 인자는 뺀다**(`ArgumentSpec.asked`) — 표 40칸 중 10칸이 그렇다.
    값이 버려지거나 주인이 따로 있는 칸을 스키마에 실으면 토큰을 쓰고 모델에게 지어낼
    자리를 주는데 결과는 쓰이지 않는다. 표에는 남겨 둔다 — 없는 것과 "있지만 안 묻는 것"은
    다르고, 후자는 근거가 사라지면 다시 넣자는 말이 나온다.
    """
    out = []
    for intent in sorted(ROUTABLE_INTENTS, key=lambda i: i.value):
        specs = asked_specs_of(intent)
        out.append({
            "name": intent.value,
            "description": f"{intent.value} 의도로 처리한다",
            "parameters": {
                "type": "object",
                "properties": {s.name: _schema_for(s) for s in specs},
                # 그룹 인자는 "둘 중 하나" 라 JSON Schema 의 required 로 표현되지 않는다 —
                # 표현할 수 있는 것만 싣고 나머지는 우리 게이트가 본다.
                "required": [s.name for s in specs if s.required and s.requires_group is None],
            },
        })
    return tuple(out)


def tool_specs_json() -> str:
    return json.dumps(list(tool_specs()), ensure_ascii=False, sort_keys=True)
