"""프롬프트 참조 타입 (domain-entities.md §9, business-rules.md §4).

프롬프트 실체는 저장소 내 `prompts/*.yaml` + git 버전 관리.
모든 LlmRequest는 PromptRef 필수 — 버전 없는 LLM 호출은 타입상 불가능 (NFR-7.3).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PromptRef:
    prompt_id: str  # 저장소 내 파일 경로 (예: prompts/preference_scoring.yaml)
    version: str  # semver 문자열
    feature: str

    def __post_init__(self) -> None:
        if not self.prompt_id:
            raise ValueError("prompt_id 비어있음")
        if not self.version:
            raise ValueError("version 비어있음")

    def to_dict(self) -> dict:
        return {
            "prompt_id": self.prompt_id,
            "version": self.version,
            "feature": self.feature,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PromptRef":
        return cls(
            prompt_id=d["prompt_id"], version=d["version"], feature=d["feature"]
        )
