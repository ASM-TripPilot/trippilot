"""`/ai/v1/planb/{replan,alternatives}` 단독 — TRIP-960 4단계(구 경로 삭제).

별칭 기간(1~3단계)은 끝났다: 백엔드 #758 이 상수를 옮겼고 `CALLED_PATHS` 에 구
경로 0건을 확인한 뒤 삭제 그린라이트가 왔다(2026-09-28 회신). 이 파일이 별칭
시절의 `test_planb_path_alias.py` 를 대체한다.

증명하는 것:
  ① 새 경로가 산다 — 삭제가 본선까지 지우지 않았다
  ② 구 경로가 **죽어 있다**(404) — 누가 데코레이터를 되살리면 여기서 걸린다.
     되살아나면 계약 밖 경로가 조용히 서비스되고, 다음 정리 때 또 "누가 쓰나"를
     처음부터 세야 한다
  ③ 계약에 새 경로만 있다 — openapi 가 서빙 현실과 같다
"""

from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from trippilot.api.wiring import build_dev_app

from tests.test_api_replan_wired import _DIRECTIVES, _body as _replan_body

_CUTOVER = [
    ("/ai/v1/itinerary/replan", "/ai/v1/planb/replan"),
    ("/ai/v1/itinerary/alternatives", "/ai/v1/planb/alternatives"),
]

_CONTRACT = json.loads(
    (pathlib.Path(__file__).resolve().parents[1] / "docs" / "openapi.json").read_text()
)


def _alternatives_body() -> dict:
    return {
        "trip_id": "trip-cutover",
        "trigger": {
            "kind": "MANUAL",
            "schedule_id": "trip-cutover",
            "affected_date": "2026-09-21",
            "payload": {},
        },
        "reason": "weather",
        "dates": ["2026-09-21"],
        "anchor": {"lat": 33.4996, "lng": 126.5312},
        "excluded_poi_ids": [],
        "affected_reasons": {},
        "saved_places": [],
        "request_meta": {
            "request_id": "cutover-test",
            "requested_at": "2026-09-21T08:00:00+09:00",
            "deadline_ms": 20000,
        },
    }


_BODIES = {
    "/ai/v1/planb/replan": _replan_body,
    "/ai/v1/planb/alternatives": _alternatives_body,
}


@pytest.mark.parametrize("old,new", _CUTOVER)
def test_new_path_serves_and_old_path_is_gone(old: str, new: str) -> None:
    app = build_dev_app(directives=_DIRECTIVES)
    with TestClient(app, raise_server_exceptions=False) as client:
        alive = client.post(new, json=_BODIES[new]())
        dead = client.post(old, json=_BODIES[new]())

    assert alive.status_code == 200, alive.text
    assert dead.status_code == 404, (
        f"구 경로가 되살아났다: {old} → {dead.status_code} — "
        "TRIP-960 4단계에서 지웠고 백엔드 상수에 0건이다")


@pytest.mark.parametrize("old,new", _CUTOVER)
def test_contract_carries_only_the_new_path(old: str, new: str) -> None:
    paths = _CONTRACT["paths"]
    assert new in paths, sorted(paths)
    assert old not in paths, f"계약에 구 경로가 남았다 — 재생성 누락: {old}"
