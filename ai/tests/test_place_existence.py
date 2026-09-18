"""EXIST-P1~P8 — PlaceExistencePort · KakaoExistenceAdapter 속성 게이트 (TRIP-683).

| 속성 | 내용 |
|---|---|
| EXIST-P1 | 개수·순서 보존: 입력 N건 → 출력 N건, poi_id 순서 동일 (오염 섞여도) |
| EXIST-P2 | 상태-사유 정합: UNVERIFIED ⟺ reason. 위반 생성은 ValueError |
| **EXIST-P3** | **장애가 폐업으로 둔갑하지 않는다**: 예외·형식 밖 응답에 NOT_FOUND 0건 |
| EXIST-P4 | 호출 예산 상한: calls_used ≤ max_calls (입력이 상한보다 많아도) |
| EXIST-P5 | 마감 준수: 마감 초과 시점 이후 HTTP 호출 0건, 남은 것은 UNVERIFIED |
| EXIST-P6 | 결정론: 같은 입력·같은 fake → 같은 출력 |
| EXIST-P7 | 빈 입력: HTTP 0건, 빈 튜플 |
| EXIST-P8 | 요청 계약·무적재: x=lng·y=lat·radius·헤더, 판정에 벤더 데이터 0 |

U3 FD §4 PBT 표에는 아직 이 포트의 항이 없다(신규 — TRIP-683). 위 ID 는 그 표의
작명(POOL-P*·RES-P*)을 따른 것이고, FD 갱신 시 그대로 옮겨 붙일 수 있다.

**적대적 우선**: 성공 경로(FOUND/NOT_FOUND)보다 "전송이 죽었을 때 폐업 판정이
새어나오지 않는가"를 먼저·더 넓게 증명한다. 실측 근거상 폐업은 2.7%, 이름 미검출
노이즈는 12.3% — 장애를 "없음"으로 읽으면 멀쩡한 POI 가 대량 배제된다.

실 HTTP 호출 0건 (D37) — 전송은 FakeHttpGetJson, 시계는 FakeClock 논리 시계.
"""

from __future__ import annotations

import inspect
import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.poi_curation.adapters.kakao_existence import KakaoExistenceAdapter
from trippilot.ports.place_existence_port import (
    ExistenceQuery,
    ExistenceStatus,
    ExistenceVerdict,
    PlaceExistencePort,
)

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_http_get_json import FakeHttpGetJson
from tests.generators.poi_curation import (
    existence_queries,
    kakao_documents,
    malformed_payloads,
)

_KEY = "test-rest-key"
_ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json"
_DEADLINE_REASON = "deadline_exceeded"
_BUDGET_REASON = "call_budget_exhausted"
_MALFORMED_REASON = "malformed_response"


class _Boom(Exception):
    """전송 장애 — 메시지에 벤더 데이터를 실어 사유 누출을 함께 시험한다."""


def _adapter(
    http: FakeHttpGetJson, *, max_calls: int = 100, clock: FakeClock | None = None,
    radius_m: int = 300,
) -> KakaoExistenceAdapter:
    c = clock or FakeClock(1_000_000)   # 고정 원점 — datetime.now 금지
    return KakaoExistenceAdapter(
        http, _KEY, max_calls=max_calls, monotonic_ms=c.monotonic_ms, radius_m=radius_m
    )


def _q(pid: str, name: str = "고집돌우럭", lat: float = 33.48, lng: float = 126.5):
    return ExistenceQuery(PoiId(pid), name, GeoPoint(lat, lng))


def _reasons_ok(v: ExistenceVerdict) -> bool:
    """사유는 닫힌 집합 — 임의 문자열이 새어나오면(예: 벤더 응답 본문) 거짓."""
    if v.status is not ExistenceStatus.UNVERIFIED:
        return v.reason is None
    return (
        v.reason in {_DEADLINE_REASON, _BUDGET_REASON, _MALFORMED_REASON}
        or (v.reason or "").startswith("http_error:")
    )


# ── EXIST-P2: 상태-사유 정합 (타입이 강제한다) ──────────────────────


