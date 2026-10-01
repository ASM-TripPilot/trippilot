"""REMINDER_COPY 출구 게이트 — 리마인드 알림 문구 1건(title/body).

산출물은 사용자에게 보이는 **알림 문구**다. 표시 안전성(길이·금지 토큰)에 더해
**장소 대조**를 한다 — 문구가 그날 일정에 없는 곳을 말하면 사용자는 일정이 바뀐
줄 안다(INV-1 정신). 자유 한국어에서 장소를 추출하는 문제는 풀지 않는다: 모델이
언급한 장소를 `places` 로 **스스로 선언**하게 하고 그 선언을 대조한다
(edit_translation 의 affectedSlots 선례).

선언 회피를 막는 대칭 규칙이 하나 더 있다 — 같은 여행의 **다른 날 장소**가 본문에
있으면 선언 여부와 무관하게 드롭한다. 가장 흔한 실패(다른 날 일정을 오늘로 말하기)를
값싸게 잡는다. 세상의 모든 지명을 막지는 못하지만, 못 막는 몫은 폴백이 받는다.

위반은 전부 **드롭**(GateDropEvent) — 빈 결과는 실패이고, 알림 자체는 백엔드가
기존 상수로 보낸다(INV-4, 침묵 실패 금지).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.llm_gateway.gates.base import (
    GateOutcome,
    empty_result_error,
    has_contact_like,
    strip_code_fence,
)

# 푸시 제목·본문 상한 (프롬프트의 "20자/60자"와 같은 값 — 테스트가 고정한다)
_MAX_TITLE = 20
_MAX_BODY = 60

# 소요시간·시각 계열 표시 금지 (INV-3).
#
# 넛지 게이트는 같은 규칙을 **부분 문자열**로 본다 — 거기선 과잉 드롭이 폴백 한 줄로
# 수렴하니 값이 싸다. 리마인드 문구는 값이 다르다: 드롭하면 그 예약은 기본 상수로
# 가고, 그게 반복되면 기능이 사실상 꺼진다. 실측(2026-09-17, 홀드아웃 30건)에서
# 탈락 17건 중 12건이 이 부분 문자열 때문이었고, 그중 "즐거운 시간을 보내요"·
# "오늘의 맛과 분위기" 처럼 **소요시간을 하나도 표시하지 않는** 문구가 대부분이었다.
#
# 그래서 판정을 INV-3 의 실제 의미("소요시간이 화면에 뜨는가")에 맞춘다 — 수량을
# 동반하거나, 소요를 뜻하는 연어이거나, 시각 표기일 때만 드롭한다. 여전히 과잉
# 드롭 쪽으로 기울여 둔다(누락은 INV-3 위반이고 폴백이 없다).
_NUM = r"(?:\d+|[일이삼사오육칠팔구십]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|반)"
_DURATION = re.compile(
    # 수량 + 단위: "30분" · "두 시간" · "삼십분".
    # 앞의 한글을 배제해 "특별한 시간"의 '한 시간', "식사 시간"의 '사 시간'을 지나친다.
    rf"(?<![가-힣]){_NUM}\s*(?:분|시간)"
    # 수량이 없어도 소요를 뜻하는 연어.
    r"|(?:이동|소요|대기|운전|도보|체류)\s*시간"
    r"|시간이\s*(?:걸|소요)"
    # 시각 표기. "시각적"·"시각화"는 소요시간이 아니다.
    r"|시각(?![적화])"
    r"|duration"
)


# 괄호 부기(동명이지역 구분 등)를 뗀 표시형. 수집 POI 이름의 8.5%가 괄호를 달고
# 있는데("약수암(부산)"·"금룡사(제주)"), 알림 문구에 그대로 쓰는 사람은 없다 —
# 모델은 declare 에 원본을 싣고 본문엔 줄여 쓴다. 그 자연스러운 축약을 "선언과
# 본문이 다르다"고 드롭하면 그 슬롯이 든 날은 매번 기본 문구로 떨어진다(겉으로는
# 모델 실패와 구분되지 않는다).
_PAREN = re.compile(r"[\(（][^)）]*[\)）]")

# 괄호 없이 뒤에 붙는 로마자 표기("사라오름 전망대 Sara Observatory"). Overture·OSM
# 출처가 이 관행을 쓴다 — 괄호 안에 넣는 TourAPI 와 다르다. 모델은 한국어 부분만
# 쓰므로 이것도 인정하지 않으면 그 출처의 장소가 든 날이 통째로 드롭된다.
_TRAILING_LATIN = re.compile(r"\s+[A-Za-z][A-Za-z'&.\- ]*$")
_HANGUL = re.compile(r"[가-힣]")

# 이름 안에서 공백과 같은 구실을 하는 구분자("스파·리조트"·"카페/베이커리").
_SEPARATORS = re.compile(r"[·・/]")


def _display_form(name: str) -> str:
    """사람이 문구에 쓸 법한 표시형 — 괄호 부기와 뒤따르는 로마자를 뗀다.

    로마자 제거는 **한글이 남을 때만** 한다. "Paris Baguette Cafe" 처럼 라틴 문자가
    본명인 곳까지 깎으면 이름이 사라진다.
    """
    stripped = _PAREN.sub("", name).strip()
    without_latin = _TRAILING_LATIN.sub("", stripped).strip()
    if without_latin and _HANGUL.search(without_latin):
        return without_latin
    return stripped


def _name_variants(name: str) -> set[str]:
    """이름 하나가 문구에 나타날 수 있는 형태 전부 — 표시형 + **연속 토큰 구간**.

    괄호·로마자를 떼는 것만으로는 부족하다. 실측(2026-09-17)에서 남은 축약이 둘:

        허용 "동적깡통구이 쌍문본점" → 본문 "동적깡통구이"   (지점 접미사)
        허용 "옥천 구읍벽화마을"     → 선언 "구읍벽화마을"    (지역 접두사)

    둘 다 사람이 알림에서 실제로 쓰는 형태인데 "선언과 본문이 다르다"·"풀 밖
    장소"로 잡혀 그 날이 통째로 드롭됐다(평가 시나리오 장소명의 13%가 이 모양).
    지점·지역 목록을 따로 들고 있는 대신 **공백 토큰 경계의 연속 구간**을 전부
    인정한다 — 두 경우가 같은 규칙에 들어오고, 새 표기 관행이 와도 버틴다.

    경계를 토큰에 묶는 것이 완화의 한계선이다: "세종호수공원"은 한 토큰이라
    "공원"이 파생되지 않는다. 즉 일정에 있는 이름에서 **잘라낸 조각만** 늘어나고
    없는 장소가 새로 허용되지는 않는다(INV-1).
    """
    variants: set[str] = set()
    for form in (name, _display_form(name)):
        form = form.strip()
        if not form:
            continue
        variants.add(form)
        # 가운뎃점·슬래시도 토큰 경계다 — "도곡 원네스 스파·리조트" 를 모델은
        # "도곡 원네스 스파" 로 줄인다(실측 2건). 공백만 경계로 보면 이 표기의
        # 이름이 통째로 드롭된다.
        tokens = _SEPARATORS.sub(" ", form).split()
        # 연속 토큰 구간 — 이름당 토큰이 몇 개뿐이라 전수로 싸다.
        for i in range(len(tokens)):
            for j in range(i + 1, len(tokens) + 1):
                run = " ".join(tokens[i:j])
                # 한글 2자 미만 조각은 흔한 말과 충돌한다("역"·"점").
                if len(_HANGUL.findall(run)) >= 2:
                    variants.add(run)
    return variants


@dataclass(frozen=True, slots=True)
class ReminderCopyContext:
    """게이트 검증 컨텍스트 — `GatewayFacade.call` 의 pool 자리로 관통.

    allowed: 그날 일정의 장소명. 문구가 말해도 되는 전부.
    forbidden: 같은 여행의 **다른 날** 장소명. 본문에 나오면 드롭한다.
    """

    allowed: tuple[str, ...]
    forbidden: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ReminderCopyDraft:
    title: str
    body: str


class ReminderCopyGate:
    """REMINDER_COPY 출구 게이트 — {"title", "body", "places"} → ReminderCopyDraft."""

    def apply(
        self,
        raw_text: str,
        pool: object,  # ReminderCopyContext — pool 자리로 관통 (ExitGate 계약 호환)
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        if not isinstance(pool, ReminderCopyContext):
            return GateOutcome(
                value=None,
                drop_event=None,
                error="gate_error: ReminderCopyContext 없음 (그날 슬롯 대조 집합 필요)",
            )
        ctx = pool
        try:
            data = json.loads(strip_code_fence(raw_text))
            if not isinstance(data, dict):
                raise ValueError("최상위가 객체가 아님")
            title = data["title"]
            body = data["body"]
            places = data.get("places", [])
            if not isinstance(title, str) or not isinstance(body, str):
                raise ValueError("title·body 가 문자열이 아님")
            if not isinstance(places, list) or any(not isinstance(p, str) for p in places):
                raise ValueError("places 가 문자열 배열이 아님")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")

        title = title.strip()
        body = body.strip()
        declared = tuple(p.strip() for p in places if p.strip())
        # 대조 집합은 **원본과 표시형 둘 다** 담는다. 모델은 슬롯명을 사람이 쓸 법한
        # 형태로 줄여 선언한다 — 슬롯이 "사라오름 전망대 Sara Observatory" 면
        # places 에 "사라오름 전망대" 를 싣는다. 원본만 대조하면 그 축약이 전부
        # "풀 밖 장소"로 잡혀, 괄호·로마자가 붙은 장소가 든 날은 문구가 매번
        # 버려지고 기본 상수로 떨어진다(수집본의 4.6% 가 괄호를 달고 있고 출처가
        # 늘수록 는다). 표시형은 원본에서 파생되므로 **없는 장소를 새로 허용하지
        # 않는다** — 완화의 범위가 거기서 닫힌다.
        allowed = {n for name in ctx.allowed for n in _name_variants(name)}
        lowered = (title + body).lower()

        dropped = (
            not title
            or not body
            or len(title) > _MAX_TITLE
            or len(body) > _MAX_BODY
            or _DURATION.search(lowered) is not None  # INV-3
            or any(name not in allowed for name in declared)  # INV-1
            or any(
                not any(v in body for v in _name_variants(name)) for name in declared
            )  # 선언 정직성 — 표시형·토큰 축약도 인정
            or any(name and name in body for name in ctx.forbidden)  # 선언 회피 차단
            # 링크·연락처 꼴 — 넛지 게이트와 같은 이유(잠금화면 · 수집 장소명이
            # 프롬프트에 실린다). 여기는 대조 집합이 있어도 못 막는다: `allowed` 는
            # 장소를 **말해도 되는가**만 보고, 문구에 낯선 도메인이 붙는 것은
            # 어느 규칙에도 걸리지 않는다.
            or has_contact_like(title + " " + body)
        )
        if dropped:
            drop_event = GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                dropped_ids=(),  # 문구 드롭은 풀 ID가 아님 (nudge·paraphrase 선례)
                total_count=1,
                dropped_count=1,
            )
            return GateOutcome(
                value=None,
                drop_event=drop_event,
                error=empty_result_error(None, drop_event),
            )
        return GateOutcome(
            value=ReminderCopyDraft(title=title, body=body), drop_event=None, error=None
        )
