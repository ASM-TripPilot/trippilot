"""Reflect compose 코어 (TRIP-429 — FD business-logic §3 ③~⑥).

생성 루프(≤3) → 결정론 랭킹 → 하드 위반 결정론 교체 → 봉투. ④⑤는 순수 함수
(같은 후보 집합 → 같은 출력, wall-clock 미호출 — now 주입). LLM 심판(best-of-N
judge)은 금지(1차, 계약 §4.2). 3회 전부 파싱 실패면 고정 폴백 + FallbackEvent
(INV-4 — 침묵 금지).

교체 대상 판별은 게이트 위반의 (code, scene_index, detail 라벨)로 한다 —
detail 라벨은 게이트가 결정론으로 찍는 "cover.title:"·"scenes[i].…"·
"hashtags[i]:" 접두라 재파싱 없이 위치를 특정한다. 해시태그 라벨은 반드시
인덱스형이어야 한다 — 태그 문자열형은 태그 내 콜론({poi:i.name})이 파싱을
깨뜨린다 (b1624ad에서 PBT로 실측·수정).
"""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import datetime

from trippilot.agents.reflect.fallback import (
    FALLBACK_COVER_SUBTITLE,
    FALLBACK_COVER_TITLE,
    build_fallback_template,
)
from trippilot.llm_gateway.workers.reflection_template import ReflectionTemplateWorker
from trippilot.domain.common import TraceId
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.reflection import (
    PhotoSlot,
    ReflectionRequest,
    ReflectionTemplate,
    Scene,
    SceneLayout,
    TemplateCandidate,
    TemplateViolation,
    ViolationCode,
    ViolationGrade,
)
from trippilot.ports.trace_port import TracePort

MAX_ATTEMPTS = 3  # 계약 §4 — N회 생성 상한 (시간 예산 수치는 BR-U6R-14 후속)

# 교체용 고정 안전 문구 (계약 §4.1 — 스스로 금칙 0·자리표시자 어휘 내를 테스트가 고정)
SAFE_CAPTION_BY_LAYOUT: dict[SceneLayout, str] = {
    SceneLayout.PHOTO_FULL: "오래 남겨두고 싶은 장면",
    SceneLayout.PHOTO_CAPTION: "{poi:0.name}에서의 기억",
    SceneLayout.STATS: "이번 여행의 발자취를 한눈에",
    SceneLayout.MAP: "{region}에서 우리가 지나온 길",
    SceneLayout.EVENT: "계획이 바뀌어도 여행은 계속됐다",
}

_DETAIL_TOKEN = re.compile(r"\{([^{}]*)\}")  # detail 말미의 {토큰} — 게이트 포맷 고정
_HASHTAG_INDEX = re.compile(r"hashtags\[(\d+)\]")  # 게이트 라벨 인덱스형과 페어


def rank_key(candidate: TemplateCandidate) -> tuple[int, int, int, int]:
    """④ 사전식: 하드 ↑낮게 → 소프트 ↑낮게 → 장면 채움(photo_slot) ↑많게 → 차수 ↑이르게."""
    hard = sum(1 for v in candidate.violations if v.grade is ViolationGrade.HARD)
    soft = len(candidate.violations) - hard
    filled = sum(1 for s in candidate.template.scenes if s.photo_slot is not None)
    return (hard, soft, -filled, candidate.attempt)


def _strip_token(text: str, detail: str) -> str:
    """PLACEHOLDER_OUT — detail 말미 {토큰}만 제거 (계약 §4.1 '해당 토큰만')."""
    m = _DETAIL_TOKEN.search(detail)
    return text.replace("{" + m.group(1) + "}", "") if m else text


def _valid_ref_picker(template: ReflectionTemplate, valid_refs: tuple):
    """교체용 유효 방문 참조 공급기 — 결정론(입력 순서, 미사용 우선).

    이미 유효하게 쓰인 참조를 먼저 소진 목록에 넣어 중복을 줄이고, 전부
    소진되면 첫 방문을 재사용한다(중복은 소프트 위반이라 카드 보존이 우선).
    """
    allowed = frozenset(valid_refs)
    used = {
        s.photo_slot.visit_ref
        for s in template.scenes
        if s.photo_slot is not None and s.photo_slot.visit_ref in allowed
    }
    if (template.cover.photo_slot is not None
            and template.cover.photo_slot.visit_ref in allowed):
        used.add(template.cover.photo_slot.visit_ref)

    def pick():
        for ref in valid_refs:
            if ref not in used:
                used.add(ref)
                return ref
        return valid_refs[0]  # 전부 소진 — 재사용 (visits ≥ 1이 보장)

    return pick


