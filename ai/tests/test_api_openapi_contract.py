"""openapi 계약 스냅샷 드리프트 게이트 — 결정4(PR #76)의 AI측 절반 (TRIP-239).

`ai/docs/openapi.json`은 AI 경계의 **와이어 정본**이다(README-openapi.md 참조).
앱(`create_app().openapi()`)과 커밋된 계약 파일이 어긋나면 여기서 실패한다 —
스키마 변경이 계약 갱신 없이 조용히 나가는 것을 막는다(침묵 드리프트 금지, INV-4와 같은 방향).
"""

from __future__ import annotations

import json
from pathlib import Path

from trippilot.api.app import create_app

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "docs" / "openapi.json"

# 소요시간류 금지 토큰(INV-3) — **필드명** 기준. 설명 문구는 "duration을 두지 않는다"류
# 규약 서술을 담을 수 있으므로 문서 전문이 아니라 properties 키만 검사한다.
# `dwell_min`(HC3 요청 입력)은 표시 필드가 아니라 허용 — 토큰에 걸리지 않는다.
BANNED_PROPERTY_TOKENS = ("duration", "minutes", "stay_min", "travel_time", "elapsed")


def render_openapi() -> str:
    """`scripts/export_openapi.py`와 **같은 포맷**(정렬·들여쓰기 고정) — 문자열 비교 전제."""
    return json.dumps(
        create_app().openapi(), indent=2, ensure_ascii=False, sort_keys=True
    ) + "\n"


def test_openapi_matches_committed_contract() -> None:
    """앱 스키마 == 커밋된 계약 파일(문자열 동일). 어긋나면 계약 갱신 누락이다."""
    committed = CONTRACT_PATH.read_text(encoding="utf-8")
    assert render_openapi() == committed, (
        "app.openapi()와 ai/docs/openapi.json이 어긋난다 — "
        "스키마를 바꿨다면 `uv run python scripts/export_openapi.py`로 "
        "계약 파일을 같은 PR에서 갱신하라 (결정4: openapi 단일 정본 + 양쪽 코드젠)."
    )


def test_openapi_snapshot_property_names_have_no_duration_inv3() -> None:
    """INV-3 — 계약 스냅샷의 스키마 필드명 어디에도 소요시간류가 없다(거리만 표시)."""
    doc = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    offenders = [
        f"{schema_name}.{prop}"
        for schema_name, schema in doc["components"]["schemas"].items()
        for prop in schema.get("properties", {})
        if any(token in prop for token in BANNED_PROPERTY_TOKENS)
    ]
    assert offenders == [], f"INV-3 위반 — 계약에 소요시간류 필드 노출: {offenders}"


def test_openapi_snapshot_covers_boundary_routes() -> None:
    """계약 파일이 경계 3종 + 헬스체크를 담는다 — 빈/부분 스냅샷 커밋을 막는 안전핀."""
    doc = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    assert {
        "/ai/v1/itinerary/generate",
        "/ai/v1/itinerary/validate",
        "/ai/v1/itinerary/repair",
        "/health",
    } <= set(doc["paths"])