@given(status=st.sampled_from(list(ExistenceStatus)),
       reason=st.sampled_from([None, "", "deadline_exceeded", "http_error:X", "왜"]))
def test_exist_p2_verdict_type_enforces_status_reason_coherence(status, reason) -> None:
    """UNVERIFIED ⟺ 사유 있음. 어긋나는 조합은 **생성 자체가 불가능**해야 한다.

    UNVERIFIED 는 truthy 사유를 요구하고(빈 문자열은 사유가 아니다), 나머지
    상태는 `reason is None` 만 허용한다 — `reason=""` 를 통과시키면
    `Verdict(p, FOUND, "")` 와 `Verdict(p, FOUND)` 라는 두 정본이 생긴다.
    """
    coherent = (bool(reason) if status is ExistenceStatus.UNVERIFIED
                else reason is None)
    if coherent:
        v = ExistenceVerdict(PoiId("p"), status, reason)
        assert (v.status is ExistenceStatus.UNVERIFIED) == (v.reason is not None)
    else:
        with pytest.raises(ValueError):
            ExistenceVerdict(PoiId("p"), status, reason)


@settings(max_examples=60)
@given(queries=st.lists(existence_queries(), max_size=8),
       bodies=st.lists(st.one_of(
           st.integers(0, 3).map(kakao_documents),
           malformed_payloads(),
           st.just(_Boom("고집돌우럭 / 제주시 구좌읍")),
       ), max_size=8),
       max_calls=st.integers(-1, 10),
       deadline_ms=st.integers(-5, 5_000))
def test_exist_p2_every_produced_verdict_is_coherent(
    queries, bodies, max_calls, deadline_ms
) -> None:
    """어떤 경로(정상·형식 밖·예외·마감·예산)로 나온 판정이든 P2 를 만족한다."""
    http = FakeHttpGetJson(bodies, default=kakao_documents(1))
    out = _adapter(http, max_calls=max_calls).verify(
        tuple(queries), deadline_ms=deadline_ms
    )
    for v in out:
        assert (v.status is ExistenceStatus.UNVERIFIED) == bool(v.reason)
        assert _reasons_ok(v), v


# ── EXIST-P1: 개수·순서 보존 ────────────────────────────────────────


@settings(max_examples=80)
@given(queries=st.lists(existence_queries(), min_size=0, max_size=12),
       bodies=st.lists(st.one_of(
           st.integers(0, 2).map(kakao_documents),
           malformed_payloads(),
           st.just(_Boom("boom")),
           st.just(TimeoutError("read timed out")),
       ), max_size=12),
       max_calls=st.integers(0, 12),
       deadline_ms=st.integers(0, 3_000),
       step_ms=st.integers(0, 900))
def test_exist_p1_count_and_order_preserved_under_pollution(
    queries, bodies, max_calls, deadline_ms, step_ms
) -> None:
    """마감·예산·예외가 임의로 섞여도 N건 그대로, poi_id 순서 그대로.

    오염률 0~100% 스윕: bodies 가 비면 전부 정상 기본응답, 전부 예외면 전부 장애.
    """
    clock = FakeClock(1_000_000)
    http = FakeHttpGetJson(bodies, default=kakao_documents(1),
                           on_call=lambda: clock.advance(step_ms))
    out = _adapter(http, max_calls=max_calls, clock=clock).verify(
        tuple(queries), deadline_ms=deadline_ms
    )
    assert len(out) == len(queries)
    assert [v.poi_id for v in out] == [q.poi_id for q in queries]


@settings(max_examples=40)
@given(queries=st.lists(existence_queries(), min_size=1, max_size=6),
       deadline_ms=st.integers(0, 100_000),
       max_calls=st.integers(0, 6))
def test_exist_p1_duplicate_ids_are_not_collapsed(
    queries, deadline_ms, max_calls
) -> None:
    """같은 poi_id 가 두 번 들어오면 판정도 두 번 — 집합으로 뭉개지 않는다.

    예산이 모자라 뒤쪽이 UNVERIFIED 가 되더라도 **자리는 남는다**(P1 과 같은 근거).
    """
    dup = tuple(queries) + tuple(queries)
    http = FakeHttpGetJson(default=kakao_documents(1))
    out = _adapter(http, max_calls=max_calls).verify(dup, deadline_ms=deadline_ms)
    assert [v.poi_id for v in out] == [q.poi_id for q in dup]


