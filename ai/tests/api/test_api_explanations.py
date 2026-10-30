"""TRIP-479 — 설명 분리: generate 생략 옵션 + POST /ai/v1/itinerary/explanations.

증명하는 것 (실 LLM 0 — 스파이·fake):
  ① include_explanations=false generate → 설명 워커 미호출 (요청된 생략, 강등 아님)
  ② 기본값(true) generate → 워커 호출 경로 유지 (하위호환 회귀 가드)
  ③ /explanations 성공 — slot_key(BR-U2-04) → 설명 맵 회신
  ④ LLM 폴백 → 200 + 빈 맵 + 사유 (설명은 부가 정보 — 5xx 아님, 침묵 금지)
  ⑤ 미등록 POI뿐 → no_registered_pois (근거 없이 지어내지 않음)
  ⑥ 미주입 앱 → 503
  ⑧ 여러 날 → 날마다 한 번씩 나란히 부르고 합친다 (일부 날 실패 = 성공분 + explanation_partial 사유)
"""

from __future__ import annotations

import contextvars
import threading

import pytest
from fastapi.testclient import TestClient

from trippilot.api import wiring
from trippilot.api.app import create_app
from trippilot.api.wiring import build_dev_app, demo_poi_seed
from trippilot.domain.llm import PoiExplanation, TypedResult
from trippilot.domain.common import PoiId

_SEED = demo_poi_seed()
_DAY = "2026-09-01"


class SpyExplainer:
    """ExplanationWorker 대역 — 호출 계수 + 고정 설명 반환."""

    def __init__(self, *, fallback: bool = False) -> None:
        self.calls = 0
        self.fallback = fallback

    def explain(self, pool, ordered_poi_ids, persona, trace_id, now, *,
                timeout_sec=None):
        self.calls += 1
        if self.fallback:
            return TypedResult(value=None, is_fallback=True,
                               error="llm down (fake)", call_record=None)
        return TypedResult(
            value=tuple(PoiExplanation(poi_id=p, text=f"{p} 추천 이유")
                        for p in ordered_poi_ids),
            is_fallback=False, error=None, call_record=None,
        )


@pytest.fixture()
def spy(monkeypatch: pytest.MonkeyPatch) -> SpyExplainer:
    instance = SpyExplainer()
    monkeypatch.setattr(wiring, "ExplanationWorker", lambda gateway: instance)
    return instance


class SpyAltExplainer:
    """AlternativeExplanationWorker 대역 (TRIP-887) — 호출 계수 + 받은 쌍 기록 + 고정 문장."""

    def __init__(self, *, fallback: bool = False) -> None:
        self.calls = 0
        self.pairs: tuple = ()
        self.fallback = fallback

    def explain(self, pool, pairs, persona, trace_id, now, *, timeout_sec=None):
        self.calls += 1
        self.pairs = tuple((str(s), str(a)) for s, a in pairs)
        if self.fallback:
            return TypedResult(value=None, is_fallback=True,
                               error="alt llm down (fake)", call_record=None)
        return TypedResult(
            value=tuple(PoiExplanation(poi_id=a, text=f"{a} 대신 골라도 좋은 이유")
                        for _, a in pairs),
            is_fallback=False, error=None, call_record=None,
        )


@pytest.fixture()
def alt_spy(monkeypatch: pytest.MonkeyPatch) -> SpyAltExplainer:
    instance = SpyAltExplainer()
    monkeypatch.setattr(wiring, "AlternativeExplanationWorker", lambda gateway: instance)
    return instance


def _generate_body(include: bool | None) -> dict:
    body = {
        "trip_id": "trip479",
        "generation_mode": "FULLY_AI",
        "trip_context": {"destinations": ["제주"], "start_date": _DAY,
                         "end_date": _DAY, "companion_type": "혼자",
                         "budget_level": "중간"},
        "anchors": [{"date": _DAY, "lat": wiring.DEMO_ANCHOR.lat,
                     "lng": wiring.DEMO_ANCHOR.lng}],
        "time_windows": [{"date": _DAY, "start": "09:00", "end": "21:00"}],
        "fixed_blocks": [],
        "preference_profile": {"styles": ["자연"], "transport_modes": ["대중교통"],
                               "budget_tier": "중간"},
        "request_meta": {"request_id": "trip479", "requested_at":
                         f"{_DAY}T08:00:00+09:00", "deadline_ms": 20000},
        "excluded_poi_ids": [],
    }
    if include is not None:
        body["include_explanations"] = include
    return body