def apply_hard_replacements(
    candidate: TemplateCandidate,
    valid_refs: tuple,
    valid_events: frozenset,
) -> ReflectionTemplate:
    """⑤ 잔존 하드 위반만 계약 §4.1 교체 맵으로 결정론 교체.

    **장면을 생략하지 않는다** (팀 결정 2026-08-25, TRIP-558): 잘못된 참조는
    유효한 값으로 갈아끼우고 캡션을 안전 문구로 바꿔 카드를 보존한다. 캡션을
    함께 바꾸는 이유 — 원 캡션이 다른 장소를 서술하면 갈아끼운 사진과 어긋나
    거짓이 된다. 소프트 위반은 교체하지 않는다(랭킹 감점만). 순수 함수.
    """
    template = candidate.template
    hard = [v for v in candidate.violations if v.grade is ViolationGrade.HARD]
    if not hard:
        return template
    pick_ref = _valid_ref_picker(template, valid_refs)

    # ── 표지 (scene_index None, detail "cover.…") ──
    cover = template.cover
    for v in hard:
        if v.scene_index is not None or not v.detail.startswith("cover."):
            continue
        if v.code is ViolationCode.VISIT_REF_OUT:
            # 슬롯 제거 대신 유효 방문으로 교체 — 표지 사진을 잃지 않는다
            cover = replace(cover, photo_slot=PhotoSlot(visit_ref=pick_ref()))
        elif v.detail.startswith("cover.title"):
            cover = replace(
                cover,
                title=(_strip_token(cover.title, v.detail).strip()
                       if v.code is ViolationCode.PLACEHOLDER_OUT else "")
                or FALLBACK_COVER_TITLE,
            )
        elif v.detail.startswith("cover.subtitle"):
            cover = replace(
                cover,
                subtitle=(_strip_token(cover.subtitle, v.detail).strip()
                          if v.code is ViolationCode.PLACEHOLDER_OUT else "")
                or FALLBACK_COVER_SUBTITLE,
            )

    # ── 장면 (scene_index 기준) ──
    by_scene: dict[int, list[TemplateViolation]] = {}
    for v in hard:
        if v.scene_index is not None:
            by_scene.setdefault(v.scene_index, []).append(v)

    scenes: list[Scene] = []
    for i, scene in enumerate(template.scenes):
        for v in by_scene.get(i, []):
            if v.code is ViolationCode.EVENT_NOT_FOUND:
                if valid_events:
                    # 실재 이벤트로 교체 (결정론: enum 값 정렬 첫 번째)
                    scene = replace(
                        scene,
                        source_event=sorted(valid_events, key=lambda e: e.value)[0],
                        caption=SAFE_CAPTION_BY_LAYOUT[scene.layout],
                    )
                else:
                    # 입력에 이벤트가 0건 — EVENT 장면의 존재 근거가 없다.
                    # 생략 대신 레이아웃 전환으로 카드를 살린다 (사진 있으면
                    # 사진 카드, 없으면 통계 카드 — 둘 다 source_event 불요)
                    layout = (SceneLayout.PHOTO_CAPTION
                              if scene.photo_slot is not None else SceneLayout.STATS)
                    scene = replace(
                        scene, layout=layout, source_event=None,
                        caption=SAFE_CAPTION_BY_LAYOUT[layout],
                    )
            elif v.code is ViolationCode.VISIT_REF_OUT:
                # 슬롯 제거·장면 생략 대신 유효 방문으로 교체. 캡션도 함께 —
                # 원 캡션이 다른 장소를 서술하면 갈아끼운 사진과 어긋난다
                scene = replace(
                    scene,
                    photo_slot=PhotoSlot(visit_ref=pick_ref()),
                    caption=SAFE_CAPTION_BY_LAYOUT[scene.layout],
                )
            elif v.code is ViolationCode.TIME_EXPR:
                scene = replace(scene, caption=SAFE_CAPTION_BY_LAYOUT[scene.layout])
            elif v.code is ViolationCode.PLACEHOLDER_OUT:
                stripped = _strip_token(scene.caption, v.detail).strip()
                scene = replace(
                    scene, caption=stripped or SAFE_CAPTION_BY_LAYOUT[scene.layout])
        scenes.append(scene)  # 카드는 항상 보존 (TRIP-558)

    # ── 해시태그 (detail "hashtags[i]: …") — 위반 태그만 인덱스로 제거.
    # 태그 문자열 재파싱 금지 — 태그 내 콜론({poi:i.name})이 split을 깨뜨린다 (PBT 실측)
    bad_idx = set()
    for v in hard:
        if v.scene_index is None:
            m = _HASHTAG_INDEX.match(v.detail)
            if m:
                bad_idx.add(int(m.group(1)))
    hashtags = tuple(
        t for i, t in enumerate(template.hashtags) if i not in bad_idx)

    return replace(template, cover=cover, scenes=tuple(scenes), hashtags=hashtags)


def compose(
    worker: ReflectionTemplateWorker,
    request: ReflectionRequest,
    trace_id: TraceId,
    now: datetime,
    trace: TracePort,
    *,
    timeout_sec: float | None = None,
) -> ReflectionTemplate:
    """③~⑥ — 시도별 관측(LlmCallRecord)은 게이트웨이가 발행(BR-U4-03), 여기선
    폴백 전환만 발행한다. 위반 0 후보가 나오면 조기 종료."""
    candidates: list[TemplateCandidate] = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        result = worker.generate(request, trace_id, now, timeout_sec=timeout_sec)
        if result.value is not None:
            candidate = replace(result.value, attempt=attempt)
            candidates.append(candidate)
            if not candidate.violations:
                break

    if not candidates:  # 전 시도 파싱 실패 — 고정 폴백 (INV-4, 침묵 금지)
        trace.emit(FallbackEvent(
            trace_id=trace_id,
            occurred_at=now,
            component="agents.reflect",
            stage="agent",
            from_mode="llm_template",
            to_mode="fixed_template",
            reason=f"reflection_all_attempts_failed:{MAX_ATTEMPTS}",
        ))
        return build_fallback_template(request.kind, trace_id, now)

    best = min(candidates, key=rank_key)
    return apply_hard_replacements(
        best,
        tuple(v.ref for v in request.visits),
        frozenset(e.kind for e in request.events),
    )