# ── EXIST-P3: 장애 ≠ 폐업 (가장 중요) ───────────────────────────────


@settings(max_examples=80)
@given(queries=st.lists(existence_queries(), min_size=1, max_size=10),
       exc=st.sampled_from([
           _Boom("고집돌우럭 폐업"), TimeoutError("timed out"), ConnectionError("reset"),
           ValueError("Expecting value: line 1 column 1"), KeyError("documents"),
           OSError("dns failure"), RuntimeError("429 Too Many Requests"),
       ]))
def test_exist_p3_transport_failure_never_becomes_closure(queries, exc) -> None:
    """전송이 죽으면 전부 UNVERIFIED — NOT_FOUND 는 단 한 건도 없다."""
    http = FakeHttpGetJson(default=exc)
    out = _adapter(http).verify(tuple(queries), deadline_ms=100_000)

    assert all(v.status is ExistenceStatus.UNVERIFIED for v in out)
    assert not any(v.status is ExistenceStatus.NOT_FOUND for v in out)
    assert all((v.reason or "").startswith("http_error:") for v in out)
    assert all(type(exc).__name__ in (v.reason or "") for v in out)


@settings(max_examples=100)
@given(queries=st.lists(existence_queries(), min_size=1, max_size=10),
       bodies=st.lists(malformed_payloads(), min_size=1, max_size=10))
def test_exist_p3_malformed_payload_never_becomes_closure(queries, bodies) -> None:
    """형식 밖 응답(쓰레기 payload)은 전부 '모른다' — False 로 수렴시키지 않는다.

    벤더가 응답 스키마를 바꾸면 전 POI 가 폐업으로 찍히는 사고를 막는 속성이다.
    """
    http = FakeHttpGetJson(bodies, default=bodies[0])
    out = _adapter(http).verify(tuple(queries), deadline_ms=100_000)

    assert not any(v.status is ExistenceStatus.NOT_FOUND for v in out)
    assert all(v.status is ExistenceStatus.UNVERIFIED for v in out)
    assert all(v.reason == _MALFORMED_REASON for v in out)


@settings(max_examples=100)
@given(queries=st.lists(existence_queries(), min_size=1, max_size=10),
       kinds=st.lists(st.sampled_from(["junk", "boom"]), min_size=1, max_size=10),
       junk=malformed_payloads(),
       max_calls=st.integers(0, 10),
       deadline_ms=st.integers(0, 5_000))
def test_exist_p3_mixed_failures_yield_zero_not_found(
    queries, kinds, junk, max_calls, deadline_ms
) -> None:
    """예외·형식 밖·마감·예산이 임의 비율로 섞여도 NOT_FOUND 는 0건.

    성공 응답을 하나도 주지 않았으므로 NOT_FOUND 가 나올 근거가 없다 — 나온다면
    실패 경로 어딘가가 '없음'으로 수렴한 것이다.
    """
    script = [junk if k == "junk" else _Boom("x") for k in kinds]
    http = FakeHttpGetJson(script, default=junk)
    out = _adapter(http, max_calls=max_calls).verify(
        tuple(queries), deadline_ms=deadline_ms
    )
    assert not any(v.status is ExistenceStatus.NOT_FOUND for v in out)
    assert not any(v.status is ExistenceStatus.FOUND for v in out)


@settings(max_examples=80)
@given(queries=st.lists(existence_queries(), min_size=1, max_size=8),
       counts=st.lists(st.integers(0, 3), min_size=1, max_size=8),
       polluted=st.lists(st.booleans(), min_size=1, max_size=8),
       junk=malformed_payloads())
