"""openapi 계약 스냅샷 내보내기 — 결정4(PR #76)의 AI측 절반.

`create_app()`(오케스트레이터 미주입 상태)의 `app.openapi()` 결과를
`ai/docs/openapi.json`에 **정렬·들여쓰기 고정** 포맷으로 쓴다.
스키마를 바꾸는 PR은 이 스크립트를 다시 돌려 계약 파일을 같은 PR에서 갱신한다:

    cd ai && uv run python scripts/export_openapi.py

드리프트 게이트는 `tests/test_api_openapi_contract.py` — 앱과 커밋된 파일이
어긋나면 테스트가 실패한다. 포맷을 바꾸면 게이트의 직렬화도 같이 바꿔야 한다.
"""

from __future__ import annotations

import json
from pathlib import Path

from trippilot.api.app import create_app

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "docs" / "openapi.json"


def render_openapi() -> str:
    """계약 파일 정본 포맷 — 게이트 테스트가 같은 식으로 직렬화해 문자열 비교한다."""
    schema = create_app().openapi()
    return json.dumps(schema, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> None:
    CONTRACT_PATH.write_text(render_openapi(), encoding="utf-8")
    print(f"계약 파일 갱신: {CONTRACT_PATH}")


if __name__ == "__main__":
    main()
