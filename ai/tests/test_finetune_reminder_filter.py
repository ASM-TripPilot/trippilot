"""학습 데이터 필터 — 런타임 게이트와 **같은 코드**로 거른다.

규칙이 갈라지면 학습 분포와 서빙 판정이 어긋나 통과율이 조용히 떨어진다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "finetune_reminder"))

from build_dataset import filter_samples  # noqa: E402


def _sample(body: str, places: list[str], slot_names: list[str] | None = None) -> dict:
    return {
        "slot_names": slot_names or ["성산일출봉", "우도"],
        "other_names": ["한라산"],
        "title": "오늘의 제주",
        "body": body,
        "places": places,
    }


def test_valid_sample_passes() -> None:
    kept, stats = filter_samples([_sample("성산일출봉에서 시작하는 하루예요", ["성산일출봉"])])
    assert len(kept) == 1 and stats["dropped"] == 0


def test_forbidden_token_sample_dropped() -> None:
    kept, stats = filter_samples([_sample("30분이면 도착해요", [])])
    assert kept == [] and stats["dropped"] == 1


def test_other_day_place_dropped() -> None:
    kept, stats = filter_samples([_sample("한라산이 보이네요", [])])
    assert kept == [] and stats["dropped"] == 1


def test_declared_place_not_in_body_dropped() -> None:
    """선언한 장소가 본문에 없으면 드롭."""
    kept, stats = filter_samples([_sample("우도가 예쁘네요", ["성산일출봉"])])
    assert kept == [] and stats["dropped"] == 1


def test_empty_title_dropped() -> None:
    """빈 제목은 드롭."""
    sample = _sample("우도가 멋있어요", ["우도"])
    sample["title"] = ""
    kept, stats = filter_samples([sample])
    assert kept == [] and stats["dropped"] == 1


def test_empty_body_dropped() -> None:
    """빈 본문은 드롭."""
    sample = _sample("우도가 멋있어요", ["우도"])
    sample["body"] = ""
    kept, stats = filter_samples([sample])
    assert kept == [] and stats["dropped"] == 1


def test_title_too_long_dropped() -> None:
    """제목이 20자를 넘으면 드롭."""
    sample = _sample("우도가 멋있어요", ["우도"])
    sample["title"] = "이것은 20글자를 넘는 긴 제목입니다 테스트"  # 26 chars
    kept, stats = filter_samples([sample])
    assert kept == [] and stats["dropped"] == 1


def test_body_too_long_dropped() -> None:
    """본문이 60자를 넘으면 드롭."""
    # 70-char body to ensure it exceeds the 60-char limit
    long_body = "123456789012345678901234567890123456789012345678901234567890123456789우도"
    assert len(long_body) > 60  # 71 chars
    kept, stats = filter_samples([_sample(long_body, ["우도"])])
    assert kept == [] and stats["dropped"] == 1
