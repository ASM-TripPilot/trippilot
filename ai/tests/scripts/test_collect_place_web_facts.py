"""웹 확인 사실 수집기의 거름 — 검색이 본 URL·짧은 사실·시각·가격·평가·연락처·옛 글 없음(2026-10-23)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "collect" / "collect_place_web_facts.py"
spec = importlib.util.spec_from_file_location("collect_place_web_facts_under_test", _SCRIPT)
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def _rec(*facts, cites=("u1",)):
    return {"citations": list(cites), "facts": [dict(text=t, url=u, date=d) for t, u, d in facts]}


def test_only_urls_the_search_actually_saw_survive() -> None:
    got = c.clean_facts(_rec(("바 좌석이 있음", "u1", None), ("2층 테라스", "made-up", None)))
    assert [f["text"] for f in got] == ["바 좌석이 있음"]


def test_times_prices_durations_contacts_and_praise_are_dropped() -> None:
    bad = ["매일 11시 오픈", "주차 30분 무료", "아메리카노 3,900원", "둘러보는 데 1시간", "전화 예약 필수", "맛있는 국밥", "친절한 사장님"]
    assert c.clean_facts(_rec(*[(t, "u1", None) for t in bad])) == []


def test_old_posts_are_dropped_but_undated_and_recent_ones_stay() -> None:
    got = c.clean_facts(_rec(("오래된 사실", "u1", "2018-06"), ("최근 사실", "u1", "2024-02"), ("날짜 모름", "u1", None)))
    assert [f["text"] for f in got] == ["최근 사실", "날짜 모름"]


def test_targets_put_places_without_documents_first_and_skip_stays() -> None:
    props = [
        {"source": "TOURAPI", "region": "제주시", "poi": {"name": "명소", "category": "SIGHT"}, "provenance": {"content_id": "1"}},
        {"source": "LOCALDATA", "region": "제주시", "poi": {"name": "식당", "category": "FOOD"}, "provenance": {"content_id": "2"}},
        {"source": "TOURAPI", "region": "제주시", "poi": {"name": "호텔", "category": "STAY"}, "provenance": {"content_id": "3"}},
    ]
    got = c.targets(props, has_doc={"1"})
    assert [t["ref"] for t in got] == ["2", "1"]


def test_targets_fill_what_nothing_else_covers_first() -> None:
    def prop(ref: str, source: str) -> dict:
        return {"source": source, "region": "제주시", "poi": {"name": ref, "category": "FOOD"}, "provenance": {"content_id": ref}}

    props = [prop("real", "TOURAPI"), prop("card", "TOURAPI"), prop("tour", "TOURAPI"), prop("local", "LOCALDATA"), prop("map", "OVERTURE")]
    got = c.targets(props, has_doc={"real"}, has_card={"card"})
    # 다른 출처가 없는 곳 → 관광공사 곳(개요 수집이 채운다) → 카드만 있는 곳 → 진짜 문서가 있는 곳
    assert [t["ref"] for t in got][2:] == ["tour", "card", "real"] and {t["ref"] for t in got[:2]} == {"local", "map"}


def test_facility_facts_that_only_look_like_hours_or_praise_survive() -> None:
    ok = ["오픈 주방 구조", "추천 메뉴는 보말칼국수", "창가 좌석이 있다"]
    assert [f["text"] for f in c.clean_facts(_rec(*[(t, "u1", None) for t in ok]))] == ok


def test_parking_facts_are_dropped_because_web_pages_get_them_wrong() -> None:
    """11-03 인용 원문 대조: 주차 4/25 가 근거 없음·다른 말(그 밖 5%) — 웹 사실에서만 뺀다."""
    bad = ["무료 주차장이 있다", "매장 앞에 주차공간이 있음", "전용 주차장 1대와 인근 골목 주차 이용 가능"]
    assert c.clean_facts(_rec(*[(t, "u1", None) for t in bad], ("바 좌석이 있음", "u1", None))) == \
        [{"text": "바 좌석이 있음", "url": "u1", "host": "", }]


def test_citation_match_ignores_percent_encoding_and_trailing_slash() -> None:
    got = c.clean_facts(_rec(("바 좌석이 있음", "https://a.kr/맛집/", None), cites=("https://a.kr/%EB%A7%9B%EC%A7%91",)))
    assert [f["text"] for f in got] == ["바 좌석이 있음"]


def test_merge_keeps_the_latest_record_but_a_miss_never_overwrites_a_find() -> None:
    recs = [{"ref": "1", "status": "found", "at": "2026-10-23T01:00:00"}, {"ref": "1", "status": "not_found", "at": "2026-10-24T01:00:00"},
            {"ref": "2", "status": "not_found", "at": "2026-10-23T01:00:00"}, {"ref": "2", "status": "found", "at": "2026-10-22T01:00:00"},
            {"ref": "3", "status": "found", "at": "2026-10-22T01:00:00"}, {"ref": "3", "status": "closed", "at": "2026-10-23T01:00:00"},
            {"ref": "4", "status": "error", "at": "2026-10-23T01:00:00"}]
    got = c.merge(recs)
    assert {k: v["status"] for k, v in got.items()} == {"1": "found", "2": "found", "3": "closed"}


def test_records_read_every_state_file_and_skip_half_written_lines(tmp_path) -> None:
    (tmp_path / "state.jsonl").write_text('{"ref": "1", "status": "found"}\n{"ref": "2", "sta', encoding="utf-8")
    (tmp_path / "state-harness.jsonl").write_text('{"ref": "3", "status": "not_found"}\n', encoding="utf-8")
    assert sorted(r["ref"] for r in c.records(c.state_files(tmp_path / "state.jsonl"))) == ["1", "3"]


class _Err(Exception):
    def __init__(self, status_code=None):
        super().__init__("boom")
        self.status_code = status_code


class APIConnectionError(Exception):
    pass


def test_only_connection_timeouts_rate_limits_and_server_errors_are_transient() -> None:
    assert c._transient(APIConnectionError()) and c._transient(_Err(429)) and c._transient(_Err(503))
    assert not c._transient(_Err(400)) and not c._transient(_Err(None)) and not c._transient(ValueError())


class _Resp:
    def __init__(self, text, usage=True):
        self.output_text, self.output = text, []
        self.usage = type("U", (), {"input_tokens": 1, "output_tokens": 1})() if usage else None


class _Client:
    def __init__(self, *outcomes):
        self.calls, self._outcomes = 0, list(outcomes)
        self.responses = self

    def create(self, **_):
        self.calls += 1
        out = self._outcomes.pop(0)
        if isinstance(out, Exception):
            raise out
        return out if isinstance(out, _Resp) else _Resp(out)


_T = {"name": "가게", "kind": "음식점", "address": "서울"}


def _lookup(*outcomes, budget=None):
    client = _Client(*outcomes)
    backoff = c._Backoff(rpm=6000)
    backoff.hit = lambda *a, **k: None  # 물러남 대기는 재지 않는다
    return c.lookup(client, _T, backoff, budget=budget), client.calls


def test_budget_is_reserved_before_each_call_so_parallel_workers_cannot_overrun() -> None:
    """응답 뒤에만 차감하면 일꾼 4개가 같은 잔액을 보고 함께 들어가 상한을 넘겼다(2026-11-06 Codex 리뷰: 0.03 상한에 0.08 지출)."""
    b = c._Budget(0.03)
    assert [b.reserve(0.02) for _ in range(4)] == [True, True, False, False]  # 0.03→0.01→-0.01: 셋째부터 못 들어간다
    b.settle(0.02, 0.005), b.settle(0.02, 0.005)
    assert round(b.left, 5) == 0.02 and not b.exhausted
    assert c._Budget(None).reserve(1e9)  # 상한 없음


def test_lookup_stops_before_asking_when_the_budget_is_gone_and_settles_to_the_real_cost() -> None:
    res, calls = _lookup('{"found": false, "facts": []}', budget=c._Budget(0.0))
    assert res["budget"] and calls == 0
    b = c._Budget(1.0)
    res, calls = _lookup('{"found": false, "facts": []}', budget=b)
    assert calls == 1 and 1.0 - b.left == pytest.approx(res["cost"], abs=1e-5)  # 예약분은 실비로 정산된다(결과 cost 는 5자리 반올림)


def test_auth_rejection_is_fatal_and_is_not_retried() -> None:
    res, calls = _lookup(_Err(401))
    assert res["fatal"] and calls == 1


def test_a_refusal_is_asked_twice_before_it_counts_as_the_answer() -> None:
    res, calls = _lookup("I’m sorry, I can’t help.", '{"found": false, "facts": []}')
    assert res["status"] == "not_found" and calls == 2  # 두 번째에 답했다
    res, calls = _lookup("I'm sorry", "Sorry, no.")
    assert res["status"] == "refused" and calls == 2


@pytest.mark.parametrize("then", [_Err(None), _Err(401), _Err(503)], ids=["error", "fatal", "transient"])
def test_a_paid_refusal_is_charged_even_when_the_retry_fails(then) -> None:
    """거절로 다시 물은 뒤 오류로 끝나도 첫 호출은 이미 냈다 — 결과에 비용이 없으면 예산(`--budget-usd`)이 덜 센다."""
    after = [then] * (c.MAX_TRANSIENT - 1) if then.status_code == 503 else [then]
    res, _ = _lookup("I'm sorry", *after)
    assert res["status"] == "error" and res["cost"] > 0


def test_transient_errors_are_retried_then_marked_transient() -> None:
    res, calls = _lookup(*[_Err(503)] * c.MAX_TRANSIENT)
    assert res["status"] == "error" and res["transient"] and calls == c.MAX_TRANSIENT


def test_a_place_whose_facts_say_it_closed_is_closed_not_found() -> None:
    res, _ = _lookup('{"found": true, "facts": [{"text": "2024년에 폐업했다", "url": "u1"}]}')
    assert res["status"] == "closed"


def test_a_malformed_response_is_an_error_for_that_place_only() -> None:
    res, _ = _lookup(_Resp('{"found": true, "facts": [{"text": "바 좌석", "url": "u1"}]}', usage=False))
    assert res["status"] == "error" and not res.get("fatal") and not res.get("transient")  # 그곳만 오류 — 배치는 이어 간다


def test_one_backoff_episode_raises_the_step_once_however_many_workers_hit_it() -> None:
    b = c._Backoff()
    b.hit(rate_limited=True)
    b.hit(rate_limited=True)  # 같은 사태 안 — 단계·사태 수가 다시 오르지 않는다
    assert b._step == 1 and b.rate_limited == 1
    b.hit(retry_after=5000)
    assert b._until - __import__("time").monotonic() > 4000  # Retry-After 가 더 길면 그것을 따른다


@pytest.mark.parametrize("text", ["후르츠산도는 주말에만 판매한다", "저녁에는 비치 펍으로 운영된다", "평일 점심은 김치찜 반상",
                                  "매월 2·7·12일에 열린다", "김밥은 하루 25줄만 판매한다", "가브리살이 인기 메뉴다", "깔끔한 실내다",
                                  "한식 음식점이다", "카페로 분류된 매장", "일식당으로 등록된 곳", "물회 1만5천원"])
def test_time_bound_operations_praise_kind_only_and_unit_prices_are_dropped(text) -> None:
    assert c.clean_facts(_rec((text, "u1", None))) == []


def test_pre_2020_posts_are_dropped_in_any_date_shape() -> None:
    shapes = ("2019.05", "2019년 5", "2019", "2018/03")
    assert c.clean_facts(_rec(*[(f"사실 {i}", "u1", d) for i, d in enumerate(shapes)])) == []


@pytest.mark.parametrize(("text", "closed"), [
    ("현재 영업을 종료한 음식점이다", True), ("영업이 종료되었다", True), ("운영을 종료했다", True), ("2024년 폐관했다", True),
    ("현재 휴업 중이다", True), ("문 닫았다", True),
    ("폐업한 정미소를 개조한 카페", False), ("폐점한 은행 건물을 리모델링했다", False), ("오후에는 문을 닫고 내부를 정리한다", False),
])
def test_closed_means_the_place_itself_stopped_not_its_former_use(text, closed) -> None:
    assert c.closed_now({"status": "found", "facts": [{"text": text}]}) is closed


def test_build_rechecks_closure_on_old_found_records(tmp_path) -> None:
    rec = {"ref": "1", "status": "found", "at": "2026-10-23T01:00:00", "name": "가게", "model": "m", "citations": ["u1"],
           "facts": [{"text": "현재 영업을 종료한 음식점이다", "url": "u1"}, {"text": "버거를 판매했다", "url": "u1"}]}
    (tmp_path / "state.jsonl").write_text(__import__("json").dumps(rec, ensure_ascii=False) + "\n", encoding="utf-8")
    out = tmp_path / "facts.jsonl.gz"
    c.build(tmp_path, out)
    assert __import__("gzip").open(out, "rt").read() == ""


def test_rate_limit_stop_counts_only_consecutive_episodes() -> None:
    b = c._Backoff()
    b.hit(rate_limited=True)
    b.ok()
    assert b.rate_limited == 0


def test_claude_turn_paused_by_dynamic_filtering_is_continued_and_counted_whole(monkeypatch) -> None:
    from types import SimpleNamespace as N

    def resp(stop, text, cite, seen):
        return N(stop_reason=stop, usage=N(input_tokens=100, output_tokens=10, server_tool_use=N(web_search_requests=1)),
                 content=[N(type="web_search_tool_result", content=[N(url=seen)]), N(type="text", text=text, citations=[N(url=cite)])])

    class _Client:
        def __init__(self) -> None:
            self.calls, self.messages = [], N(create=self.create)
            self.replies = [resp("pause_turn", "찾는 중", "u1", "s1"), resp("end_turn", '{"found": false}', "u2", "s2")]

        def create(self, **kw):
            self.calls.append(kw)
            return self.replies[len(self.calls) - 1]

    monkeypatch.setattr(c, "MODEL", "claude-haiku-5-5")
    monkeypatch.setattr(c, "THINKING", "off")
    client = _Client()
    text, cites, tokens_in, tokens_out, searches = c.ask_claude(client, "질문")
    assert (text, tokens_in, tokens_out, searches) == ('{"found": false}', 200, 20, 2)  # 본문은 끝 응답, 셈은 둘 다
    assert set(cites) == {"u1", "s1", "u2", "s2"} and len(client.calls) == 2
    assert client.calls[1]["messages"][-1] == {"role": "assistant", "content": client.replies[0].content}  # 받은 그대로 되돌린다
    assert client.calls[0]["thinking"] == {"type": "disabled"}
    monkeypatch.setattr(c, "MODEL", "claude-sonnet-5-5")
    client = _Client()
    client.replies[0] = client.replies[1]
    c.ask_claude(client, "질문")
    assert len(client.calls) == 1 and "thinking" not in client.calls[0]  # sonnet-5-5 는 끄기를 400 으로 거부한다


def test_thinking_low_is_the_default_and_raises_the_output_cap(monkeypatch) -> None:
    from types import SimpleNamespace as N

    seen = []

    class _Client:
        messages = N(create=lambda **kw: seen.append(kw) or N(
            stop_reason="end_turn", usage=N(input_tokens=1, output_tokens=1, server_tool_use=N(web_search_requests=1)),
            content=[N(type="text", text="{}", citations=[])]))

    monkeypatch.setattr(c, "MODEL", "claude-haiku-5-5")
    assert c.THINKING == "low"  # 11-02 시험: 지시문을 조이고 effort low — 근거 없음 4%·지원 90%(사고 끔은 지원 81%)
    c.ask_claude(_Client(), "질문")
    assert seen[0]["output_config"] == {"effort": "low"} and "thinking" not in seen[0] and seen[0]["max_tokens"] == 8000