def test_exist_p3_not_found_count_matches_true_empty_responses(
    queries, counts, polluted, junk
) -> None:
    """NOT_FOUND 는 **정상 형식의 빈 documents** 응답에서만 나온다 (oracle 대조).

    오염 비율을 0~100% 로 스윕하며, 오염된 자리가 NOT_FOUND 를 만들어내지
    않는지 — 즉 NOT_FOUND 총수가 '진짜 빈 응답' 수와 정확히 같은지 본다.
    """
    n = len(queries)
    script: list[object] = []
    expected: list[ExistenceStatus] = []
    for i in range(n):
        if polluted[i % len(polluted)]:
            script.append(junk)
            expected.append(ExistenceStatus.UNVERIFIED)
        else:
            c = counts[i % len(counts)]
            script.append(kakao_documents(c))
            expected.append(
                ExistenceStatus.FOUND if c else ExistenceStatus.NOT_FOUND
            )
    http = FakeHttpGetJson(script)
    out = _adapter(http).verify(tuple(queries), deadline_ms=100_000)

    assert [v.status for v in out] == expected
    real_misses = sum(1 for s in expected if s is ExistenceStatus.NOT_FOUND)
    assert sum(1 for v in out if v.status is ExistenceStatus.NOT_FOUND) == real_misses


# ── EXIST-P4: 호출 예산 상한 ────────────────────────────────────────


@settings(max_examples=80)
@given(queries=st.lists(existence_queries(), max_size=15),
       max_calls=st.integers(-3, 8),
       bodies=st.lists(st.one_of(st.integers(0, 2).map(kakao_documents),
                                 malformed_payloads(),
                                 st.just(_Boom("x"))), max_size=15))
def test_exist_p4_call_budget_is_never_exceeded(queries, max_calls, bodies) -> None:
    """calls_used ≤ max_calls. 입력이 상한보다 많아도, 실패가 섞여도 (실패도 1건 소모)."""
    http = FakeHttpGetJson(bodies, default=kakao_documents(1))
    a = _adapter(http, max_calls=max_calls)
    out = a.verify(tuple(queries), deadline_ms=100_000)

    assert a.calls_used <= max(max_calls, 0)
    assert a.calls_used == len(http.calls)          # 장부와 실제 호출 일치
    assert len(http.calls) <= len(queries)
    # 예산 소진 이후로는 판정이 만들어질 수 없다 — 소진 표시는 접미(suffix)다.
    seen_exhausted = False
    for v in out:
        if v.reason == _BUDGET_REASON:
            seen_exhausted = True
        elif seen_exhausted:
            assert v.status is ExistenceStatus.UNVERIFIED, v


@settings(max_examples=60)
@given(queries=st.lists(existence_queries(), min_size=1, max_size=10),
       max_calls=st.integers(0, 4))
def test_exist_p4_budget_overflow_is_unverified_not_not_found(
    queries, max_calls
) -> None:
    """상한을 넘긴 몫은 '모른다'로 남는다 — 조용히 배제 대상이 되지 않는다."""
    http = FakeHttpGetJson(default=kakao_documents(1))
    a = _adapter(http, max_calls=max_calls)
    out = a.verify(tuple(queries), deadline_ms=100_000)

    overflow = out[max_calls:]
    assert all(v.status is ExistenceStatus.UNVERIFIED for v in overflow)
    assert all(v.reason == _BUDGET_REASON for v in overflow)
    assert a.calls_used == min(len(queries), max_calls)


@settings(max_examples=40)
@given(batches=st.lists(st.lists(existence_queries(), min_size=1, max_size=4),
                        min_size=2, max_size=4),
       max_calls=st.integers(1, 6))
def test_exist_p4_budget_is_per_verify_call(batches, max_calls) -> None:
    """예산은 **verify 1회당**이다 — 매 호출이 자기 몫을 새로 받는다.

    누적이면 앱 수명 동안 사는 `CandidatePoolBuilder` 에 꽂혔을 때 상한 소진 후
    영구히 전부 UNVERIFIED 가 되어 강등이 조용히 죽는다. 한 생성 요청 = 한 실행
    = 한 벌의 예산이다(배치용 `KakaoLocalClient` 의 "실행당 상한"과 같은 뜻).
    """
    http = FakeHttpGetJson(default=kakao_documents(1))
    a = _adapter(http, max_calls=max_calls)
    for b in batches:
        before = len(http.calls)
        a.verify(tuple(b), deadline_ms=100_000)
        # 이번 호출이 쓴 몫만 센다 — 앞 호출이 소진했어도 새로 받는다
        assert a.calls_used == len(http.calls) - before
        assert a.calls_used <= max_calls
    # 누적은 상한을 넘어도 된다(넘는 것이 정상) — 몫이 매번 갱신되므로
    assert len(http.calls) <= max_calls * len(batches)