def _slot(poi_id: str, start: str, end: str, alternatives: tuple[str, ...] = ()) -> dict:
    return {"poi_id": poi_id, "start_at": start, "end_at": end,
            "ends_next_day": False, "distance_range": None, "is_fixed": False,
            # 생성 응답의 차선책(TRIP-871)이 백엔드를 거쳐 그대로 되돌아온 모양
            "alternatives": [{"poi_id": a, "rationale": "같은 명소 후보", "distance_range": None}
                             for a in alternatives]}


def _explanations_body(*poi_ids: str, alt_of: dict[str, tuple[str, ...]] | None = None) -> dict:
    slots = [_slot(p, f"{9 + i:02d}:00:00", f"{10 + i:02d}:00:00", (alt_of or {}).get(p, ()))
             for i, p in enumerate(poi_ids)]
    return {
        "trip_id": "trip479",
        "itinerary": {"days": [{"date": _DAY, "slots": slots}],
                      "day1_ready_at": None, "explanations": {},
                      "solve_mode": "OR_TOOLS", "is_fallback": False,
                      "freshness": None, "candidates_summary": None},
        "request_meta": {"request_id": "trip479-exp", "requested_at":
                         f"{_DAY}T08:00:00+09:00"},
    }


# ── ①·② generate 생략 옵션 ──────────────────────────────────────────


def test_generate_skip_flag_never_calls_explainer(spy: SpyExplainer) -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/generate",
                               json=_generate_body(include=False))
    assert response.status_code == 200
    assert spy.calls == 0  # 요청된 생략 — 설명 LLM 경로 진입 자체가 없다
    assert response.json()["explanations"] == {}


def test_generate_default_still_calls_explainer(spy: SpyExplainer) -> None:
    """플래그 미지정 = 기존 동작 (하위호환) — 설명 경로 유지."""
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/generate",
                               json=_generate_body(include=None))
    assert response.status_code == 200
    assert spy.calls == 1
    assert response.json()["explanations"]  # 스파이 설명이 실렸다


def test_generate_default_still_calls_alternative_explainer(
    spy: SpyExplainer, alt_spy: SpyAltExplainer
) -> None:
    """generate 경로 ⑥′ 의 **배선 가드** — 합성 루트가 차선책 문장 워커를 에이전트에 넘기는가.

    /explanations 경계(③~⑤)는 같은 워커를 덮지만 **다른 주입 자리**다. 실측: 합성 루트에서
    `ScheduleAgent(alternative_explanation_worker=...)` 를 `None` 으로 끊어도 스위트 전체가
    초록이었다 — TRIP-904·#668 과 같은 부류(배선은 있는데 아무도 안 본다). 사용자 눈에
    보이는 효과(차선책 rationale 이 템플릿 → 워커 문장)로 못 박는다.

    창을 09–12 로 좁히는 것이 전제다 — 데모 시드 4건은 종일 창이면 전부 배치돼 여분이
    없고, 여분이 없으면 차선책도 ⑥′ 도 없다(빈 단언은 아무것도 증명하지 않는다).
    """
    body = _generate_body(include=None)
    body["time_windows"] = [{"date": _DAY, "start": "09:00", "end": "12:00"}]
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/generate", json=body)

    assert response.status_code == 200, response.text
    rationales = [alt["rationale"] for day in response.json()["days"]
                  for slot in day["slots"] for alt in slot["alternatives"]]
    assert rationales, "전제: 차선책이 실려야 ⑥′ 가 돈다 (TRIP-871)"
    assert alt_spy.calls == 1
    assert all("대신 골라도 좋은 이유" in r for r in rationales), rationales


# ── ③~⑤ /explanations 경계 ──────────────────────────────────────────


