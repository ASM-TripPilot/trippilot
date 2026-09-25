"""`/ai/v1/planb/{replan,alternatives}` 별칭 — TRIP-960 1단계.

AI 경계 7종이 전부 `/ai/v1/itinerary/` 아래에 있어서 **여행 전 생성**과 **여행 중
변수 대응**이 경로로 구별되지 않았다. 그 혼동이 실제 배선 오류로 이어졌고(#744),
경로 이름이 단계·에이전트를 말해주면 같은 뒤바뀜이 리뷰에서 보인다.

증명하는 것:
  ① 새 경로가 **같은 핸들러**다 — 응답이 구 경로와 같다(사본을 만들지 않았다)
  ② 구 경로가 아직 산다 — 백엔드가 옮겨 오기 전에 지우면 전부 404 다
  ③ 계약에 둘 다 있고 operationId 가 다르다(클라이언트 생성기가 한쪽을 덮지 않는다)
  ④ 두 경로가 **같은 스키마**를 가리킨다 — 요청·응답 모델이 갈라지지 않았다
"""

from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from trippilot.api.wiring import build_dev_app

from tests.test_api_replan_wired import _DIRECTIVES, _body as _replan_body

_OLD_NEW = [
    ("/ai/v1/itinerary/replan", "/ai/v1/planb/replan"),
    ("/ai/v1/itinerary/alternatives", "/ai/v1/planb/alternatives"),
]

_CONTRACT = json.loads(
    (pathlib.Path(__file__).resolve().parents[1] / "docs" / "openapi.json").read_text()
)


def _alternatives_body() -> dict:
    return {
        "trip_id": "trip-alias",
        "trigger": {
            "kind": "MANUAL",
            "schedule_id": "trip-alias",
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
            "request_id": "alias-test",
            "requested_at": "2026-09-21T08:00:00+09:00",
            "deadline_ms": 20000,
        },
    }


_BODIES = {
    "/ai/v1/itinerary/replan": _replan_body,
    "/ai/v1/planb/replan": _replan_body,
    "/ai/v1/itinerary/alternatives": _alternatives_body,
    "/ai/v1/planb/alternatives": _alternatives_body,
}


# ── ①② 같은 핸들러 · 구 경로 생존 ──────────────────────────────────


@pytest.mark.parametrize("old,new", _OLD_NEW)
def test_alias_is_the_same_handler(old: str, new: str) -> None:
    """응답이 같다 = 사본이 아니라 같은 함수다. 사본을 뒀으면 한쪽만 고쳐져 갈라진다."""
    app = build_dev_app(directives=_DIRECTIVES)
    with TestClient(app, raise_server_exceptions=False) as client:
        a = client.post(old, json=_BODIES[old]())
        b = client.post(new, json=_BODIES[new]())

    assert a.status_code == b.status_code == 200, (a.text, b.text)
    assert a.json() == b.json(), "두 경로가 다른 결과를 냈다 — 핸들러가 갈라졌다"


@pytest.mark.parametrize("old,_new", _OLD_NEW)
def test_old_path_still_serves(old: str, _new: str) -> None:
    """**지금 지우면 전부 404 다** — 백엔드 `CALLED_PATHS` 가 아직 구 경로를 들고 있다.

    지울 조건은 그 목록에 구 경로가 0건인 것이다(TRIP-960 ④단계).
    """
    app = build_dev_app(directives=_DIRECTIVES)
    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.post(old, json=_BODIES[old]()).status_code == 200


# ── ③④ 계약 ────────────────────────────────────────────────────────


@pytest.mark.parametrize("old,new", _OLD_NEW)
def test_contract_carries_both_with_distinct_operation_ids(old: str, new: str) -> None:
    paths = _CONTRACT["paths"]
    assert old in paths and new in paths, sorted(paths)

    ids = {paths[p]["post"]["operationId"] for p in (old, new)}
    assert len(ids) == 2, f"operationId 가 겹친다 — 생성기가 한쪽을 덮는다: {ids}"


@pytest.mark.parametrize("old,new", _OLD_NEW)
def test_both_paths_point_at_the_same_schemas(old: str, new: str) -> None:
    """요청·응답 모델이 갈라지지 않았다 — `$ref` 가 같은 컴포넌트를 가리킨다."""
    def refs(path: str) -> tuple[str, str]:
        op = _CONTRACT["paths"][path]["post"]
        req = op["requestBody"]["content"]["application/json"]["schema"]["$ref"]
        res = op["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
        return req, res

    assert refs(old) == refs(new)


def test_alias_covers_exactly_the_in_trip_paths() -> None:
    """`/ai/v1/planb` 아래에 있는 것은 **여행 중** 경계뿐이다.

    generate·edit·explanations 같은 여행 전 경계가 섞여 들어오면 이름이 다시
    단계를 못 말하게 된다 — 그 순간 이 별칭이 막으려던 혼동이 돌아온다.
    """
    planb = {p for p in _CONTRACT["paths"] if p.startswith("/ai/v1/planb/")}
    assert planb == {new for _old, new in _OLD_NEW}
