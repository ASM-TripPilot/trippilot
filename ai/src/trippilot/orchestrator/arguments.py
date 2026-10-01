"""인자 추출기 — `ArgumentKind` 마다 하나 (`assistant-dialogue` FD §3).

**의도마다가 아니라 종류마다 하나다.** 같은 `date` 를 의도마다 다른 정규식으로 뽑으면 한 곳만
고친 드리프트가 난다. 뱅크 엔트리별 `slot_pattern` 을 폐기하고 여기로 옮긴 이유이기도 하다 —
뱅크가 485문장이고 증강으로 계속 느는데 문장마다 패턴을 달 수는 없다.

## 정밀도를 택한다 — 애매하면 뽑지 않는다 (BR-DLG-08b)

필수 인자는 13종 중 **4종에만** 있다(FD §2.0.1). 그래서 추출기 일의 대부분이 **선택 인자**이고,
선택 인자에서는 두 실패의 대가가 대칭이 아니다.

  못 뽑음   → 선택 인자면 그냥 빈다(BR-DLG-33). 손해 없음
  잘못 뽑음 → 처리자가 **틀린 값으로 일한다.** 사용자는 자기가 말하지 않은 조건이 걸린 결과를 받는다

그래서 재현율을 위해 패턴을 넓히지 않는다. 구조로 강제하는 규칙이 하나 있다 —
**서로 겹치지 않는 후보가 둘 이상이면 `None`** (`_one_span`). 한 문장에 같은 종류가 두 번 나오면
어느 쪽이 인자인지 발화만으로는 모르기 때문이다("9월 20일부터 22일까지"). 이 한 줄이
반증에서 나온 경계(`wrong_span`) 반례 대부분을 구조적으로 없앤다.

## 실측 배경

종류마다 설계안을 세우고 렌즈 셋(오탐·누락·경계)으로 반증했다(2026-09-19). **9종 전부
`rules_partial`** 이고 종류당 반례가 25~37건이었다. 초안이 "정규식·0회·결정론" 으로 적었던
다섯 종류도 전부 깨졌다 — 한국어의 조사 결합·띄어쓰기 변이·한자어/고유어 수사 이중화·축약이
규칙 하나로 수렴하지 않는다. 그 반례를 테스트로 옮기고, **못 잡는 것은 `None` 으로 두는 쪽**을
골랐다(`tests/test_arguments.py`).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence

from trippilot.domain.common import BudgetLevel, TransportMode
from trippilot.domain.dialogue import ArgumentKind, ArgumentSpec
from trippilot.domain.edit import EditOp
from trippilot.domain.persona import CompanionType
from trippilot.domain.trigger import ReplanScope

Extractor = Callable[[str], str | None]


def _one_span(text: str, patterns: Sequence[re.Pattern[str]]) -> str | None:
    """후보가 **정확히 하나**일 때만 그 조각을 돌려준다.

    겹치는 후보는 긴 쪽으로 접는다("9월 20일" 과 "20일" → 앞엣것). 접고 나서도 둘 이상 남으면
    어느 쪽이 인자인지 발화만으로는 알 수 없으므로 `None` 이다.
    """
    spans: set[tuple[int, int]] = set()
    for pattern in patterns:
        for m in pattern.finditer(text):
            if m.group(0).strip():
                spans.add(m.span())
    if not spans:
        return None
    # 다른 후보에 완전히 먹히는 것은 버린다 (긴 쪽이 이긴다)
    kept = [s for s in spans if not any(o != s and o[0] <= s[0] and s[1] <= o[1] for o in spans)]
    if len(kept) != 1:
        return None
    start, end = kept[0]
    return text[start:end].strip() or None


def _compile(*patterns: str) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(p) for p in patterns)


# ── DATE — 하루 ──────────────────────────────────────────────────────────
#
# **맨 `N일` 을 일부러 안 잡는다.** 반증에서 가장 크게 깨진 자리다 — "3일 가는데"(기간) ·
# "1일에 만원"(단가) · "3일에 한 번"(주기) · "연차가 3일까지"(상한) 가 전부 같은 모양이다.
# 월이 함께 오거나 날짜 표지가 붙은 것만 잡는다.
_DATE = _compile(
    # 9월 20일 · 2026년 9월 20일. '부터' 가 뒤따르면 기간이라 DATE_RANGE 몫이다
    r"(?:\d{2,4}년\s*)?\d{1,2}월\s*\d{1,2}일(?!\s*부터)",
    r"(?<![\d./])\d{1,2}/\d{1,2}(?![\d./~-])",       # 9/20 — 소수·비율·범위와 겹치지 않게 양옆을 막는다
    r"내일 ?모레",                                       # 긴 것 먼저 (짧은 '내일' 보다 우선)
    r"(?<!다)다음\s*달\s*\d{1,2}일",                   # '다다음 달' 은 뜻이 달라 제외한다
    # '낼' 은 '내다'의 관형형과 완전히 겹친다("숙소비는 내가 낼 계획") — 뒤에 오는 명사로 가른다
    r"(?<![가-힣])(?:오늘|내일|모레|글피|어제)(?![가-힣])",
    r"(?<![가-힣])낼(?!\s*(?:계획|생각|돈|비용|거|것))(?![가-힣])",
    r"(?<![가-힣])(?:이번|다음|담|지난)\s*주\s*[월화수목금토일](?:요일|욜)",
    # 맨 요일 — '매주/격주'(주기)를 막는다. 파이썬 lookbehind 는 고정폭이라 나눠 쓴다
    r"(?<!매주)(?<!매주 )(?<!격주)(?<!격주 )(?<![가-힣])(?:이번|다음|담|지난)?\s*[월화수목금토일]요일",
)

# ── DATE_RANGE — 기간 ───────────────────────────────────────────────────
#
# DATE 가 일부러 비운 자리(맨 `N일`)를 여기서 **단위·조사와 함께** 잡는다.
# '하루' 를 **뺐다** — "오늘 하루 여행했던 내용을 돌아보는 글"(회고)처럼 기간이 아닌 자리와
# 겹치고, '동안' 이 붙어도 갈리지 않는다("하루 동안의 여행 이야기를 일기처럼"). 재현율을 잃는다.
_NATIVE_SPAN = r"이틀|사흘|나흘|닷새|엿새|이레|여드레|아흐레|열흘|보름"
_DATE_RANGE = _compile(
    r"\d{1,2}\s*박\s*\d{1,2}\s*일",                  # 3박 4일 · 3박4일 · 3박  4일
    r"무박\s*\d{1,2}\s*일",
    r"(?<![가-힣])[일이삼사오육칠팔구십]박[일이삼사오육칠팔구십]일(?![가-힣])",   # 일박이일
    r"당일치기",
    # 20일부터 23일까지 · 9월 20일부터 22일까지 · 낼부터 모레까지 · 금요일부터 일요일까지
    r"(?:\d{1,2}월\s*)?\d{1,2}일\s*부터\s*(?:\d{1,2}월\s*)?\d{1,2}일\s*까지",
    r"(?:오늘|내일|낼|모레|글피)\s*부터\s*(?:오늘|내일|낼|모레|글피)\s*까지",
    r"[월화수목금토일]요일\s*부터\s*[월화수목금토일]요일\s*까지",
    r"\d{4}-\d{2}-\d{2}\s*부터\s*\d{4}-\d{2}-\d{2}\s*까지",
    r"\d{1,2}/\d{1,2}\s*[~-]\s*\d{1,2}/\d{1,2}",
    r"(?<![가-힣])(?:이번|다음|담|지난)?\s*주말(?![가-힣])",
    r"(?<![가-힣])(?:" + _NATIVE_SPAN + r")\s*(?:동안|간|정도|쯤)?(?![가-힣])",
    r"(?<![가-힣])하룻밤(?![가-힣])",
    r"(?<![\d가-힣])\d{1,2}\s*주(?:일)?\s*(?:동안|간|정도)?(?![가-힣])",
    # 맨 N일은 **기간 표지가 붙을 때만** — "3일 가는데" · "삼일 동안"
    r"(?<![\d가-힣])\d{1,2}\s*일(?=\s*(?:동안|간|정도|쯤|짜리|가는|다닐|돌))",
    r"(?<![가-힣])[일이삼사오육칠팔구십]{1,2}일(?=\s*(?:동안|간|정도|쯤|짜리))",
)

# ── ORDINAL — 여행 N일차·N번째 ──────────────────────────────────────────
#
# `\d일` 계열은 **차/째** 가 붙을 때만 잡는다 — 그래야 기간("3일 가는데")과 갈린다.
# 그리고 '차' 는 차이·차량·차로 와 겹치고 '째' 는 서술형("공사가 3일째라")과 겹쳐서 뒤를 막는다.
# 순서 수사(첫째·두 번째)는 **뒤에 오는 명사를 요구한다** — 없으면 "둘째는 어디 갈까"(사람) ·
# "두 번째 출구"(위치) · "둘째 주"(달력) 를 전부 잡는다.
_ORD_NOUN = r"(?:날|코스|장소|일정|곳)"
_ORDINAL = _compile(
    r"(?<![~\-\d])제?\s*\d{1,2}\s*일\s*(?:차(?![이로량])|째(?![라야고]))",
    r"(?<![가-힣])(?:첫|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)째\s*" + _ORD_NOUN,
    r"(?<![가-힣])(?:첫|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|열두)\s*번째\s*" + _ORD_NOUN,
    r"(?<!달 )(?<![가-힣달])첫날(?![가-힣])",
    # '마지막 일정' 은 "마지막 일정 변경이 언제였는지" 처럼 순번이 아닌 자리가 흔해 명사에서 뺀다
    r"(?<![가-힣])(?:막날|마지막\s*(?:날|코스|장소))(?![가-힣])",
    r"(?<![가-힣])(?:하루|이틀|사흘|나흘|닷새)\s*째(?![라야고가-힣])",
    r"(?<![가-힣])[일이삼사오]\s*일\s*째(?![라야고가-힣])",
)

# ── COUNT — 개수 ────────────────────────────────────────────────────────
#
# **단위를 `곳`·`군데` 로 좁혔다.** `개` 는 "별점 4개 이상" · "캐리어 두 개" 처럼 장소가 아닌
# 것을 세는 쪽이 더 흔하고 발화만으로 못 가른다. `명` 은 인원이라 이 표의 인자가 아니다.
# 고유어 수사에서 **`한`·`열` 을 뺐다** — "볼 만 한 곳"(하다의 관형형) · "문 열 곳"(열다)과
# 완전히 겹친다. 붙여 쓴 `한곳` 만 안전해서 그것만 남긴다.
_COUNT_UNIT = r"(?:곳|군데)"
_COUNT = _compile(
    r"(?<![\d가-힣])(?<!\d[,~-])\d{1,2}\s*" + _COUNT_UNIT + r"(?!\s*(?:이상|이하|넘게|미만))(?![가-힣])",
    r"(?<![가-힣])(?:두|세|네|다섯|여섯|일곱|여덟|아홉|스무|한두|두세|서너)\s*" + _COUNT_UNIT + r"(?![가-힣])",
    r"(?<![가-힣])한" + _COUNT_UNIT + r"(?![가-힣])",       # 붙여 쓴 것만
    r"(?<![가-힣])몇\s*" + _COUNT_UNIT + r"(?![가-힣])",
)


# ── ENUM — 닫힌 어휘 ────────────────────────────────────────────────────
#
# **다른 종류와 반환 규약이 다르다**: 원문 조각이 아니라 **정규 값**을 돌려준다.
# "넣어줘" 를 그대로 넘기면 처리자가 다시 해석해야 하므로 의미가 없다.
#
# 표면형이 **서로 다른 값 둘 이상**에 걸리면 `None` 이다 — "순서를 바꿔줘" 는 REORDER_DAY 의
# '순서' 와 REPLACE_SLOT 의 '바꿔' 에 함께 걸린다. 이럴 때 하나를 고르면 반드시 틀린다.
_ENUM_SURFACES: dict[str, dict[str, tuple[str, ...]]] = {
    EditOp.__name__: {
        EditOp.ADD_SLOT.value: ("추가", "넣어", "넣자", "포함", "더해", "끼워"),
        EditOp.REMOVE_SLOT.value: ("빼줘", "빼고", "빼기", "삭제", "제거", "지워", "없애"),
        EditOp.MOVE_SLOT.value: ("옮겨", "옮기", "이동", "재배치", "미뤄", "늦춰", "당겨"),
        EditOp.REPLACE_SLOT.value: ("대신", "교체", "바꿔", "바꾸", "변경"),
        EditOp.REORDER_DAY.value: ("순서", "맞바꿔", "거꾸로"),
        EditOp.CLEAR_DAY.value: ("비워", "통째로 지워"),
    },
    BudgetLevel.__name__: {
        BudgetLevel.LOW.value: ("저렴", "가성비", "알뜰", "싸게"),
        BudgetLevel.HIGH.value: ("고급", "럭셔리", "비싸도", "호캉스"),
    },
    CompanionType.__name__: {
        CompanionType.SOLO.value: ("혼자", "나 혼자"),
        CompanionType.COUPLE.value: ("커플", "연인", "둘이서"),
        CompanionType.FRIENDS.value: ("친구",),
        CompanionType.FAMILY.value: ("아이", "애들", "아기", "가족"),
        CompanionType.PARENTS.value: ("부모님", "어머니", "아버지"),
    },
    TransportMode.__name__: {
        TransportMode.WALK.value: ("걸어", "도보"),
        TransportMode.PUBLIC.value: ("대중교통", "지하철", "버스"),
        TransportMode.CAR.value: ("차로", "렌터카", "운전"),
    },
    ReplanScope.__name__: {
        ReplanScope.PARTIAL_SLOTS.value: ("남은", "나머지"),
        ReplanScope.FULL_DAY.value: ("하루 전체", "오늘 통째", "종일"),
    },
    # SHOW_SCHEDULE.scope — 코드 enum 이 아니라 표가 정의한 어휘다(백엔드 봉투용).
    # 이게 없으면 "오늘 남은 일정만" 과 "전체 일정" 이 처리자에게 **같은 입력**이 된다.
    "ShowScheduleScope": {
        "REMAINING": ("남은", "나머지", "이후"),
        "ALL": ("전체", "전부", "다 보여", "통째"),
    },
}

_CHOICES_TO_VOCAB: dict[tuple[str, ...], str] = {
    tuple(m.value for m in EditOp): EditOp.__name__,
    tuple(m.value for m in BudgetLevel): BudgetLevel.__name__,
    tuple(m.value for m in CompanionType): CompanionType.__name__,
    tuple(m.value for m in TransportMode): TransportMode.__name__,
    tuple(m.value for m in ReplanScope): ReplanScope.__name__,
    ("REMAINING", "ALL"): "ShowScheduleScope",
}


def extract_enum(text: str, choices: Sequence[str]) -> str | None:
    """닫힌 어휘 인자 — 표면형 → **정규 값**. 둘 이상에 걸리면 `None`."""
    vocab = _CHOICES_TO_VOCAB.get(tuple(choices))
    if vocab is None:
        return None  # choices 가 비었거나(아직 타입 아님) 모르는 어휘다
    surfaces = _ENUM_SURFACES[vocab]
    hit = {value for value, forms in surfaces.items() if any(f in text for f in forms)}
    if len(hit) != 1:
        return None
    value = hit.pop()
    return value if value in choices else None


# 규칙으로 못 뽑는 종류 — 3차 승격(FD §3 표). 억지 정규식은 오탐을 만들어 더 나쁘다.
#   REGION    사전이 필요하고 그 정본은 place-data 소유다
#   PLACE_REF 고유명사 경계를 한국어 조사만으로 못 가른다
#   SLOT_REF  지시 대상이 현재 일정에 있어야 정해진다
#   FREE_TEXT 정의상 규칙 불가
_RULE_EXTRACTORS: dict[ArgumentKind, tuple[re.Pattern[str], ...]] = {
    ArgumentKind.DATE: _DATE,
    ArgumentKind.DATE_RANGE: _DATE_RANGE,
    ArgumentKind.ORDINAL: _ORDINAL,
    ArgumentKind.COUNT: _COUNT,
}

NEEDS_LLM: frozenset[ArgumentKind] = frozenset({
    ArgumentKind.REGION,
    ArgumentKind.PLACE_REF,
    ArgumentKind.SLOT_REF,
    ArgumentKind.FREE_TEXT,
})


def extract_kind(text: str, kind: ArgumentKind, choices: Sequence[str] = ()) -> str | None:
    """종류 하나를 뽑는다. 못 뽑으면 `None` — 예외가 아니다."""
    if kind is ArgumentKind.ENUM:
        return extract_enum(text, choices)
    patterns = _RULE_EXTRACTORS.get(kind)
    if patterns is None:
        return None  # NEEDS_LLM — 3차가 뽑는다
    return _one_span(text, patterns)


def extract_argument(text: str, spec: ArgumentSpec) -> str | None:
    """인자 하나 — `kinds` 를 **순서대로** 시도하고 먼저 걸리는 것을 쓴다.

    `target` 처럼 `SLOT_REF|PLACE_REF` 인 자리는 둘 다 실제로 나오므로 순서가 곧 우선순위다.
    """
    for kind in spec.kinds:
        value = extract_kind(text, kind, spec.choices)
        if value is not None:
            return value
    return None


def extract_arguments(text: str, specs: Sequence[ArgumentSpec]) -> dict[str, str]:
    """의도의 인자표를 훑어 채워지는 것만 담는다. **추출 실패는 라우팅을 죽이지 않는다.**

    `multiple` 인자는 건너뛴다 — 추출기 계약이 값 하나(`str | None`)라 목록을 표현할 수 없다
    (business-rules 미결 #12). 반쪽만 뽑아 넘기면 복수 사유가 조용히 잘린다.
    """
    out: dict[str, str] = {}
    for spec in specs:
        if spec.multiple:
            continue
        value = extract_argument(text, spec)
        if value is not None:
            out[spec.name] = value
    return out