def test_explanations_returns_slot_keyed_map(spy: SpyExplainer) -> None:
    ids = [str(p.poi_id) for p in _SEED[:2]]
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/explanations",
                               json=_explanations_body(*ids))
    assert response.status_code == 200
    body = response.json()
    assert body["is_fallback"] is False
    assert set(body["explanations"]) == {f"{_DAY}#{p}" for p in ids}  # BR-U2-04
    assert all("추천 이유" in v for v in body["explanations"].values())


def test_explanations_use_inline_preference_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    """그 여행의 취향이 오면 EXPLANATION 프롬프트의 페르소나가 그것이다 — 없으면 종전 재조회."""
    from trippilot.domain.persona import BudgetLevel, CompanionType, PersonaSummary, TasteTag

    # 재조회분임을 가려내는 표지 — 빈 요약이면 인라인 변환이 지어낸 빈 요약과 구별되지 않는다
    mark = PersonaSummary(taste_tags=(TasteTag.NATURE,), companion=None, budget=BudgetLevel.HIGH)
    personas: list = []

    class Recording(SpyExplainer):
        def explain(self, pool, ordered_poi_ids, persona, trace_id, now, *, timeout_sec=None):
            personas.append(persona)
            return super().explain(pool, ordered_poi_ids, persona, trace_id, now, timeout_sec=timeout_sec)

    instance = Recording()
    monkeypatch.setattr(wiring, "ExplanationWorker", lambda gateway: instance)
    ids = [str(p.poi_id) for p in _SEED[:2]]
    body = _explanations_body(*ids)
    app = build_dev_app(context_store=wiring.StaticPersonaStore(mark))
    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.post("/ai/v1/itinerary/explanations", json={
            **body, "preference_profile": {"styles": ["미식"]}, "companion_type": "혼자"}).status_code == 200
        assert client.post("/ai/v1/itinerary/explanations", json=body).status_code == 200

    inline, legacy = personas
    assert inline.taste_tags == (TasteTag.FOOD,) and inline.companion is CompanionType.SOLO
    assert legacy == mark  # 없으면 종전 재조회 — 주입한 ContextStore 의 값 그대로


@pytest.mark.parametrize(("extra", "logged"), [
    ({}, ("WARNING", "persona_inline_absent")),               # 필드 없음 — 옛 백엔드이거나 백엔드가 못 실었다
    ({"preference_profile": {}}, ("INFO", "persona_unset")),  # 전 축 미설정 — 취향을 안 넣은 사용자라 정상
    ({"preference_profile": {"styles": ["미식"]}}, None),     # 실린 취향을 썼다 — 남길 것이 없다
])
def test_explanations_log_when_inline_persona_is_not_used(
    spy: SpyExplainer, caplog: pytest.LogCaptureFixture, extra: dict, logged: tuple[str, str] | None,
) -> None:
    """실린 취향을 못 써 종전 재조회(운영은 고정 요약)로 내려간 사실을 로그로 드러낸다 — 응답에 notes 칸이 없다.

    WARN 은 필드가 없을 때만이다. 미설정까지 WARN 이면 취향을 안 넣은 사용자마다 경고가 쌓여 소음이 된다.
    """
    body = {**_explanations_body(str(_SEED[0].poi_id)), **extra}
    with caplog.at_level("INFO", logger="trippilot.wiring"):
        with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
            assert client.post("/ai/v1/itinerary/explanations", json=body).status_code == 200
    lines = [(r.levelname, r.getMessage()) for r in caplog.records
             if r.getMessage().startswith("explanations persona_")]
    assert lines == ([(logged[0], f"explanations {logged[1]} trace_id=trip479-exp trip_id=trip479")]
                     if logged else [])


# ── ⑦ 차선책 문장 (TRIP-887) — 두 번째 호출, 배치 슬롯 설명과 독립 ──────


