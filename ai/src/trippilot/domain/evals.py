"""[LLMOps] Eval 타입 (domain-entities.md §10, NFR-7.4).

프롬프트 버전 × 모델 조합의 회귀 결과를 PromptRef로 버저닝과 연결.
1차 메트릭: hallucination_rate(INV-1)·hc_pass_rate·fallback_rate·retrieval_relevance.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.prompt import PromptRef
from trippilot.domain.serialization import from_iso, to_iso


@dataclass(frozen=True, slots=True)
class EvalCase:
    case_id: str
    feature: str
    input_payload: dict
    expected: dict
    tags: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "case_id": self.case_id,
            "feature": self.feature,
            "input_payload": self.input_payload,
            "expected": self.expected,
            "tags": list(self.tags),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "EvalCase":
        return cls(
            case_id=d["case_id"],
            feature=d["feature"],
            input_payload=d["input_payload"],
            expected=d["expected"],
            tags=tuple(d["tags"]),
        )


@dataclass(frozen=True, slots=True)
class EvalScore:
    metric: str
    value: float
    passed: bool

    def to_dict(self) -> dict:
        return {"metric": self.metric, "value": self.value, "passed": self.passed}

    @classmethod
    def from_dict(cls, d: dict) -> "EvalScore":
        return cls(metric=d["metric"], value=d["value"], passed=d["passed"])


@dataclass(frozen=True, slots=True)
class EvalRun:
    run_id: str
    prompt_refs: tuple[PromptRef, ...]
    model_id: str
    executed_at: datetime
    # (case_id, scores) 쌍의 튜플
    case_results: tuple[tuple[str, tuple[EvalScore, ...]], ...]

    def to_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "prompt_refs": [p.to_dict() for p in self.prompt_refs],
            "model_id": self.model_id,
            "executed_at": to_iso(self.executed_at),
            "case_results": [
                [cid, [s.to_dict() for s in scores]]
                for cid, scores in self.case_results
            ],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "EvalRun":
        return cls(
            run_id=d["run_id"],
            prompt_refs=tuple(PromptRef.from_dict(p) for p in d["prompt_refs"]),
            model_id=d["model_id"],
            executed_at=from_iso(d["executed_at"]),
            case_results=tuple(
                (cid, tuple(EvalScore.from_dict(s) for s in scores))
                for cid, scores in d["case_results"]
            ),
        )
