"""SHARE_CARD_COPY 출구 게이트 — j06 공유 카드의 캡션·해시태그 (TRIP-429 후속).

산출이 **1건**이라 전량 드롭형이다 (`reflection_nudge` 선례 — "결과가 N건이면 격리,
1건이면 전량 드롭": 캡션만 살리고 해시태그를 지우면 카드 문구의 의미가 조용히 달라진다).
위반은 재시도하지 않는다 — 판단 없는 단발 변환이라 값 없음 + 사유로 수렴하고,
정적 폴백의 **실행은 경계(api/wiring)** 몫이다 (BR-U4-09, U6 Reflect FD §2.1 워커 직행).

판정 6종 — **판정 로직**은 전부 `reflection_template` 게이트 재사용(①②⑥)이거나
FE 상한의 이식(④⑤)이다. 다만 **등급은 다르다**: 그쪽은 CAPTION_LEN·HASHTAG_OUT을
SOFT(랭킹 감점)로 두는데, 그건 계약이 "N회 생성 → 최선 채택"이라 감점을 적용할
랭킹 자리가 있기 때문이다. 여기는 단발 1건이라 그 자리가 없다 — 감점을 둘 곳이
없으니 통과 아니면 드롭이고, 드롭은 정적 폴백으로 수렴한다.
그래서 **과잉 드롭이 이 게이트의 실질 위험**이다(정상 카피가 폴백으로 밀린다).
상한·어휘 규칙을 프롬프트에 빠짐없이 싣는 것이 그 방어선이고, 정합은 테스트가 고정한다.
  ① TIME_EXPR      캡션·해시태그의 시간 표현 (`_TIME_EXPR` 재사용, INV-3)
  ② PLACEHOLDER_OUT 자리표시자 어휘 밖 토큰 (`PLACEHOLDER_VOCAB` closed-set — 숫자 환각 차단)
  ③ PLACE_NOT_FOUND 캡션이 부른 장소가 요청 방문 기록 밖 (INV-1 사영)
  ④ CAPTION_LEN    캡션 150자 초과 (FE 상한 — 잘린 문장을 미리 막는다)
  ⑤ HASHTAG_COUNT  해시태그 11개 이상 (FE 상한)
  ⑥ HASHTAG_OUT    지역·방문지·브랜드 파생 아닌 태그 (`_tag_allowed` 재사용)

**③은 모델의 자기 신고를 교차한다** — `places` 배열에 캡션에서 쓴 상호명을 담게 하고
(프롬프트 규칙), 게이트가 (a) 방문 기록 실재 (b) 캡션 내 실제 등장을 양방향으로 본다.
"LLM은 고르고 게이트가 교차한다"는 기존 형(explanation·alternative_selection)의 문자열판이고,
한국어 캡션에서 장소 스팬을 결정론적으로 잘라낼 방법이 없다는 한계를 지어내지 않고 드러낸다
— 신고하지 않은 상호명까지 잡지는 못한다(그 자리는 프롬프트 규칙이 맡는다).

**빈 결과 라벨 2종을 보존한다** (TRIP-260 #5): 캡션이 비면 `llm_empty_result`
(프롬프트·입력을 보라), 위반으로 떨어뜨렸으면 `gate_dropped_all`(게이트 규칙·환각을 보라).
판별 근거는 `GateDropEvent` 유무 — `empty_result_error`가 그대로 유지한다.

"error 있으면 value 비움" 불변식은 base.GateOutcome이 강제한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from trippilot.llm_gateway.gates.base import (
    GateOutcome,
    _load_json_object,
    empty_result_error,
)
# 판정의 정본은 reflection_template 게이트 하나다 — 같은 규칙을 두 벌 쓰면 한쪽만
# 고쳐져 조용히 갈라진다(TRIP-558이 해시태그 등급을 옮길 때 겪은 자리). 여기서는
# 재사용만 하고 그쪽 동작은 건드리지 않는다.
from trippilot.llm_gateway.gates.reflection_template import (
    _PLACEHOLDER,
    _TIME_EXPR,
    _tag_allowed,
)
from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.domain.reflection import PLACEHOLDER_VOCAB, ShareCardCopy

# FE `frontend/src/features/reflection/model/shareCard.ts` 의 CAPTION_MAX_LENGTH·
# HASHTAG_MAX_COUNT 와 같은 값 — **어느 한쪽이 바뀌면 다른 쪽도**.
#
# 상한의 소유자는 FE(온디바이스 편집 UI, §7)이고 **강제하는 쪽은 여기다**: FE의
# `validateCaption`·`validateHashtags` 는 현재 호출자가 없고 화면은 원문을 그대로
# 렌더한다(`ShareCardPage.tsx`) — 붙는 순간 초과분이 잘리거나 그대로 새어나가므로,
# 상한을 넘긴 카피는 애초에 내보내지 않는 편이 낫다.
CAPTION_MAX_LENGTH = 150
HASHTAG_MAX_COUNT = 10

# 자리표시자 스캔(`_PLACEHOLDER`)·어휘 멤버십(`PLACEHOLDER_VOCAB`)도 재사용이다.
# {poi:i.name} 인덱스형만 여기 쓰지 않는다: 공유 캡션은 상호명을 그대로 부르고
# 그 실재를 ③이 교차한다 (템플릿 캡션과 다른 자리).


@dataclass(frozen=True, slots=True)
class ShareCardCopyContext:
    """게이트 검증 컨텍스트 — GatewayFacade.call의 pool 자리로 관통.

    `ReflectionTemplateContext`와 같은 전제(요청이 대조 집합을 그대로 나른다)의
    문구 전용 축소판이다: 장소 실재(③)와 해시태그 허용(⑥)만 판정한다.
    """

    poi_names: tuple[str, ...]
    region: str = ""

    def __post_init__(self) -> None:
        if not self.poi_names:
            raise ValueError("poi_names ≥ 1 (BR-U6R-15 — 방문 0건은 진입 불가)")


class ShareCardCopyGate:
    """`{"share_card": {caption, hashtags, places}}` → ShareCardCopy."""

    def apply(
        self,
        raw_text: str,
        pool: object,  # ShareCardCopyContext — pool 자리로 관통 (ExitGate 계약 호환)
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        if not isinstance(pool, ShareCardCopyContext):
            # 대조 집합 없이는 ③⑥을 판정할 수 없다 — 통과시키면 검증 없이 나간다.
            return GateOutcome(
                value=None,
                drop_event=None,
                error="gate_error: ShareCardCopyContext 없음 (방문·지역 대조 집합 필요)",
            )
        try:
            caption, hashtags, places = self._parse(raw_text)
        except ValueError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")

        if not caption:
            # 게이트는 아무것도 안 버렸다 — 프롬프트·입력을 보라는 신호 (TRIP-260 #5).
            return GateOutcome(
                value=None, drop_event=None, error=empty_result_error(None, None)
            )

        violations = _judge(caption, hashtags, places, pool)
        if violations:
            drop_event = GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                # 문구 드롭은 풀 ID가 아님 — 환각률 지표 순수성 (nudge·paraphrase 선례)
                dropped_ids=(),
                total_count=1,
                dropped_count=1,
            )
            return GateOutcome(
                value=None,
                drop_event=drop_event,
                error=f"{empty_result_error(None, drop_event)}: {'; '.join(violations)}",
            )
        return GateOutcome(
            value=ShareCardCopy(
                caption=caption, hashtags=hashtags, is_fallback=False),
            drop_event=None,
            error=None,
        )

    # ── 파서 (스키마 불성립 = ValueError = parse_error) ────

    @staticmethod
    def _parse(raw_text: str) -> tuple[str, tuple[str, ...], tuple[str, ...]]:
        node = _load_json_object(raw_text, "share_card")
        if not isinstance(node, dict):
            raise ValueError("share_card가 객체가 아님")
        caption = node.get("caption")
        if not isinstance(caption, str):
            raise ValueError("caption이 문자열이 아님")
        return (
            caption.strip(),
            _str_tuple(node.get("hashtags"), "hashtags"),
            _str_tuple(node.get("places"), "places"),
        )


def _str_tuple(raw: object, label: str) -> tuple[str, ...]:
    """누락은 빈 배열로 관대하게, **형태 위반은 엄격하게** — 둘은 다른 사건이다."""
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ValueError(f"{label}가 배열이 아님")
    items: list[str] = []
    for i, item in enumerate(raw):
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{label}[{i}] 비정상")
        items.append(item.strip())
    return tuple(items)


def _display_length(text: str) -> int:
    """FE(`validateCaption`)의 JS `String.length`와 **같은 단위**로 센다 — UTF-16 코드유닛.

    Python `len()`(코드포인트)로 재면 갈린다: 한글 100자 + 이모지 50개 캡션이
    파이썬 150 / JS 200 이다(실측). 그 차이만큼 상한이 헐거워지면 "FE 상한을 먼저
    막는다"는 이 상수의 목적 자체가 무너진다.
    """
    return len(text.encode("utf-16-le")) // 2


def _tag_sources(ctx: ShareCardCopyContext) -> tuple[str, ...]:
    """`_tag_allowed`에 넘길 대조 문자열 — 원문 + **공백 제거형**(결정론 순서, 중복 제거).

    해시태그는 공백을 담을 수 없다. 그래서 "해운대 해수욕장" 같은 다어절 상호명은
    원문만으로는 `_tag_allowed`(소스가 태그 본문의 부분문자열)를 **구조적으로 만족할 수
    없고**, 정당한 `#해운대해수욕장`까지 전부 HASHTAG_OUT이 된다(실측). 공백 제거형을
    함께 넘겨 그 구멍만 메운다 — `_tag_allowed` 자체는 손대지 않는다
    (reflection_template 동작 무변).
    """
    out: list[str] = []
    for raw in (ctx.region, *ctx.poi_names):
        text = raw.strip()
        if not text:
            continue
        out.append(text)
        compact = "".join(text.split())
        if compact != text:
            out.append(compact)
    return tuple(dict.fromkeys(out))


def _judge(
    caption: str,
    hashtags: tuple[str, ...],
    places: tuple[str, ...],
    ctx: ShareCardCopyContext,
) -> tuple[str, ...]:
    """위반 사유를 결정론 순서(캡션 → 장소 → 해시태그)로 모은다. 빈 튜플 = 통과."""
    violations: list[str] = []

    # ① 시간 표현 (INV-3) · ② 자리표시자 어휘 — 캡션
    violations.extend(_text_violations(caption, "caption"))

    # ④ FE 캡션 상한 (FE와 같은 단위 — UTF-16 코드유닛)
    length = _display_length(caption)
    if length > CAPTION_MAX_LENGTH:
        violations.append(f"CAPTION_LEN: 캡션 {length}자 > {CAPTION_MAX_LENGTH}자")

    # ③ 장소 실재 (INV-1 사영) — 양방향 교차
    allowed_names = {n.strip() for n in ctx.poi_names if n.strip()}
    for place in places:
        if place not in allowed_names:
            violations.append(f"PLACE_NOT_FOUND: 방문 기록 밖 장소 ({place})")
        elif place not in caption:
            # 신고만 하고 캡션엔 없는 장소 — 교차가 무의미해지므로 같은 등급으로 막는다
            violations.append(f"PLACE_NOT_FOUND: 캡션에 없는 장소 신고 ({place})")

    # ⑤ FE 해시태그 개수 상한
    if len(hashtags) > HASHTAG_MAX_COUNT:
        violations.append(
            f"HASHTAG_COUNT: 해시태그 {len(hashtags)}개 > {HASHTAG_MAX_COUNT}개")

    # ①② 해시태그 + ⑥ 허용 어휘 (지역·방문지 부분 포함 / 브랜드 정확 일치)
    sources = _tag_sources(ctx)
    for i, tag in enumerate(hashtags):
        violations.extend(_text_violations(tag, f"hashtags[{i}]"))
        if sources and not _tag_allowed(tag, sources):
            violations.append(
                f"HASHTAG_OUT: hashtags[{i}] 지역·방문지·브랜드 파생 아님 ({tag})")
    return tuple(violations)


def _text_violations(text: str, label: str) -> list[str]:
    """①② — 캡션·해시태그 공통. 판정 자체는 reflection_template 게이트 것을 쓴다."""
    found: list[str] = []
    m = _TIME_EXPR.search(text)
    if m:
        found.append(f"TIME_EXPR: {label}에 시간 표현 {m.group()!r}")
    for token in _PLACEHOLDER.findall(text):
        if token not in PLACEHOLDER_VOCAB:
            found.append(f"PLACEHOLDER_OUT: {label}에 어휘 밖 자리표시자 {{{token}}}")
    return found
