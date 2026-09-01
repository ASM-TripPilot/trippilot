"""REFLECTION_TEMPLATE 출구 게이트 (TRIP-429 — 계약 reflection-template-design.md §4).

다른 게이트와 결이 다르다 — **위반은 드롭 사유가 아니다**: 계약 §4는 "드롭이 아니라
N회 생성 → 최선 채택"이고, 시도의 실패는 **파싱 실패(스키마 불성립)뿐**이다.
검증 가능 항목의 위반은 TemplateViolation 목록으로 동봉해 후보를 살려 반환한다
(GateOutcome.value = TemplateCandidate — FD business-logic §3 ③). N회 루프·랭킹·
장면 교체는 agents/reflect(composer, 후속) 소유 — 게이트는 판정만 한다.

파싱 실패(= error, 게이트웨이가 폴백 신호로 전환)의 경계는 도메인 타입 성립 여부다:
JSON 아님 · 최상위 {"template": …} 아님 · 필드 누락/타입 오류 · layout·source_event
enum 밖 · PHOTO_* 장면에 photo_slot 없음 · EVENT 장면에 source_event 없음 · 날짜 형식
오류 — 표현 자체가 불가능한 출력은 후보가 될 수 없다 (U4 "게이트를 통과한 값만
도메인 타입으로 승격" 규칙의 역방향).

판정은 **검증 가능한 것만** (BR-U6R-11 — 시각 서술의 사실성 게이트는 두지 않는다):
  하드 — TIME_EXPR(캡션·부제·해시태그의 시간 표현, INV-3) ·
         PLACEHOLDER_OUT(자리표시자 어휘 밖·{poi:i} 인덱스 범위 밖 — closed-set) ·
         VISIT_REF_OUT(방문 기록 밖 참조, INV-1 사영 — GateDropEvent로 계측) ·
         EVENT_NOT_FOUND(source_event 미실재)
  소프트 — CAPTION_LEN(40자 초과) · SCENE_COUNT(3~8 밖) · DUP_VISIT_REF(장면 간 중복) ·
         HASHTAG_OUT(지역·방문지·브랜드 파생 아님 — TRIP-558로 하드에서 강등)
해시태그도 TIME_EXPR·PLACEHOLDER_OUT 검사는 받고, 그쪽은 하드다 (BR-U6R-04).
장면 3~8·캡션 40자는 잠정값 (FD 미결 #4 — remote config 후보).

"error 있으면 value 비움" 불변식은 base.GateOutcome이 강제한다. 산출이 **후보 1건**
이라 "빈 결과"라는 상태가 없다 — TemplateCandidate가 성립하거나 error다
(TRIP-260 #5의 empty 정책이 적용될 자리가 아니다).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime

from trippilot.llm_gateway.gates.base import GateOutcome, _load_json_object
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.domain.reflection import (
    PLACEHOLDER_VOCAB,
    POI_PLACEHOLDER_PATTERN,
    Cover,
    PhotoSlot,
    ReflectionFormat,
    ReflectionKind,
    ReflectionTemplate,
    Scene,
    SceneLayout,
    SourceEventKind,
    TemplateCandidate,
    TemplateViolation,
    ViolationCode,
    ViolationGrade,
    VisitRef,
)

# 잠정값 (FD 미결 #4 — FE 렌더러 의견 시 값만 조정, 프롬프트 문구와 동일 값을 테스트가 고정)
_SCENE_MIN = 3
_SCENE_MAX = 8
_CAPTION_MAX = 40

# 시간 표현 (계약 §4.1 하드 — `\d+분`·`\d+시간`·`오전 \d+시`류, INV-3).
# 보수적 과잉 판정("24시 편의점" 등)은 하드 위반 → 결정론 교체 경로라 fail-safe다.
_TIME_EXPR = re.compile(
    r"\d+\s*분|\d+\s*시간|(?:오전|오후)\s*\d+\s*시|\d+\s*시(?!간)|duration",
    re.IGNORECASE,
)

# 해시태그 허용 판정 (TRIP-558 — 소프트). 지역명·방문지명을 부분 포함하거나
# 브랜드 고정 태그면 통과. "여행" 같은 범용어를 넣으면 판정이 무의미해지므로
# 브랜드는 정확 일치만 본다.
_BRAND_TAGS: frozenset[str] = frozenset({"트립파일럿", "trippilot"})

# 자리표시자 스캔 — 어휘 멤버십은 domain.reflection.PLACEHOLDER_VOCAB (closed-set)
_PLACEHOLDER = re.compile(r"\{([^{}]*)\}")
_POI_PLACEHOLDER = re.compile(POI_PLACEHOLDER_PATTERN)


@dataclass(frozen=True, slots=True)
class ReflectionTemplateContext:
    """게이트 검증 컨텍스트 — GatewayFacade.call의 pool 자리로 관통 (event_extraction 선례).

    visit_refs 순서 = 요청 visits 순서 — {poi:i.name} 인덱스 범위 판정의 기준.
    """

    kind: ReflectionKind
    visit_refs: tuple[VisitRef, ...]
    event_kinds: frozenset[SourceEventKind]
    # 해시태그 허용 판정 소스 (TRIP-558) — 지역명·방문지명. 빈 값이면 그 축은 판정 생략
    region: str = ""
    poi_names: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.visit_refs:
            raise ValueError("visit_refs ≥ 1 (BR-U6R-15)")


def _tag_allowed(tag: str, sources: tuple[str, ...]) -> bool:
    """지역명·방문지명을 부분 포함하거나 브랜드 고정 태그면 허용.

    부분 포함으로 두는 이유 — "#제주여행"처럼 지역명에 접사가 붙는 합성이
    자연스럽고, 정확 일치만 보면 정당한 태그가 전부 위반이 된다.
    """
    body = tag.lstrip("#").strip()
    if not body:
        return True  # 빈 태그는 파서가 이미 거부 — 여기선 판정 대상 아님
    if body.lower() in _BRAND_TAGS:
        return True
    return any(src.strip() and src.strip() in body for src in sources)


class ReflectionTemplateGate:
    """REFLECTION_TEMPLATE 출구 게이트 — {"template": {cover, scenes, hashtags}} → TemplateCandidate."""

    def apply(
        self,
        raw_text: str,
        pool: object,  # ReflectionTemplateContext — pool 자리로 관통 (ExitGate 계약 호환)
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        if not isinstance(pool, ReflectionTemplateContext):
            # 대조 집합 없이는 VISIT_REF_OUT·EVENT_NOT_FOUND·인덱스 범위를 판정할 수 없다
            return GateOutcome(
                value=None,
                drop_event=None,
                error="gate_error: ReflectionTemplateContext 없음 (방문·이벤트 대조 집합 필요)",
            )
        try:
            cover, scenes, hashtags = self._parse(raw_text)
        except ValueError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")

        template = ReflectionTemplate(
            # 생성 규칙은 FD 미결 #3 (요청 멱등키 파생안) — trace_id 파생 결정론 잠정값.
            template_id="rtpl-" + hashlib.sha256(str(trace_id).encode()).hexdigest()[:16],
            kind=pool.kind,
            format=ReflectionFormat.CARD_NEWS,
            generated_at=now,
            is_fallback=False,
            cover=cover,
            scenes=scenes,
            hashtags=hashtags,
        )
        violations, outside_refs, total_refs = self._judge(template, pool)

        # visit_ref 위반 poi_id는 GateDropEvent로 계측 (INV-1 사영 지표) — 후보는 유지
        drop_event = (
            GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                dropped_ids=tuple(dict.fromkeys(r.poi_id for r in outside_refs)),
                total_count=total_refs,
                dropped_count=len(outside_refs),
            )
            if outside_refs
            else None
        )
        return GateOutcome(
            value=TemplateCandidate(template=template, violations=violations),
            drop_event=drop_event,
            error=None,
        )

    # ── 파서 (스키마 불성립 = ValueError = 그 시도의 실패) ────

    @staticmethod
    def _parse(raw_text: str) -> tuple[Cover, tuple[Scene, ...], tuple[str, ...]]:
        node = _load_json_object(raw_text, "template")
        if not isinstance(node, dict):
            raise ValueError("template이 객체가 아님")
        cover = ReflectionTemplateGate._parse_cover(node.get("cover"))
        scenes_raw = node.get("scenes")
        if not isinstance(scenes_raw, list):
            raise ValueError("scenes가 배열이 아님")
        scenes = tuple(
            ReflectionTemplateGate._parse_scene(i, item)
            for i, item in enumerate(scenes_raw)
        )
        hashtags_raw = node.get("hashtags")
        if hashtags_raw is None:
            hashtags_raw = []
        if not isinstance(hashtags_raw, list):
            raise ValueError("hashtags가 배열이 아님")
        hashtags: list[str] = []
        for i, tag in enumerate(hashtags_raw):
            if not isinstance(tag, str) or not tag.strip():
                raise ValueError(f"hashtags[{i}] 비정상")
            hashtags.append(tag)
        return cover, scenes, tuple(hashtags)

    @staticmethod
    def _parse_cover(raw: object) -> Cover:
        if not isinstance(raw, dict):
            raise ValueError("cover가 객체가 아님")
        title, subtitle = raw.get("title"), raw.get("subtitle")
        if not isinstance(title, str) or not isinstance(subtitle, str):
            raise ValueError("cover.title/subtitle이 문자열이 아님")
        return Cover(
            title=title,
            subtitle=subtitle,
            photo_slot=ReflectionTemplateGate._parse_photo_slot(raw.get("photo_slot")),
        )

    @staticmethod
    def _parse_scene(index: int, item: object) -> Scene:
        if not isinstance(item, dict):
            raise ValueError(f"scenes[{index}]가 객체가 아님")
        try:
            layout = SceneLayout(item.get("layout"))
        except (ValueError, TypeError):
            raise ValueError(
                f"scenes[{index}].layout이 enum 밖: {item.get('layout')!r}"
            ) from None
        caption = item.get("caption")
        if not isinstance(caption, str):
            raise ValueError(f"scenes[{index}].caption이 문자열이 아님")
        source_raw = item.get("source_event")
        source_event = None
        if source_raw is not None:
            try:
                source_event = SourceEventKind(source_raw)
            except (ValueError, TypeError):
                raise ValueError(
                    f"scenes[{index}].source_event가 enum 밖: {source_raw!r}"
                ) from None
        try:
            return Scene(
                layout=layout,
                photo_slot=ReflectionTemplateGate._parse_photo_slot(item.get("photo_slot")),
                caption=caption,
                source_event=source_event,
            )
        except ValueError as e:  # post-init(PHOTO_*⇒slot·EVENT⇒source) 위반 = 스키마 불성립
            raise ValueError(f"scenes[{index}]: {e}") from None

    @staticmethod
    def _parse_photo_slot(raw: object) -> PhotoSlot | None:
        if raw is None:
            return None
        if not isinstance(raw, dict):
            raise ValueError("photo_slot이 객체가 아님")
        ref = raw.get("visit_ref")
        if not isinstance(ref, dict):
            raise ValueError("photo_slot.visit_ref가 객체가 아님")
        date_raw, poi_raw = ref.get("date"), ref.get("poi_id")
        if not isinstance(date_raw, str) or not isinstance(poi_raw, str) or not poi_raw:
            raise ValueError("visit_ref의 date/poi_id 비정상")
        return PhotoSlot(
            visit_ref=VisitRef(date=date.fromisoformat(date_raw), poi_id=PoiId(poi_raw))
        )

    # ── 판정 (검증 가능 항목만 — 위반은 기록, 드롭 아님) ─────

    @staticmethod
    def _judge(
        template: ReflectionTemplate, ctx: ReflectionTemplateContext
    ) -> tuple[tuple[TemplateViolation, ...], tuple[VisitRef, ...], int]:
        """위반 목록(결정론 순서: 표지 → 장면 순 → 해시태그 → 전역)과
        방문 밖 참조(계측용)·검사한 참조 총수를 돌려준다."""
        allowed = frozenset(ctx.visit_refs)
        visit_count = len(ctx.visit_refs)
        violations: list[TemplateViolation] = []
        outside: list[VisitRef] = []
        total_refs = 0

        def check_text(text: str, scene_index: int | None, label: str) -> None:
            m = _TIME_EXPR.search(text)
            if m:
                violations.append(
                    TemplateViolation(
                        grade=ViolationGrade.HARD,
                        code=ViolationCode.TIME_EXPR,
                        scene_index=scene_index,
                        detail=f"{label}: 시간 표현 {m.group()!r}",
                    )
                )
            for token in _PLACEHOLDER.findall(text):
                poi_m = _POI_PLACEHOLDER.fullmatch(token)
                if poi_m:
                    if int(poi_m.group(1)) >= visit_count:
                        violations.append(
                            TemplateViolation(
                                grade=ViolationGrade.HARD,
                                code=ViolationCode.PLACEHOLDER_OUT,
                                scene_index=scene_index,
                                detail=f"{label}: poi 인덱스 범위 밖 {{{token}}}",
                            )
                        )
                elif token not in PLACEHOLDER_VOCAB:
                    violations.append(
                        TemplateViolation(
                            grade=ViolationGrade.HARD,
                            code=ViolationCode.PLACEHOLDER_OUT,
                            scene_index=scene_index,
                            detail=f"{label}: 어휘 밖 자리표시자 {{{token}}}",
                        )
                    )

        def check_ref(ref: VisitRef, scene_index: int | None, label: str) -> None:
            nonlocal total_refs
            total_refs += 1
            if ref not in allowed:
                outside.append(ref)
                violations.append(
                    TemplateViolation(
                        grade=ViolationGrade.HARD,
                        code=ViolationCode.VISIT_REF_OUT,
                        scene_index=scene_index,
                        detail=f"{label}: 방문 기록 밖 참조 ({ref.date.isoformat()}, {ref.poi_id})",
                    )
                )

        # 표지
        check_text(template.cover.title, None, "cover.title")
        check_text(template.cover.subtitle, None, "cover.subtitle")
        if template.cover.photo_slot is not None:
            check_ref(template.cover.photo_slot.visit_ref, None, "cover.photo_slot")

        # 장면 (순서대로)
        seen_refs: set[VisitRef] = set()
        for i, scene in enumerate(template.scenes):
            check_text(scene.caption, i, f"scenes[{i}].caption")
            if len(scene.caption) > _CAPTION_MAX:
                violations.append(
                    TemplateViolation(
                        grade=ViolationGrade.SOFT,
                        code=ViolationCode.CAPTION_LEN,
                        scene_index=i,
                        detail=f"캡션 {len(scene.caption)}자 > {_CAPTION_MAX}자",
                    )
                )
            if scene.photo_slot is not None:
                ref = scene.photo_slot.visit_ref
                check_ref(ref, i, f"scenes[{i}].photo_slot")
                if ref in seen_refs:
                    violations.append(
                        TemplateViolation(
                            grade=ViolationGrade.SOFT,
                            code=ViolationCode.DUP_VISIT_REF,
                            scene_index=i,
                            detail=f"중복 visit_ref ({ref.date.isoformat()}, {ref.poi_id})",
                        )
                    )
                seen_refs.add(ref)
            if scene.source_event is not None and scene.source_event not in ctx.event_kinds:
                violations.append(
                    TemplateViolation(
                        grade=ViolationGrade.HARD,
                        code=ViolationCode.EVENT_NOT_FOUND,
                        scene_index=i,
                        detail=f"입력 이벤트에 없는 source_event: {scene.source_event.value}",
                    )
                )

        # 해시태그 — 금칙·어휘 검사(하드) + 허용 집합 판정(소프트, TRIP-558).
        # 라벨은 인덱스형 — 태그 문자열을 라벨에 실으면 태그 내 콜론({poi:i.name}
        # 자리표시자가 설계상 포함)이 composer의 재파싱을 깨뜨린다 (PBT 실측).
        sources = tuple(
            t for t in (ctx.region, *ctx.poi_names) if t and t.strip()
        )
        for i, tag in enumerate(template.hashtags):
            check_text(tag, None, f"hashtags[{i}]")
            if sources and not _tag_allowed(tag, sources):
                violations.append(
                    TemplateViolation(
                        grade=ViolationGrade.SOFT,
                        code=ViolationCode.HASHTAG_OUT,
                        scene_index=None,
                        detail=f"hashtags[{i}]: 지역·방문지·브랜드 파생 아님 ({tag})",
                    )
                )

        # 전역 (소프트)
        if not _SCENE_MIN <= len(template.scenes) <= _SCENE_MAX:
            violations.append(
                TemplateViolation(
                    grade=ViolationGrade.SOFT,
                    code=ViolationCode.SCENE_COUNT,
                    scene_index=None,
                    detail=f"장면 {len(template.scenes)}개 — 범위 {_SCENE_MIN}~{_SCENE_MAX} 밖",
                )
            )
        return tuple(violations), tuple(outside), total_refs
