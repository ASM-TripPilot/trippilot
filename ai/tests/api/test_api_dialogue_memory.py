"""DELETE·GET /ai/v1/dialogue/memory — 도우미 장기 기억 파기·내보내기 경계 (assistant-orchestrator FD DE §3.3·§4.1, BR-AO-10).

증명하는 것 (실 DB·실 LLM 0 — `build_dev_app` 기본 조립 + `InMemoryDialogueMemoryStore` 주입):
  ① 미배선 앱(`create_app()`)은 두 경계 모두 503 명시 실패 (INV-4 — 빈 결과로 위장하지 않는다)
  ② DELETE 쿼리는 session_id·trip_id·account_ref 중 **정확히 하나** — 8가지 조합 전수: 하나면 200, 아니면 422
  ③ DELETE 는 200 `{deleted: n}` 이고 멱등 — 같은 호출의 두 번째는 `deleted: 0` (DEC-AO-8), 다른 계정·세션 무영향
  ④ 422 본문에 account_ref 값이 실리지 않는다 (식별자 로그·메시지 금지)
  ⑤ GET `?account_ref=` 는 그 계정 기억만 updated_at DESC 로, 항목 키 집합은 FD DE §3.3 그대로(account_ref 는 되돌리지 않는다)
  ⑥ GET 은 account_ref 필수(없으면 422) · 모르는 계정은 200 + 빈 목록(오류 아님)
  ⑦ 경계 → wiring → 스토어 관통 — 주입한 스토어의 행이 실제로 지워지고 읽힌다 (배선 게이트 선례: 스텁 전용 금지)
"""

from __future__ import annotations

import itertools
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from trippilot.agents.adapters.memory_memory_store import InMemoryDialogueMemoryStore
from trippilot.api.app import create_app
from trippilot.api.wiring import build_dev_app
from trippilot.orchestrator.dialogue_memory import expires_at_for
from trippilot.ports.memory_store_port import DialogueMemory

URL = "/ai/v1/dialogue/memory"
_KST = timezone(timedelta(hours=9))
_T0 = datetime(2026, 10, 18, 9, 0, tzinfo=_KST)
_SELECTORS = ("session_id", "trip_id", "account_ref")


def _memory(
    session_id: str, *, account_ref: str | None = "acct-a", trip_id: str | None = "trip-1",
    summary: tuple[str, ...] = ("제주 2박",), at: datetime = _T0,
) -> DialogueMemory:
    return DialogueMemory(
        session_id=session_id, account_ref=account_ref, trip_id=trip_id, summary=summary,
        summarized_turn_index=10, updated_at=at, expires_at=expires_at_for(at),
    )


def _seeded_store() -> InMemoryDialogueMemoryStore:
    """acct-a 세션 2개(옛것·새것, 여행 다름) + acct-b 세션 1개."""
    store = InMemoryDialogueMemoryStore()
    store.put(_memory("s-old", at=_T0 - timedelta(days=2)))
    store.put(_memory("s-new", trip_id="trip-2", summary=("부산 1박", "회 선호")))
    store.put(_memory("s-other", account_ref="acct-b", trip_id="trip-9"))
    return store


def _client(store: InMemoryDialogueMemoryStore | None = None) -> TestClient:
    return TestClient(build_dev_app(memory_store=store))


# ── ① 미배선 ─────────────────────────────────────────────────────────────


def test_unwired_app_returns_503_for_both_boundaries() -> None:
    client = TestClient(create_app())
    assert client.delete(URL, params={"session_id": "s-1"}).status_code == 503
    assert client.get(URL, params={"account_ref": "acct-a"}).status_code == 503


# ── ② 셋 중 정확히 하나 — 전수 ───────────────────────────────────────────


@pytest.mark.parametrize(
    "given",
    [combo for r in range(4) for combo in itertools.combinations(_SELECTORS, r)],
    ids=lambda combo: "+".join(combo) or "none",
)
def test_delete_accepts_exactly_one_selector(given: tuple[str, ...]) -> None:
    res = _client().delete(URL, params={key: f"{key}-v" for key in given})
    if len(given) == 1:
        assert res.status_code == 200, res.text
        assert res.json() == {"deleted": 0}  # 지울 것이 없어도 오류가 아니다
    else:
        assert res.status_code == 422, res.text


def test_delete_rejects_empty_selector_value() -> None:
    """`?session_id=` 처럼 빈 값은 "지정됨"이 아니다 — 422."""
    assert _client().delete(URL, params={"session_id": ""}).status_code == 422


# ── ③·⑦ 파기 관통 + 멱등 ─────────────────────────────────────────────────


def test_delete_by_account_removes_only_that_account_and_is_idempotent() -> None:
    store = _seeded_store()
    client = _client(store)
    first = client.delete(URL, params={"account_ref": "acct-a"})
    assert first.status_code == 200, first.text
    assert first.json() == {"deleted": 2}
    assert client.delete(URL, params={"account_ref": "acct-a"}).json() == {"deleted": 0}
    assert store.get("s-old") is None and store.get("s-new") is None
    assert store.get("s-other") is not None  # 다른 계정 무영향


def test_delete_by_session_and_by_trip_each_remove_one_row() -> None:
    store = _seeded_store()
    client = _client(store)
    assert client.delete(URL, params={"session_id": "s-old"}).json() == {"deleted": 1}
    assert client.delete(URL, params={"trip_id": "trip-2"}).json() == {"deleted": 1}
    assert store.get("s-other") is not None


# ── ④ 식별자 비노출 ──────────────────────────────────────────────────────


def test_delete_422_body_does_not_echo_account_ref() -> None:
    res = _client().delete(URL, params={"account_ref": "acct-secret-77", "trip_id": "trip-1"})
    assert res.status_code == 422
    assert "acct-secret-77" not in res.text


# ── ⑤·⑥ 내보내기 ─────────────────────────────────────────────────────────


def test_export_returns_that_account_newest_first_in_fd_item_shape() -> None:
    res = _client(_seeded_store()).get(URL, params={"account_ref": "acct-a"})
    assert res.status_code == 200, res.text
    memories = res.json()["memories"]
    assert [m["session_id"] for m in memories] == ["s-new", "s-old"]
    # FD DE §3.3 항목 키 그대로 — account_ref 는 요청으로 이미 아는 값이라 되돌려 싣지 않는다
    assert set(memories[0]) == {
        "session_id", "trip_id", "summary", "summarized_turn_index", "updated_at", "expires_at",
    }
    assert memories[0]["trip_id"] == "trip-2"
    assert memories[0]["summary"] == ["부산 1박", "회 선호"]
    assert memories[0]["summarized_turn_index"] == 10
    assert memories[0]["updated_at"] == _T0.isoformat()
    assert memories[0]["expires_at"] == expires_at_for(_T0).isoformat()


def test_export_unknown_account_is_empty_list_not_error() -> None:
    res = _client(_seeded_store()).get(URL, params={"account_ref": "nobody"})
    assert res.status_code == 200
    assert res.json() == {"memories": []}


def test_export_requires_account_ref() -> None:
    assert _client().get(URL).status_code == 422
    assert _client().get(URL, params={"account_ref": ""}).status_code == 422
