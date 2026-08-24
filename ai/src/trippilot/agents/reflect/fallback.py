"""고정 폴백 템플릿 빌더 (TRIP-429 — 계약 §4.3, FD business-logic §3 ⑥).

3회 전부 파싱 실패했을 때의 최후 보루 — LLM 산출물을 하나도 쓰지 않고
자리표시자·STATS·MAP 장면만으로 조립한다. 서버가 채우는 숫자·지도는 항상
참이므로 폴백도 거짓 없는 결과물이다 (INV-4 — 침묵 실패 금지, 발행은 호출측).

고정 문구는 스스로 금칙(시간 표현) 0·자리표시자 어휘 내(closed-set)여야 한다 —
FALLBACK_NUDGE_MESSAGE 선례처럼 테스트가 게이트 재적용으로 고정한다.
"""

from __future__ import annotations

import hashlib
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.reflection import (
    Cover,
    ReflectionFormat,
    ReflectionKind,
    ReflectionTemplate,
    Scene,
    SceneLayout,
)

# 계약 §3 자리표시자 기본형 — 값 채움은 FE/BE 렌더 준비 소유 (LLM·AI 계산 0)
FALLBACK_COVER_TITLE = "{region} 여행의 기록"
FALLBACK_COVER_SUBTITLE = "{region} · {start_date}~{end_date}"
FALLBACK_STATS_CAPTION = "이번 여행의 발자취를 한눈에"
FALLBACK_MAP_CAPTION = "{region}에서 우리가 지나온 길"


def build_fallback_template(
    kind: ReflectionKind, trace_id: TraceId, now: datetime
) -> ReflectionTemplate:
    """결정론 — 같은 (kind, trace_id, now)는 같은 템플릿. 장면 최소 요건은
    계약 §4.3이 폴백에 면제(STATS·MAP 2장) — SCENE_COUNT는 소프트라 산출 가능."""
    return ReflectionTemplate(
        # template_id 파생 규칙은 게이트와 동일 잠정값 (FD 미결 #3)
        template_id="rtpl-" + hashlib.sha256(str(trace_id).encode()).hexdigest()[:16],
        kind=kind,
        format=ReflectionFormat.CARD_NEWS,
        generated_at=now,
        is_fallback=True,
        cover=Cover(title=FALLBACK_COVER_TITLE, subtitle=FALLBACK_COVER_SUBTITLE),
        scenes=(
            Scene(layout=SceneLayout.STATS, photo_slot=None,
                  caption=FALLBACK_STATS_CAPTION),
            Scene(layout=SceneLayout.MAP, photo_slot=None,
                  caption=FALLBACK_MAP_CAPTION),
        ),
        hashtags=(),
    )
