"""PromptRegistry — prompts/*.yaml 로드 + 결정론 렌더 (U4 FD §1, BR-U4-06).

프롬프트 실체는 저장소 내 yaml + semver (NFR-7.3). 렌더는 string.Template
치환만 — 값 변환·정렬은 하지 않는다 (변수 문자열화는 호출측=워커의 몫,
같은 입력 → 같은 프롬프트). yaml import는 이 파일 한정 (아키텍처 테스트 강제).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from string import Template

import yaml

from trippilot.domain.llm import LlmFeature
from trippilot.domain.prompt import PromptRef


@dataclass(frozen=True, slots=True)
class _Entry:
    template: str
    version: str
    prompt_id: str


def _load_entry(path: Path) -> tuple[LlmFeature, _Entry]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path.name}: 최상위가 매핑이 아님")
    try:
        feature = LlmFeature(data.get("feature"))
    except ValueError as e:
        raise ValueError(f"{path.name}: feature가 LlmFeature 밖: {data.get('feature')!r}") from e
    version = data.get("version")
    if not isinstance(version, str) or not version:
        raise ValueError(f"{path.name}: version은 비어있지 않은 문자열(semver, 따옴표 필수)")
    template = data.get("template")
    if not isinstance(template, str) or not template.strip():
        raise ValueError(f"{path.name}: template 비어있음")
    if not Template(template).is_valid():
        # 리터럴 $가 있으면 렌더가 런타임에 ValueError로 죽는다 — 로드 시점 차단 (TRIP-260 #2)
        raise ValueError(
            f"{path.name}: template 플레이스홀더 형식 오류 — 리터럴 $는 $$로 이스케이프"
        )
    return feature, _Entry(
        template=template, version=version, prompt_id=f"prompts/{path.name}"
    )


class PromptRegistry:
    """PromptRenderer Protocol 구현 — 게이트웨이 파이프라인 3단."""

    def __init__(self, root: Path) -> None:
        self._entries: dict[LlmFeature, _Entry] = {}
        for path in sorted(root.glob("*.yaml")):  # 정렬 = 로드 순서 결정론
            feature, entry = _load_entry(path)
            if feature in self._entries:
                raise ValueError(f"{path.name}: feature 중복 등록 {feature.value}")
            self._entries[feature] = entry

    def render(
        self, feature: LlmFeature, variables: Mapping[str, object]
    ) -> tuple[str, PromptRef]:
        entry = self._entries.get(feature)
        if entry is None:
            raise ValueError(f"등록된 프롬프트 없음: {feature.value}")
        for k, v in variables.items():
            if not isinstance(v, str):
                # 값 문자열화는 워커의 몫 — 레지스트리가 임의 변환하면 결정론 경계가 흐려진다
                raise ValueError(f"변수 {k}는 str이어야 함 (got {type(v).__name__})")
        try:
            prompt = Template(entry.template).substitute(variables)
        except KeyError as e:
            raise ValueError(f"템플릿 변수 누락: {e}") from e
        return prompt, PromptRef(
            prompt_id=entry.prompt_id, version=entry.version, feature=feature.value
        )