def test_explanations_alternatives_keyed_by_date_and_alt_poi(
    spy: SpyExplainer, alt_spy: SpyAltExplainer,
) -> None:
    ids = [str(p.poi_id) for p in _SEED[:2]]
    alts = tuple(str(p.poi_id) for p in _SEED[2:4])
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/explanations",
                               json=_explanations_body(*ids, alt_of={ids[0]: alts}))
    assert response.status_code == 200
    body = response.json()
    assert set(body["explanations"]) == {f"{_DAY}#{p}" for p in ids}  # 배치 슬롯 설명은 그대로
    assert body["alternative_explanations"] == {
        f"{_DAY}#{a}": f"{a} 대신 골라도 좋은 이유" for a in alts
    }
    assert body["alternatives_reason"] is None
    assert alt_spy.calls == 1 and alt_spy.pairs == tuple((ids[0], a) for a in alts)


def test_explanations_alt_fallback_keeps_slot_explanations(
    spy: SpyExplainer, monkeypatch: pytest.MonkeyPatch,
) -> None:
    alt = SpyAltExplainer(fallback=True)
    monkeypatch.setattr(wiring, "AlternativeExplanationWorker", lambda gateway: alt)
    ids = [str(p.poi_id) for p in _SEED[:2]]
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post(
            "/ai/v1/itinerary/explanations",
            json=_explanations_body(*ids, alt_of={ids[0]: (str(_SEED[2].poi_id),)}))
    body = response.json()
    assert response.status_code == 200 and body["is_fallback"] is False
    assert set(body["explanations"]) == {f"{_DAY}#{p}" for p in ids}  # 영향 없음
    assert body["alternative_explanations"] == {}
    assert body["alternatives_reason"].startswith("alternative_explanation_fallback")


def test_explanations_slot_fallback_reports_why_alternatives_were_skipped(
    monkeypatch: pytest.MonkeyPatch, alt_spy: SpyAltExplainer,
) -> None:
    """배치 설명이 실패하면 차선책은 시도조차 못 한다 — "차선책 없음"과 구별되는 사유를 싣는다."""
    monkeypatch.setattr(wiring, "ExplanationWorker",
                        lambda gateway: SpyExplainer(fallback=True))
    ids = [str(_SEED[0].poi_id)]
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        body = client.post(
            "/ai/v1/itinerary/explanations",
            json=_explanations_body(*ids, alt_of={ids[0]: (str(_SEED[2].poi_id),)})).json()
    assert body["is_fallback"] is True
    assert body["alternative_explanations"] == {}
    assert body["alternatives_reason"] == "slot_explanations_unavailable"
    assert alt_spy.calls == 0


def test_explanations_second_call_gets_only_remaining_budget(
    spy: SpyExplainer, alt_spy: SpyAltExplainer, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """두 호출의 합이 deadline 을 넘지 않는다(DL-2) — 첫 호출이 예산을 다 쓰면 두 번째는 부르지 않는다."""
    class _Burning:  # 읽을 때마다 7초 — 첫 호출 전후 차이가 7000ms
        def __init__(self) -> None:
            self.t = 0
        def monotonic_ms(self) -> int:
            self.t += 7_000
            return self.t
    monkeypatch.setattr(wiring, "MonotonicClock", _Burning)
    ids = [str(_SEED[0].poi_id)]
    body = _explanations_body(*ids, alt_of={ids[0]: (str(_SEED[2].poi_id),)})
    body["request_meta"]["deadline_ms"] = 8_000  # 잔여 1000 < explanation_min_ms(1500)
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        out = client.post("/ai/v1/itinerary/explanations", json=body).json()
    assert set(out["explanations"]) == {f"{_DAY}#{ids[0]}"}  # 첫 호출은 그대로
    assert out["alternative_explanations"] == {}
    assert out["alternatives_reason"] == "deadline:remaining=1000ms"
    assert alt_spy.calls == 0


def test_explanations_without_alternatives_skips_second_call(
    spy: SpyExplainer, alt_spy: SpyAltExplainer,
) -> None:
    ids = [str(_SEED[0].poi_id)]
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        body = client.post("/ai/v1/itinerary/explanations",
                           json=_explanations_body(*ids)).json()
    assert body["alternative_explanations"] == {} and body["alternatives_reason"] is None
    assert alt_spy.calls == 0


def test_explanations_unregistered_alternative_is_not_explained(
    spy: SpyExplainer, alt_spy: SpyAltExplainer,
) -> None:
    """정본에 없는 선택지는 설명하지 않는다(INV-1) — 호출 자체가 없고 사유가 남는다."""
    ids = [str(_SEED[0].poi_id)]
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        body = client.post("/ai/v1/itinerary/explanations",
                           json=_explanations_body(*ids, alt_of={ids[0]: ("ghost",)})).json()
    assert body["alternative_explanations"] == {}
    assert body["alternatives_reason"] == "no_registered_alternatives"
    assert alt_spy.calls == 0


def test_explanations_llm_fallback_is_honest_200(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    instance = SpyExplainer(fallback=True)
    monkeypatch.setattr(wiring, "ExplanationWorker", lambda gateway: instance)
    ids = [str(_SEED[0].poi_id)]
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/explanations",
                               json=_explanations_body(*ids))
    assert response.status_code == 200  # 설명은 부가 정보 — 5xx로 일정 흐름을 막지 않는다
    body = response.json()
    assert body["explanations"] == {} and body["is_fallback"] is True
    assert body["reason"] and "fallback" in body["reason"]


def test_explanations_unregistered_pois_report_reason(spy: SpyExplainer) -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/explanations",
                               json=_explanations_body("00000000-0000-4000-8000-999999999999"))
    assert response.status_code == 200
    body = response.json()
    assert body["explanations"] == {} and body["reason"] == "no_registered_pois"
    assert spy.calls == 0  # 근거 없는 설명을 지어내러 가지 않는다


