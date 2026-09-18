"""ReflectAgent — 회고 연출 템플릿 생성 (Generation 패턴, agent-foundation FD §1).

에이전트는 **워커를 감싸는 객체**다 — 게이트웨이 워커를 생성자로 받아 들고 있고,
경계는 `run(ReflectTask)` 하나만 안다. Phase 1(텍스트)과 Phase 2(vision)의 두 갈래는
`ReflectTask.vision` 유무로 갈린다 — 진입점이 둘이면 "무엇을 부를지"를 경계가 알아야
하는데, 그 판단은 에이전트 몫이다.

```
ReflectTask ─▶ ⓐ 대표 사진 선별 (vision 요청 시 1회)  실패 → 결정론 규칙 + FallbackEvent
             ─▶ ⓑ 템플릿 생성 (최대 3회, vision·텍스트 예산 공유 #9)
             ─▶ ⓒ 랭킹·교체·봉투 (_finalize — 두 갈래 공통, 출력 스키마 동일 VIS-P3)
```

**INV-4**: `run()` 은 예외를 밖으로 던지지 않는다 — 전 시도 실패는 고정 폴백 템플릿
(`is_fallback=True`)으로 수렴하고, 밟은 계단은 `FallbackEvent(component="agents.reflect")`
로 남는다(침묵 금지). 시도별 `LlmCallRecord` 는 게이트웨이가 발행한다(BR-U4-03) —
여기서는 **폴백 전환만** 발행해 같은 강등을 두 번 세지 않는다.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime

from trippilot.agents.reflect.composer import MAX_ATTEMPTS, finalize
from trippilot.agents.reflect.highlight_rule import select_highlights
from trippilot.domain.common import TraceId
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.reflection import (
    PhotoId,
    ReflectionRequest,
    ReflectionTemplate,
    TemplateCandidate,
    VisionInput,
)
from trippilot.llm_gateway.gates.photo_highlight import DEFAULT_HIGHLIGHT_LIMIT
from trippilot.llm_gateway.workers.photo_highlight import PhotoHighlightWorker
from trippilot.llm_gateway.workers.reflection_template import ReflectionTemplateWorker
from trippilot.ports.trace_port import TracePort

_COMPONENT = "agents.reflect"


@dataclass(frozen=True, slots=True)
class ReflectTask:
    """경계 → ReflectAgent 재료 봉투 (PlanB `PlanBRagRequest` 선례 — 시한·추적도 필드로).

    - `vision`: None 이면 Phase 1(텍스트) 경로. 값이 있으면 Phase 2 — 단 하이라이트
      워커가 미주입이면 기능 부재로 텍스트 경로를 탄다(설명 워커 미배선 선례와 동일).
    - `images`: 값 타입은 `LlmImagePart` 지만 이름을 import 하지 않는다(L-3) —
      에이전트는 이미지를 열어보지 않고 워커로 전달만 하는 불투명 payload다.
    - `timeout_sec`: None 이면 게이트웨이 기본. 경계가 잔여 예산을 관통시킨다.
    """

    request: ReflectionRequest
    trace_id: TraceId
    now: datetime
    timeout_sec: float | None = None
    vision: VisionInput | None = None
    images: Mapping[PhotoId, object] = field(default_factory=dict)


class ReflectAgent:
    def __init__(
        self,
        template_worker: ReflectionTemplateWorker,
        trace: TracePort,
        *,
        highlight_worker: PhotoHighlightWorker | None = None,
    ) -> None:
        self._worker = template_worker
        self._trace = trace
        # 미주입 = Phase 2 기능 부재 (실패가 아니다) — vision 요청도 텍스트로 처리
        self._highlight = highlight_worker

    # ── 공개 API ────────────────────────────────────────────────────

    def run(self, task: ReflectTask) -> ReflectionTemplate:
        """재료 → 회고 템플릿. 예외를 던지지 않는다 (INV-4)."""
        if task.vision is not None and self._highlight is not None:
            return self._compose_vision(task, task.vision)
        return self._compose_text(task)

    # ── Phase 1 — 텍스트 ────────────────────────────────────────────

    def _compose_text(self, task: ReflectTask) -> ReflectionTemplate:
        """③~⑥ — 위반 0 후보가 나오면 조기 종료."""
        candidates: list[TemplateCandidate] = []
        for attempt in range(1, MAX_ATTEMPTS + 1):
            result = self._worker.generate(
                task.request, task.trace_id, task.now, timeout_sec=task.timeout_sec)
            if result.value is not None:
                candidate = replace(result.value, attempt=attempt)
                candidates.append(candidate)
                if not candidate.violations:
                    break
        return finalize(candidates, task.request, task.trace_id, task.now, self._trace)

    # ── Phase 2 — vision (TRIP-595, FD §6 ⓐⓑⓒ) ─────────────────────

    def _compose_vision(
        self, task: ReflectTask, vision: VisionInput
    ) -> ReflectionTemplate:
        """ⓐ 대표 사진 선별 1회 — 실패하면 결정론 규칙(highlight_rule)로 강등 + FallbackEvent
        ⓑ vision 생성 — **텍스트 시도와 총 3회 예산 공유** (#9 확정 2026-08-28: 별도
           배정이면 최악 6회 비용 2배, vision 이 3회나 실패할 상황이면 텍스트도 잘 될
           가능성이 낮다). vision 실패 시 같은 루프 안에서 텍스트로 강등하고
           FallbackEvent(stage="vision")를 발행 — 조용한 강등 금지 (BR-U6R-10)
        ⓒ 랭킹·교체·봉투는 Phase 1과 동일(finalize) — **출력 스키마 동일** (VIS-P3,
           FE 재협상 없는 드롭인)

        동의는 VisionInput 타입 + 게이트웨이 consent_ref 짝 요구의 이중 강제.
        """
        assert self._highlight is not None  # run() 이 이미 걸렀다
        trace_id, now, timeout_sec = task.trace_id, task.now, task.timeout_sec

        # ⓐ 대표 사진 — LLM 1회, 실패 시 결정론 규칙 (모드 쌍은 config 폴백 대장과 동일)
        highlight_result = self._highlight.select(
            vision, task.images, trace_id, now, timeout_sec=timeout_sec)
        if highlight_result.value is not None:
            highlight_ids = highlight_result.value
        else:
            highlight_ids = select_highlights(
                vision.photos, limit=DEFAULT_HIGHLIGHT_LIMIT)
            self._trace.emit(FallbackEvent(
                trace_id=trace_id,
                occurred_at=now,
                component=_COMPONENT,
                stage="vision",
                from_mode="llm_highlight",
                to_mode="rule_highlight",
                reason=highlight_result.error or "highlight_failed",
            ))

        # ⓑ 생성 — 공유 예산 (#9): 시도 1회 = LLM 호출 1회. vision 실패도 예산을
        # 소진한다(같은 반복에서 텍스트를 또 부르면 최악 4회가 돼 상한 3회가 깨진다).
        candidates: list[TemplateCandidate] = []
        vision_alive = True
        for attempt in range(1, MAX_ATTEMPTS + 1):
            if vision_alive:
                result = self._worker.generate_vision(
                    task.request, vision, task.images, highlight_ids, trace_id, now,
                    timeout_sec=timeout_sec)
                if result.value is None:
                    # vision 경로 포기 — 남은 예산은 텍스트가 쓴다. vision 을 재시도하지
                    # 않는 이유: 미지원·타임아웃은 다시 불러도 같고, 예산만 탄다
                    vision_alive = False
                    self._trace.emit(FallbackEvent(
                        trace_id=trace_id,
                        occurred_at=now,
                        component=_COMPONENT,
                        stage="vision",
                        from_mode="vision_template",
                        to_mode="text_template",
                        reason=result.error or "vision_failed",
                    ))
                    continue  # 이 시도는 vision 실패로 소진 (#9)
            else:
                result = self._worker.generate(
                    task.request, trace_id, now, timeout_sec=timeout_sec)
            if result.value is not None:
                candidate = replace(result.value, attempt=attempt)
                candidates.append(candidate)
                if not candidate.violations:
                    break
        return finalize(candidates, task.request, trace_id, now, self._trace)