# ── EXIST-P5: 마감 준수 ─────────────────────────────────────────────


@settings(max_examples=80)
@given(queries=st.lists(existence_queries(), min_size=1, max_size=12),
       deadline_ms=st.integers(0, 1_200),
       step_ms=st.integers(1, 400))
def test_exist_p5_no_calls_after_deadline(queries, deadline_ms, step_ms) -> None:
    """호출 1건이 step_ms 를 먹는 논리 시계에서, 마감 이후 호출은 0건."""
    clock = FakeClock(1_000_000)
    http = FakeHttpGetJson(default=kakao_documents(1),
                           on_call=lambda: clock.advance(step_ms))
    a = _adapter(http, clock=clock)
    out = a.verify(tuple(queries), deadline_ms=deadline_ms)

    budget_calls = math.ceil(deadline_ms / step_ms)      # 마감 전에 시작 가능한 최대
    assert a.calls_used <= budget_calls
    assert a.calls_used == min(len(queries), budget_calls)
    assert len(out) == len(queries)
    # 마감 표시는 접미다 — 한 번 넘기면 뒤는 전부 같은 사유.
    tail = [v for v in out if v.reason == _DEADLINE_REASON]
    if tail:
        assert out[-len(tail):] == tuple(tail)
    assert all(v.status is ExistenceStatus.UNVERIFIED
               for v in out[a.calls_used:])


@settings(max_examples=40)
@given(queries=st.lists(existence_queries(), min_size=1, max_size=8),
       deadline_ms=st.integers(-1000, 0))
def test_exist_p5_nonpositive_deadline_calls_nothing(queries, deadline_ms) -> None:
    """마감이 이미 지났으면(≤0) 단 한 건도 부르지 않고 전부 '모른다'."""
    http = FakeHttpGetJson(default=kakao_documents(1))
    a = _adapter(http)
    out = a.verify(tuple(queries), deadline_ms=deadline_ms)

    assert http.calls == []
    assert a.calls_used == 0
    assert all(v.status is ExistenceStatus.UNVERIFIED
               and v.reason == _DEADLINE_REASON for v in out)
    assert len(out) == len(queries)


@settings(max_examples=40)
@given(queries=st.lists(existence_queries(), min_size=2, max_size=8),
       deadline_ms=st.integers(1, 200),
       overrun_ms=st.integers(1, 30_000))
def test_exist_p5_slow_call_overrun_is_bounded_to_one_call(
    queries, deadline_ms, overrun_ms
) -> None:
    """느린 호출 1건이 마감을 넘겨도 그 뒤 호출은 0건.

    마감은 **호출 경계에서만** 강제된다(어댑터에 호출 단위 타임아웃이 없다) —
    초과가 '진행 중 1건'으로 묶인다는 사실을 못으로 박는다. 이 상한이 깨지면
    검증이 생성 경로 마감을 무제한으로 먹는다.
    """
    clock = FakeClock(1_000_000)
    http = FakeHttpGetJson(default=kakao_documents(1),
                           on_call=lambda: clock.advance(deadline_ms + overrun_ms))
    a = _adapter(http, clock=clock)
    out = a.verify(tuple(queries), deadline_ms=deadline_ms)

    assert a.calls_used == 1                       # 초과는 1건으로 묶인다
    assert len(http.calls) == 1
    assert all(v.reason == _DEADLINE_REASON for v in out[1:])


# ── EXIST-P6: 결정론 ────────────────────────────────────────────────


