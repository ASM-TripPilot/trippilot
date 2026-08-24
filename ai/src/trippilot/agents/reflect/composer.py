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


def apply_hard_replacements(
    candidate: TemplateCandidate,
) -> ReflectionTemplate:
    """⑤ 잔존 하드 위반만 계약 §4.1 교체 맵으로 결정론 교체 — 전체 드롭 없음.

    소프트 위반은 교체하지 않는다(랭킹 감점만). 순수 함수.
    """
    template = candidate.template
    hard = [v for v in candidate.violations if v.grade is ViolationGrade.HARD]
    if not hard:
        return template

    # ── 표지 (scene_index None, detail "cover.…") ──
    cover = template.cover
    for v in hard:
        if v.scene_index is not None or not v.detail.startswith("cover."):
            continue
        if v.code is ViolationCode.VISIT_REF_OUT:
            cover = replace(cover, photo_slot=None)  # 방문 밖 참조 슬롯 제거
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
        fixes = by_scene.get(i, [])
        drop = False
        for v in fixes:
            if v.code is ViolationCode.EVENT_NOT_FOUND:
                drop = True  # EVENT 장면 생략 (교체 맵)
            elif v.code is ViolationCode.VISIT_REF_OUT:
                if scene.layout in (SceneLayout.PHOTO_FULL, SceneLayout.PHOTO_CAPTION):
                    drop = True  # PHOTO_* 는 슬롯 필수 — 장면 생략 (j06 no-photo 선례)
                else:
                    scene = replace(scene, photo_slot=None)
            elif v.code is ViolationCode.TIME_EXPR:
                scene = replace(scene, caption=SAFE_CAPTION_BY_LAYOUT[scene.layout])
            elif v.code is ViolationCode.PLACEHOLDER_OUT:
                stripped = _strip_token(scene.caption, v.detail).strip()
                scene = replace(
                    scene, caption=stripped or SAFE_CAPTION_BY_LAYOUT[scene.layout])
        if not drop:
            scenes.append(scene)

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
    return apply_hard_replacements(best)