# ── ⑧ 여러 날 — 날 묶음마다 나란히 부른다 ───────────────────────────
#
# 여행 전체를 한 번에 보내면 일정이 길수록 출력이 상한(사고 토큰 포함)을 넘어 잘리고, 잘린 JSON 은
# 통째로 버려져 그 여행은 이유가 0건이었다(운영 ai.log 2026-10-29~30). 날 단위로 나누면 한 날이
# 실패해도 나머지 날 이유는 남는다.

_DAYS = ("2026-09-01", "2026-09-02", "2026-09-03")
_A, _B, _C, _D = (str(p.poi_id) for p in _SEED[:4])
_TRUNCATED = "truncated: parse_error: JSON 아님 (fake)"


class DaySpy:
    """날 묶음 대역 — 받은 묶음·시한을 기록하고, `fail_on` POI 가 든 묶음만 실패시킨다(폴백 또는 예외).

    묶음은 풀 스레드에서 동시에 들어온다 — 기록할 값은 지역 변수로 만든 뒤 append 한다.
    `barrier` 를 주면 그 수만큼의 묶음이 **동시에** 들어와야 통과한다(순차 호출이면 깨진다).
    `block_on` POI 가 든 묶음은 `release` 가 설 때까지 붙잡힌다(시한을 넘긴 날의 재현).
    """

    def __init__(self, *, fail_on: tuple[str, ...] = (), raises: bool = False,
                 barrier: threading.Barrier | None = None,
                 block_on: tuple[str, ...] = (), release: threading.Event | None = None) -> None:
        self.chunks: list[tuple[str, ...]] = []
        self.timeouts: list[float | None] = []
        self.fail_on = frozenset(fail_on)
        self.raises = raises
        self.barrier = barrier
        self.block_on = frozenset(block_on)
        self.release = release

    def explain(self, pool, ordered_poi_ids, persona, trace_id, now, *, timeout_sec=None):
        chunk = tuple(str(p) for p in ordered_poi_ids)
        self.chunks.append(chunk)
        self.timeouts.append(timeout_sec)
        if self.barrier is not None:
            self.barrier.wait()
        if self.release is not None and self.block_on & set(chunk):
            self.release.wait(10)
        if self.fail_on & set(chunk):
            if self.raises:
                raise RuntimeError("설정 버그 (fake)")
            return TypedResult(value=None, is_fallback=True, error=_TRUNCATED, call_record=None)
        return TypedResult(
            value=tuple(PoiExplanation(poi_id=p, text=f"{p} 추천 이유") for p in ordered_poi_ids),
            is_fallback=False, error=None, call_record=None,
        )