@settings(max_examples=60)
@given(queries=st.lists(existence_queries(), max_size=10),
       bodies=st.lists(st.one_of(st.integers(0, 2).map(kakao_documents),
                                 malformed_payloads(),
                                 st.just(_Boom("x"))), max_size=10),
       max_calls=st.integers(0, 10),
       deadline_ms=st.integers(0, 2_000),
       step_ms=st.integers(0, 300))
def test_exist_p6_same_input_same_output(
    queries, bodies, max_calls, deadline_ms, step_ms
) -> None:
    """같은 입력·같은 fake 두 번 → 같은 판정열, 같은 호출 수 (숨은 상태 없음)."""
    def run():
        clock = FakeClock(1_000_000)
        http = FakeHttpGetJson(bodies, default=kakao_documents(1),
                               on_call=lambda: clock.advance(step_ms))
        a = _adapter(http, max_calls=max_calls, clock=clock)
        out = a.verify(tuple(queries), deadline_ms=deadline_ms)
        return out, a.calls_used, [c[2] for c in http.calls]

    assert run() == run()


# ── EXIST-P7: 빈 입력 ───────────────────────────────────────────────


@settings(max_examples=30)
@given(deadline_ms=st.integers(-100, 10_000), max_calls=st.integers(0, 5))
def test_exist_p7_empty_input_makes_no_call(deadline_ms, max_calls) -> None:
    """빈 튜플이면 HTTP 0건, 빈 튜플 반환 — I/O 를 만들지 않는다."""
    http = FakeHttpGetJson(default=kakao_documents(1))
    a = _adapter(http, max_calls=max_calls)
    assert a.verify((), deadline_ms=deadline_ms) == ()
    assert http.calls == []
    assert a.calls_used == 0


# ── EXIST-P8: 요청 계약 · 무적재 ────────────────────────────────────


@settings(max_examples=60)
@given(queries=st.lists(existence_queries(), min_size=1, max_size=6),
       radius_m=st.integers(1, 20_000))
def test_exist_p8_request_contract(queries, radius_m) -> None:
    """좌표는 x=경도·y=위도(뒤바뀌면 엉뚱한 지점을 본다), 반경·size·인증 헤더."""
    http = FakeHttpGetJson(default=kakao_documents(1))
    _adapter(http, radius_m=radius_m).verify(tuple(queries), deadline_ms=100_000)

    assert len(http.calls) == len(queries)
    for (url, headers, params), q in zip(http.calls, queries):
        assert url == _ENDPOINT
        assert headers["Authorization"] == f"KakaoAK {_KEY}"
        assert params["query"] == q.name
        assert float(params["x"]) == q.coord.lng      # x = 경도
        assert float(params["y"]) == q.coord.lat      # y = 위도
        assert params["radius"] == str(radius_m)
        assert params["size"] == "1"


@settings(max_examples=60)
@given(queries=st.lists(existence_queries(), min_size=1, max_size=6),
       n=st.integers(1, 3))
def test_exist_p8_verdict_carries_no_vendor_data(queries, n) -> None:
    """판정에는 상호·주소·좌표가 없다 — 담을 필드가 없어야 실수로도 적재 못 한다."""
    body = kakao_documents(n)
    http = FakeHttpGetJson(default=body)
    out = _adapter(http).verify(tuple(queries), deadline_ms=100_000)

    assert all(v.status is ExistenceStatus.FOUND and v.reason is None for v in out)
    assert ExistenceVerdict.__slots__ == ("poi_id", "status", "reason")
    for v in out:
        blob = repr(v)
        assert "place_name" not in blob
        assert body["documents"][0]["place_name"] not in blob


@settings(max_examples=40)
@given(queries=st.lists(existence_queries(), min_size=1, max_size=6),
       secret=st.sampled_from(["고집돌우럭 제주시 구좌읍 1-2", "KakaoAK test-rest-key",
                               '{"documents": [{"place_name": "우진해장국"}]}']))
