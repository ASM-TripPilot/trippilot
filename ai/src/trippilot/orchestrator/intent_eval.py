"""의도 라우터 평가 지표 (intent-matching-design §6) — 라벨 발화 채점, 순수 함수.

§6 핵심 지표: intent accuracy(전체/의도별) · 경로별 비중(CONFIDENT/VOTED/LLM_DIRECT/FALLBACK)
· FALLBACK율 · p95 지연 · 혼동 행렬(EDIT vs REPLAN vs GENERATE 경계 중점 추적).
러너(`scripts/trace_intents.py --eval`)가 라우팅 결과를 모아 `score()` 에 넘기고
`format_report()` 로 찍는다. 뱅크·임계값·프롬프트 변경 시 이 수치가 회귀 근거다(§6 게이트).

OUT_OF_SCOPE 라벨의 정답 = 라우터가 **분류를 거절해** OUT_OF_SCOPE 로 폴백한 것(closed-set 밖
발화는 3차 LLM 이 "분류 불가"로 거절한다 — 설계상 올바른 동작). 라우터는 인프라 실패(키 오설정·
타임아웃·게이트웨이 부재·예외)도 같은 OUT_OF_SCOPE 폴백으로 수렴시키므로(INV-4), 그것까지
정답으로 세면 LLM 이 죽어 있어도 범위 밖 항목이 자동 정답이 돼 정확도가 부풀려진다 —
`reason` 에 거절 표지가 없는 FALLBACK 은 `unrefused_fallbacks` 로 따로 센다(정답 아님, 혼동에도 안 넣음).
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from trippilot.domain.intent import Intent, IntentMatch, MatchRoute

# §6 이 중점 추적하라는 경계 3종 — 리포트에서 따로 표시한다
BOUNDARY_INTENTS = frozenset({Intent.EDIT_SCHEDULE, Intent.REPLAN, Intent.GENERATE_SCHEDULE})
# 라우터가 "분류를 거절했다"는 표지 — intent_router 의 폴백 사유 문자열(IntentGate not_classifiable /
# 3차 결과가 라우팅 불가 라벨). 이 표지가 없는 FALLBACK 은 인프라 실패로 본다.
_REFUSAL_MARKERS = ("not_classifiable", "intent_not_routable")


def _is_refusal(match: IntentMatch) -> bool:
    reason = match.reason or ""
    return any(marker in reason for marker in _REFUSAL_MARKERS)


@dataclass(frozen=True, slots=True)
class Sample:
    """라벨 발화 1건의 라우팅 결과."""

    label: Intent
    utterance: str
    match: IntentMatch
    latency_ms: float


@dataclass(frozen=True, slots=True)
class EvalReport:
    total: int
    correct: int
    per_intent: Mapping[Intent, tuple[int, int]]  # label → (정답 수, 전체 수)
    confusions: Mapping[tuple[Intent, Intent], int]  # (label, 예측) → 건수, 오답만
    routes: Mapping[MatchRoute, int]
    p95_ms: float
    unrefused_fallbacks: int = 0  # 거절 표지 없는 FALLBACK(인프라 실패·LLM 출력 실패) — 측정 신뢰도 경고용

    @property
    def accuracy(self) -> float:
        return self.correct / self.total if self.total else 0.0

    @property
    def fallback_rate(self) -> float:
        return self.routes.get(MatchRoute.FALLBACK, 0) / self.total if self.total else 0.0


def score(samples: Iterable[Sample]) -> EvalReport:
    items = tuple(samples)
    per_intent: dict[Intent, list[int]] = {}
    confusions: Counter = Counter()
    routes: Counter = Counter()
    correct = 0
    infra = 0
    for s in items:
        bucket = per_intent.setdefault(s.label, [0, 0])
        bucket[1] += 1
        routes[s.match.match_route] += 1
        if s.match.match_route is MatchRoute.FALLBACK and not _is_refusal(s.match):
            infra += 1  # 인프라 실패 — 정답도 아니고 의미 혼동도 아니다
            continue
        if s.match.intent is s.label:
            bucket[0] += 1
            correct += 1
        else:
            confusions[(s.label, s.match.intent)] += 1
    latencies = sorted(s.latency_ms for s in items)
    p95 = latencies[max(math.ceil(0.95 * len(latencies)) - 1, 0)] if latencies else 0.0
    return EvalReport(
        total=len(items),
        correct=correct,
        per_intent={k: (v[0], v[1]) for k, v in per_intent.items()},
        confusions=dict(confusions),
        routes=dict(routes),
        p95_ms=p95,
        unrefused_fallbacks=infra,
    )


def format_report(report: EvalReport) -> str:
    """콘솔용 한국어 요약 — 숫자는 전부 report 에서 온다."""
    lines = [
        f"정확도 {report.correct}/{report.total} = {report.accuracy:.1%} · "
        f"FALLBACK율 {report.fallback_rate:.1%} · 비거절 폴백 {report.unrefused_fallbacks} · "
        f"p95 {report.p95_ms:.0f}ms",
        "경로 비중: " + " · ".join(
            f"{r.value} {report.routes.get(r, 0)}" for r in MatchRoute
        ),
    ]
    if report.per_intent:
        lines.append("의도별:")
        for intent, (c, n) in sorted(report.per_intent.items(), key=lambda kv: kv[0].value):
            flag = "" if c == n else "  ← 오답 있음"
            lines.append(f"  {intent.value:22} {c}/{n}{flag}")
    if report.confusions:
        lines.append("혼동(라벨 → 예측):")
        for (label, pred), n in sorted(
            report.confusions.items(), key=lambda kv: (-kv[1], kv[0][0].value)
        ):
            boundary = "  [경계 3종]" if {label, pred} <= BOUNDARY_INTENTS else ""
            lines.append(f"  {label.value} → {pred.value} ×{n}{boundary}")
    return "\n".join(lines)
