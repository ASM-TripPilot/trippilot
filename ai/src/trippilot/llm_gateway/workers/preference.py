"""PreferenceScoringWorker — 취향 점수화, 경량 티어·전 일자 공용 1회 (U4 FD §3).

점수는 수치만 산출한다 — 표시용 설명은 배치된 슬롯에 한해 EXPLANATION 워커
소유 (TRIP-374, ai-prompt-design.md §2.2).

흐름: 재조회된 PersonaSummary 수령(재조회는 PersonaProvider 수집 단계 소관,
TRIP-407 — BR-U4-07 "프롬프트 입력 = 요청자 권한 하 재조회 값"은 유지) →
프롬프트 변수 조립(필드 최소화 G181, 좌표 미포함) → gateway.call. 폴백이면
TypedResult(is_fallback=True)를 그대로 반환 — 규칙 점수 실행은 호출측(U5)의
몫 (BR-U4-09).

병렬 청킹 (TRIP-378): 실측(TRIP-373·376) 점수 지연 ≈ 바닥 ~3s + 건당 ~0.2s
선형이라 큰 풀(실전 193건, 단일 호출 44.5s)은 단계 예산 14s 밖이다.
풀 > c*(적응형 청크 크기)면 poi_id 정렬 균등 분할 후 청크별 gateway.call을
스레드로 동시 실행하고 병합한다. 풀 ≤ c*는 단일 호출 현행 경로 그대로.

적응형 청크 + 벽시계 마감 (TRIP-380): 청크 크기는 단계 예산에서 공식으로
유도하고(`adaptive_chunk_size`), 청크 실행은 `as_completed` + 단계 마감으로
벽시계를 강제한다 — SDK read-timeout(바이트 간격 기준)은 총 시간을 못 막는다
(실측: 19.5s 청크가 14s 타임아웃에도 "성공" 완료, 슬로 테일이 deadline 잠식).
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, ScoredPoi, TypedResult
from trippilot.domain.observability import ScoreChunkEvent
from trippilot.domain.persona import PersonaSummary
from trippilot.llm_gateway.config import C1Config

_COMPONENT = "c1.worker.preference"


def adaptive_chunk_size(stage_budget_ms: float, cfg: C1Config) -> int:
    """단계 예산 → 청크 크기 c* (TRIP-380 적응형 공식). 예산이 바뀌면 자동 추종.

    선형 지연 모델(TRIP-373 실측: 청크 소요 ≈ base + per_item × 크기)을 안전율로
    보수화해 목표 시간을 예산 아래로 잡는다:

        T_target = stage_budget / safety        (safety 기본 2.0 — 실측 변동 3~4배)
        c*       = clamp(⌊(T_target − base) ÷ per_item⌋, chunk_min, chunk_max)

    기본 파라미터(base 3,000ms · per_item 200ms · safety 2.0)에서:
    예산 14s → c*=20 (TRIP-378 고정 상수 재현) · 10s → 10 · 8s → 5 · 4s → 5(클램프).
    내림(⌊⌋)은 보수적 선택 — 목표를 넘는 쪽이 아니라 안 넘는 쪽으로 자른다.
    """
    t_target_ms = stage_budget_ms / cfg.score_safety
    c = math.floor((t_target_ms - cfg.score_base_ms) / cfg.score_per_item_ms)
    return max(cfg.score_chunk_min, min(cfg.score_chunk_max, c))


def build_prompt_vars(pool: CandidatePool, persona: PersonaSummary) -> dict[str, str]:
    """프롬프트 변수 문자열화 — 결정론(poi_id 정렬), 좌표 미포함 (G181, PROMPT-P1).

    후보는 poi_id·카테고리·상호명만 — Poi의 coord·avg_cost 등은 넣지 않는다.
    """
    candidates = "\n".join(
        f"- {p.poi_id} | {p.category.value} | {p.name}"
        for p in sorted(pool.pois, key=lambda p: str(p.poi_id))
    )
    return {
        "taste_tags": ", ".join(t.value for t in persona.taste_tags) or "미설정",
        "companion": persona.companion.value,
        "budget": persona.budget.value,
        "candidates": candidates or "(후보 없음)",
    }


def plan_chunks(
    pool: CandidatePool, chunk_size: int, max_parallel: int
) -> tuple[CandidatePool, ...]:
    """poi_id 정렬 후 균등 분할 — 같은 풀이면 항상 같은 청크 구성 (결정론, TRIP-378).

    병렬수 N = ⌈풀 ÷ chunk_size⌉, 상한 max_parallel. 청크 크기 차는 최대 1 —
    가장 느린 청크가 벽시계를 정하므로 고정 크기 자투리(193건 → 20×9+13)가 아니라
    균형 분할(20×3+19×7)로 최대 청크를 키우지 않는다.
    """
    pois = tuple(sorted(pool.pois, key=lambda p: str(p.poi_id)))
    if not pois:
        return ()
    n = min(max_parallel, math.ceil(len(pois) / chunk_size))
    base, rem = divmod(len(pois), n)
    chunks: list[CandidatePool] = []
    start = 0
    for i in range(n):
        end = start + base + (1 if i < rem else 0)
        part = pois[start:end]
        start = end
        chunks.append(
            CandidatePool(
                poi_ids=frozenset(p.poi_id for p in part),
                pois=part,
                generated_at=pool.generated_at,
                anchor=pool.anchor,
                radius_km=pool.radius_km,
            )
        )
    return tuple(chunks)


class PreferenceScoringWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def score(
        self,
        pool: CandidatePool,
        persona: PersonaSummary,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult[tuple[ScoredPoi, ...]]:
        # 재조회는 수집 단계(PersonaProvider) 소관 — 여기는 타입 계약만 지킨다
        if not isinstance(persona, PersonaSummary):
            raise TypeError(f"persona가 PersonaSummary 아님: {type(persona).__name__}")
        # 단계 예산 = 호출측 timeout override (TRIP-376에서 이미 관통되는 값).
        # 미지정이면 게이트웨이 기본 타임아웃이 실효 예산이다 — 공식·마감 모두
        # 같은 값을 쓴다 (예산이 바뀌면 청크 크기가 자동 추종, TRIP-380).
        budget_sec = (
            timeout_sec if timeout_sec is not None else self._gateway.config.timeout_sec
        )
        chunk_size = adaptive_chunk_size(budget_sec * 1000.0, self._gateway.config)
        if len(pool.pois) <= chunk_size:
            # 풀 ≤ 청크 크기 — 단일 호출 현행 경로 그대로 (TRIP-378: 리허설 소풀 무영향)
            return self._gateway.call(
                LlmFeature.PREFERENCE_SCORING,
                build_prompt_vars(pool, persona),
                pool,
                trace_id,
                now,
                # 호출측 단계 예산이 호출 타임아웃까지 관통 (TRIP-376) — 미지정이면
                # 게이트웨이 기본(2.5s)이라 실호출 바닥 ~3s에서 항상 잘린다.
                timeout_sec=timeout_sec,
            )
        return self._score_chunked(
            pool, persona, trace_id, now, timeout_sec, chunk_size, budget_sec
        )

    def _score_chunked(
        self,
        pool: CandidatePool,
        persona: PersonaSummary,
        trace_id: TraceId,
        now: datetime,
        timeout_sec: float | None,
        chunk_size: int,
        budget_sec: float,
    ) -> TypedResult[tuple[ScoredPoi, ...]]:
        """청크별 gateway.call 동시 실행 → 벽시계 마감 → 병합 (TRIP-378·380).

        **벽시계 보장 (TRIP-380)**: `as_completed(timeout=단계 예산)`으로 마감을
        강제한다 — 마감까지 완료된 청크만 수용하므로 **점수 단계 소요 ≤ 단계
        예산이 구조적으로 보장**된다. SDK read-timeout(LlmRequest.timeout_sec)은
        바이트 간격 기준이라 총 시간을 못 막는다(실측: 19.5s 청크가 14s
        타임아웃에도 "성공" 완료 — 슬로 테일의 deadline 잠식, 이전 504 사건 동인).

        - 미완 청크는 **실패 처리** — future 강제 취소는 불가하므로 결과를
          무시한다(shutdown(wait=False), 유기 스레드의 늦은 완료는 이미 마감
          후라 폐기). 미완 청크 POI는 기존 부분실패 경로(성공분 value +
          오케스트레이터 rule_backfill) 그대로.
        - 병합 결정론: 수용된 청크들의 병합 순서는 **청크 인덱스 기준**
          (as_completed 도착 순서 아님) — 같은 입력·같은 성공 집합이면 항상
          같은 산출.
        - 스레드 안전성: 게이트웨이·렌더러·게이트는 호출 경로에 공유 가변 상태가
          없고(전부 읽기 전용 설정), LlmPort 어댑터의 openai/anthropic client는
          httpx 기반으로 클라이언트 재사용이 스레드 안전(각 SDK 공식 관례).
          trace.emit은 계약상 예외 불투과라 경쟁해도 호출을 깨지 않는다.
        - timeout_sec는 각 청크 호출에 **그대로 관통** — 청크가 작아져도 시한은
          단계 예산 기준이다 (TRIP-376 계약 유지).
        - 부분 실패: 성공 청크의 점수만 value에 싣고 is_fallback=False를 유지한다.
          실패 청크 POI는 value 부재로 드러나며(규칙 점수 보충은 호출측 몫,
          BR-U4-09), 부분 실패 사실은 error 문자열로 함께 싣는다 — TypedResult
          불변식(is_fallback=True → value=None)은 그대로다.
        - 전 청크 실패 = 단일 호출의 기존 폴백 신호와 동일 (INV-4 경로 불변).
        """
        cfg = self._gateway.config
        chunks = plan_chunks(pool, chunk_size, cfg.score_max_parallel)

        def _call(chunk: CandidatePool) -> TypedResult[tuple[ScoredPoi, ...]]:
            return self._gateway.call(
                LlmFeature.PREFERENCE_SCORING,
                build_prompt_vars(chunk, persona),
                chunk,  # 청크별 게이트는 그 청크의 부분집합 풀로 교차 (INV-1, 더 엄격)
                trace_id,
                now,
                timeout_sec=timeout_sec,
            )

        # with(=shutdown(wait=True)) 금지 — 마감 넘긴 스레드를 기다리면 벽시계
        # 보장이 깨진다. 마감 후 수동 shutdown(wait=False)로 즉시 반환한다.
        executor = ThreadPoolExecutor(max_workers=len(chunks))
        completed: dict[int, TypedResult[tuple[ScoredPoi, ...]]] = {}
        try:
            futures = {
                executor.submit(_call, chunk): i for i, chunk in enumerate(chunks)
            }
            for future in as_completed(futures, timeout=budget_sec):
                completed[futures[future]] = future.result()
        except TimeoutError:
            pass  # 단계 마감 — 미완 청크는 실패 처리 (침묵 아님: 아래에서 계측)
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

        timed_out = len(chunks) - len(completed)
        # 청크 인덱스 순 병합 준비 — 도착 순서가 아니라 인덱스가 순서다 (결정론)
        successes = {
            i: r for i, r in sorted(completed.items()) if not r.is_fallback
        }
        failed = len(completed) - len(successes)
        # 청킹 요약 관측 — 성공/실패/마감초과 수를 침묵 없이 남긴다 (INV-4).
        # 청크별 개별 계측(LlmCallRecord·FallbackEvent)은 게이트웨이가 이미 발행했다
        # (마감초과 청크는 게이트웨이 이벤트가 늦게 오거나 없을 수 있어 여기서 센다).
        self._gateway.trace.emit(
            ScoreChunkEvent(
                trace_id=trace_id,
                occurred_at=now,
                component=_COMPONENT,
                feature=LlmFeature.PREFERENCE_SCORING.value,
                pool_size=len(pool.pois),
                chunk_count=len(chunks),
                success_count=len(successes),
                failure_count=failed,
                timed_out_count=timed_out,
            )
        )

        if not successes:
            first = next((completed[i] for i in sorted(completed)), None)
            reason = (
                first.error if first is not None else f"stage_deadline:{budget_sec}s"
            )
            return TypedResult(
                value=None,
                is_fallback=True,
                error=f"all_chunks_failed:{len(chunks)}: {reason}",
                call_record=first.call_record if first is not None else None,
            )

        # 병합 — 청크 인덱스 순(= poi_id 정렬 순) 그대로, 중복 poi_id는 첫 등장
        # 우선(결정론), 병합 후 전체 풀 기준 재검 (INV-1 2겹: 청크 게이트 + 여기)
        seen: set[PoiId] = set()
        merged: list[ScoredPoi] = []
        for result in successes.values():
            for sp in result.value or ():
                if sp.poi_id in seen or not pool.contains(sp.poi_id):
                    continue
                seen.add(sp.poi_id)
                merged.append(sp)
        not_merged = failed + timed_out
        return TypedResult(
            value=tuple(merged),
            is_fallback=False,
            error=(
                f"partial_chunks_failed:{not_merged}/{len(chunks)}"
                if not_merged
                else None
            ),
            call_record=next(iter(successes.values())).call_record,
        )
