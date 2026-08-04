"""LlmSolver — 체인 2차 단계 (U2 FD §2.4, AI-D06/D07).

흐름: 프롬프트 조립 → LlmPort 호출 → 파싱 → closed-set 필터(INV-1)
     → 조립 → HC 검증 → (위반 시) repair 1회 → 재검증 → 통과 시에만 반환 (INV-2).
실패·타임아웃·파싱 불가 → None (체인 다음 단계, 침묵 없음 — 관측 발행).

모델은 경로별 설정값 (AI-D07 ④: day1·Plan-B=sonnet / 백그라운드=opus) — 주입으로 받음.
개발·CI는 FakeLlm golden (D37: 실 API 호출 0).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Mapping

from trippilot.c2.config import SolverConfig
from trippilot.c2.constraints import check_all
from trippilot.c2.repair import repair
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.itinerary import (
    DaySolution,
    ItineraryProblem,
    ItinerarySolution,
    SolveMode,
    VisitSlot,
)
from trippilot.domain.observability import GateDropEvent, LlmCallRecord
from trippilot.domain.poi import Poi
from trippilot.domain.prompt import PromptRef
from trippilot.ports.llm_port import LlmPort, LlmRequest

_TRACE_ID = TraceId("solver")  # U5에서 실제 trace_id 배선 — U2는 고정 태그


class LlmSolver:
    """ChainStage. required_ms = config.llm_stage_timeout_ms."""

    name = "llm_secondary"

    def __init__(self, llm: LlmPort, poi_index: Mapping[PoiId, Poi],
                 estimator, config: SolverConfig, trace,
                 prompt_ref: PromptRef, model_id: str) -> None:
        self._llm = llm
        self._pois = poi_index
        self._est = estimator
        self._cfg = config
        self._trace = trace
        self._prompt_ref = prompt_ref
        self._model_id = model_id
        self.required_ms = config.llm_stage_timeout_ms

    def solve(self, problem: ItineraryProblem,
              remaining_ms: int) -> ItinerarySolution | None:
        request = LlmRequest(
            model_id=self._model_id,
            prompt=self._build_prompt(problem),
            prompt_ref=self._prompt_ref,
            max_tokens=1024,
            temperature=0.0,
            timeout_sec=min(self._cfg.llm_stage_timeout_ms, remaining_ms) / 1000.0,
        )
        try:
            resp = self._llm.invoke(request)
        except Exception as e:  # 타임아웃·장애 — 관측 후 다음 단계로 (침묵 금지)
            self._emit_call(success=False, in_tok=0, out_tok=0, latency=0)
            return None
        self._emit_call(success=True, in_tok=resp.input_tokens,
                        out_tok=resp.output_tokens, latency=resp.latency_ms)

        parsed = self._parse(resp.raw_text)
        if parsed is None:
            return None

        # closed-set 필터 (INV-1 — 솔버 경로의 게이트)
        whitelist = {c.poi_id for c in problem.candidates}
        score_of = {c.poi_id: c for c in problem.candidates}
        dropped: list[PoiId] = []
        total = 0
        slots_by_day: dict = {}
        for day_str, raw_slots in parsed.items():
            for raw in raw_slots:
                total += 1
                pid = PoiId(str(raw["poi_id"]))
                if pid not in whitelist:
                    dropped.append(pid)
                    continue
                try:
                    start = datetime.fromisoformat(raw["start"])
                    end = datetime.fromisoformat(raw["end"])
                except (KeyError, ValueError):
                    continue
                if start.tzinfo is None or end.tzinfo is None or start >= end:
                    continue
                sp = score_of[pid]
                slots_by_day.setdefault(start.date(), []).append(VisitSlot(
                    poi_id=pid, start_at=start, end_at=end,
                    stay_min=int((end - start).total_seconds() // 60),
                    score=sp.score, is_llm_score=sp.is_llm_score,
                ))
        if dropped:
            self._trace.emit(GateDropEvent(
                trace_id=_TRACE_ID, occurred_at=datetime.now(timezone.utc),
                component="c2_llm_solver", feature="solver_secondary",
                dropped_ids=tuple(dropped), total_count=total,
                dropped_count=len(dropped)))

        days = []
        for day in problem.days:
            slots = sorted(slots_by_day.get(day, []), key=lambda s: s.start_at)
            days.append(DaySolution(date=day, slots=tuple(slots), fixed_blocks=()))
        candidate = ItinerarySolution(
            schedule_id=problem.schedule_id, days=tuple(days),
            is_fallback=False, solve_mode=SolveMode.LLM, solver_run=None)

        # 검증 → 1회 수리 → 재검증 (INV-2: 통과분만 반환)
        if check_all(candidate, problem, self._pois, self._est) == []:
            return candidate
        result = repair(candidate, problem, self._pois, self._est)
        if result.repaired is not None and check_all(
                result.repaired, problem, self._pois, self._est) == []:
            return result.repaired
        return None

    # ── 내부 ──
    def _build_prompt(self, problem: ItineraryProblem) -> str:
        payload = {
            "days": [d.isoformat() for d in problem.days],
            "day_window": problem.day_window.to_dict(),
            "candidates": [
                {"poi_id": str(c.poi_id), "score": c.score} for c in problem.candidates
            ],
            "fixed_blocks": [fb.to_dict() for fb in problem.fixed_blocks],
            "instruction": "closed-set: candidates의 poi_id만 사용해 일자별 배치를 "
                           "JSON {days:[{date, slots:[{poi_id,start,end}]}]}로 제안",
        }
        return json.dumps(payload, ensure_ascii=False)

    def _parse(self, raw: str) -> dict | None:
        """{date_str: [slot_dict, ...]} 형태로 정규화. 실패 시 None."""
        try:
            data = json.loads(raw)
            out: dict = {}
            for day in data["days"]:
                out[day["date"]] = list(day.get("slots", []))
            return out
        except (json.JSONDecodeError, KeyError, TypeError):
            return None

    def _emit_call(self, success: bool, in_tok: int, out_tok: int, latency: int) -> None:
        self._trace.emit(LlmCallRecord(
            trace_id=_TRACE_ID, occurred_at=datetime.now(timezone.utc),
            component="c2_llm_solver", feature="solver_secondary",
            model_id=self._model_id, prompt_ref=self._prompt_ref,
            input_tokens=in_tok, output_tokens=out_tok, latency_ms=latency,
            success=success, agent=None))