def _install(monkeypatch: pytest.MonkeyPatch, spy: DaySpy) -> DaySpy:
    monkeypatch.setattr(wiring, "ExplanationWorker", lambda gateway: spy)
    return spy


def _days_body(*days: tuple[str, ...], deadline_ms: int | None = None) -> dict:
    """여러 날 payload — 날마다 09시부터 한 시간씩 슬롯을 깐다."""
    body = _explanations_body()
    body["itinerary"]["days"] = [
        {"date": d, "slots": [_slot(p, f"{9 + i:02d}:00:00", f"{10 + i:02d}:00:00")
                              for i, p in enumerate(ids)]}
        for d, ids in zip(_DAYS, days)
    ]
    if deadline_ms is not None:
        body["request_meta"]["deadline_ms"] = deadline_ms
    return body


def _post(body: dict) -> dict:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/explanations", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def _key(day: int, poi: str) -> str:
    return f"{_DAYS[day]}#{poi}"


def test_explanations_multi_day_calls_each_day_in_parallel_and_merges(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 세 묶음이 동시에 들어와야 장벽을 넘는다 — 순차 호출이면 첫 묶음이 5초 뒤 깨져 그날이 실패로 남는다
    spy = _install(monkeypatch, DaySpy(barrier=threading.Barrier(3, timeout=5)))
    out = _post(_days_body((_A, _B), (_C,), (_D,), deadline_ms=20_000))

    assert sorted(spy.chunks) == sorted([(_A, _B), (_C,), (_D,)])  # 날마다 한 번 — 묶음 안은 방문 순서
    assert spy.timeouts == [20.0] * 3  # 묶음마다 같은 예산 — 나란히 도니 시한은 합이 아니라 최댓값
    assert out["is_fallback"] is False and out["reason"] is None
    assert out["explanations"] == {
        _key(0, _A): f"{_A} 추천 이유", _key(0, _B): f"{_B} 추천 이유",
        _key(1, _C): f"{_C} 추천 이유", _key(2, _D): f"{_D} 추천 이유",
    }


def test_explanations_single_day_is_one_call_with_same_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """하루짜리는 종전 그대로 — 호출 1회, 미등록은 빼고 같은 곳은 처음 한 번만 방문 순서로."""
    spy = _install(monkeypatch, DaySpy())
    ghost = "00000000-0000-4000-8000-999999999999"
    out = _post(_days_body((_A, ghost, _B, _A)))

    assert spy.chunks == [(_A, _B)]
    assert spy.timeouts == [wiring.UNBOUNDED_DEADLINE_MS / 1000.0]  # deadline 미지정 = 종전 무제한 대입값
    assert out["is_fallback"] is False and out["reason"] is None
    assert set(out["explanations"]) == {_key(0, _A), _key(0, _B)}


@pytest.mark.parametrize(
    ("raises", "why"),
    [(False, f"explanation_fallback: {_TRUNCATED}"),
     (True, "explain_error: RuntimeError: 설정 버그 (fake)")],
    ids=["fallback", "exception"],
)
def test_explanations_one_day_failure_keeps_other_days_with_partial_reason(
    monkeypatch: pytest.MonkeyPatch, raises: bool, why: str,
) -> None:
    spy = _install(monkeypatch, DaySpy(fail_on=(_C,), raises=raises))
    out = _post(_days_body((_A, _B), (_C,), (_D,)))

    assert len(spy.chunks) == 3
    # 전부 아니면 전무가 아니다 — 성공한 날 이유는 싣고, 실패는 사유로 남긴다(INV-4)
    assert set(out["explanations"]) == {_key(0, _A), _key(0, _B), _key(2, _D)}
    assert out["is_fallback"] is False
    assert out["reason"] == f"explanation_partial: 실패 1/3 — {why}"


def test_explanations_all_days_failing_is_fallback(
    monkeypatch: pytest.MonkeyPatch, alt_spy: SpyAltExplainer,
) -> None:
    spy = _install(monkeypatch, DaySpy(fail_on=(_A, _B, _C)))
    body = _days_body((_A,), (_B,), (_C,))
    body["itinerary"]["days"][0]["slots"][0]["alternatives"] = [
        {"poi_id": _D, "rationale": "같은 명소 후보", "distance_range": None}]
    out = _post(body)

    assert len(spy.chunks) == 3
    assert out["explanations"] == {} and out["is_fallback"] is True
    assert out["reason"] == f"explanation_fallback: 실패 3/3 — explanation_fallback: {_TRUNCATED}"
    assert out["alternatives_reason"] == "slot_explanations_unavailable"  # 종전처럼 차선책은 시도하지 않는다
    assert alt_spy.calls == 0


def test_explanations_same_poi_on_two_days_is_explained_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """같은 곳은 처음 나온 날 묶음에서 한 번 — 키도 그날이다(종전 중복 제거 규칙 그대로)."""
    spy = _install(monkeypatch, DaySpy())
    out = _post(_days_body((_A, _B), (_B, _C)))

    assert sorted(spy.chunks) == sorted([(_A, _B), (_C,)])
    assert set(out["explanations"]) == {_key(0, _A), _key(0, _B), _key(1, _C)}


def test_explanations_day_past_deadline_counts_as_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """시한 안에 못 끝난 날은 기다리지 않는다 — 실패로 세고 나머지 날 이유로 응답한다."""
    release = threading.Event()
    _install(monkeypatch, DaySpy(block_on=(_C,), release=release))
    try:
        out = _post(_days_body((_A, _B), (_C,), (_D,), deadline_ms=1_000))
    finally:
        release.set()  # 붙잡힌 풀 스레드를 놓아 준다

    assert set(out["explanations"]) == {_key(0, _A), _key(0, _B), _key(2, _D)}
    assert out["is_fallback"] is False
    assert out["reason"] == "explanation_partial: 실패 1/3 — deadline:budget=1000ms"


def test_explain_days_carries_request_context_into_pool_threads() -> None:
    """요청 단위 contextvar 계측(도우미 턴 `llm_calls` 등)이 풀 스레드에서도 보인다 — 문맥을 안 넘기면 0 으로 센다."""
    from datetime import datetime, timezone

    from trippilot.domain.common import TraceId
    from trippilot.domain.llm import CandidatePool
    from trippilot.domain.persona import BudgetLevel, PersonaSummary

    marker: contextvars.ContextVar[str | None] = contextvars.ContextVar("explain_day_marker", default=None)
    seen: list[tuple[str, str | None]] = []

    class Recording:
        def explain(self, pool, ordered_poi_ids, persona, trace_id, now, *, timeout_sec=None):
            seen.append((threading.current_thread().name, marker.get()))
            return TypedResult(value=tuple(PoiExplanation(poi_id=p, text="#근거") for p in ordered_poi_ids),
                               is_fallback=False, error=None, call_record=None)

    now = datetime(2026, 9, 1, 8, tzinfo=timezone.utc)
    pool = CandidatePool(poi_ids=frozenset(p.poi_id for p in _SEED), pois=_SEED, generated_at=now)
    persona = PersonaSummary(taste_tags=(), companion=None, budget=BudgetLevel.MID)
    token = marker.set("request-1")
    try:
        out = wiring._explain_days(Recording(), pool, [(_SEED[0].poi_id,), (_SEED[1].poi_id,)],
                                   persona, TraceId("t"), now, budget_ms=5_000)
    finally:
        marker.reset(token)

    assert all(isinstance(o, tuple) for o in out)  # 두 날 다 성공 — 실패 사유 문자열이 아니다
    assert len(seen) == 2
    assert all(name.startswith("explain-day") and value == "request-1" for name, value in seen)


# ── ⑥ 미주입 앱 ─────────────────────────────────────────────────────


def test_unwired_app_fails_loudly() -> None:
    with TestClient(create_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/explanations",
                               json=_explanations_body(str(_SEED[0].poi_id)))
    assert response.status_code == 503