def test_exist_p8_error_reason_does_not_leak_message(queries, secret) -> None:
    """사유에는 예외 **종류**만 — 응답 본문·키가 섞인 메시지를 그대로 싣지 않는다."""
    http = FakeHttpGetJson(default=_Boom(secret))
    out = _adapter(http).verify(tuple(queries), deadline_ms=100_000)

    for v in out:
        assert v.reason == "http_error:_Boom"
        assert secret not in (v.reason or "")


# ── 호출 ↔ 판정 회계 (phantom 호출·판정 0) ──────────────────────────


@settings(max_examples=80)
@given(queries=st.lists(existence_queries(), max_size=12),
       bodies=st.lists(st.one_of(st.integers(0, 2).map(kakao_documents),
                                 malformed_payloads(),
                                 st.just(_Boom("x"))), max_size=12),
       max_calls=st.integers(0, 12),
       deadline_ms=st.integers(0, 2_000),
       step_ms=st.integers(0, 500))
def test_calls_account_exactly_for_verdicts(
    queries, bodies, max_calls, deadline_ms, step_ms
) -> None:
    """HTTP 호출 수 == 마감·예산으로 건너뛰지 **않은** 판정 수.

    유령 호출(판정 없는 호출)도, 유령 판정(호출 없이 만들어진 FOUND/NOT_FOUND)도
    없어야 한다.
    """
    clock = FakeClock(1_000_000)
    http = FakeHttpGetJson(bodies, default=kakao_documents(1),
                           on_call=lambda: clock.advance(step_ms))
    a = _adapter(http, max_calls=max_calls, clock=clock)
    out = a.verify(tuple(queries), deadline_ms=deadline_ms)

    skipped = sum(1 for v in out if v.reason in (_DEADLINE_REASON, _BUDGET_REASON))
    assert len(http.calls) == len(out) - skipped
    assert a.calls_used == len(http.calls)


# ── 단위: 성공 경로 최소 고정 (읽는 사람을 위한 못) ─────────────────


def test_unit_documents_present_is_found_absent_is_not_found() -> None:
    http = FakeHttpGetJson([kakao_documents(1), kakao_documents(0)])
    out = _adapter(http).verify(
        (_q("a"), _q("b", name="없는가게")), deadline_ms=10_000
    )
    assert out[0] == ExistenceVerdict(PoiId("a"), ExistenceStatus.FOUND)
    assert out[1] == ExistenceVerdict(PoiId("b"), ExistenceStatus.NOT_FOUND)


def test_unit_verify_does_not_raise_across_the_boundary() -> None:
    """DL-5: 어떤 전송 사고도 예외로 새어나가지 않는다."""
    http = FakeHttpGetJson(default=BaseException)  # 클래스 객체 — 던지지 않고 반환
    assert _adapter(http).verify((_q("a"),), deadline_ms=10_000)[0].reason == (
        _MALFORMED_REASON
    )
    for exc in (MemoryError("oom"), RecursionError("deep"), UnicodeDecodeError(
            "utf-8", b"\x80", 0, 1, "invalid start byte")):
        out = _adapter(FakeHttpGetJson(default=exc)).verify(
            (_q("a"),), deadline_ms=10_000
        )
        assert out[0].status is ExistenceStatus.UNVERIFIED


def test_adapter_satisfies_port_signature() -> None:
    """어댑터가 포트 계약(인자 이름·키워드 전용 deadline_ms)을 그대로 만족한다.

    Protocol 은 런타임 검사가 없어서(@runtime_checkable 아님) 인자 이름이 어긋나도
    조용히 지나간다 — 키워드 호출이 깨지는 드리프트를 여기서 못 박는다.
    """
    port_sig = inspect.signature(PlaceExistencePort.verify)
    impl_sig = inspect.signature(KakaoExistenceAdapter.verify)
    assert list(port_sig.parameters) == list(impl_sig.parameters)
    assert (port_sig.parameters["deadline_ms"].kind
            is inspect.Parameter.KEYWORD_ONLY
            is impl_sig.parameters["deadline_ms"].kind)

    used: PlaceExistencePort = _adapter(FakeHttpGetJson(default=kakao_documents(0)))
    assert used.verify((_q("a"),), deadline_ms=1_000)[0].status is (
        ExistenceStatus.NOT_FOUND
    )
