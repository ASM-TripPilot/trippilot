"""웹 확인 사실 수집기의 거름 — 검색이 본 URL·짧은 사실·시각·가격·평가·연락처·옛 글 없음(2026-10-23)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

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


def test_facility_facts_that_only_look_like_hours_or_praise_survive() -> None:
    ok = ["무료 주차장이 있다", "오픈 주방 구조", "추천 메뉴는 보말칼국수"]
    assert [f["text"] for f in c.clean_facts(_rec(*[(t, "u1", None) for t in ok]))] == ok


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


def _lookup(*outcomes):
    client = _Client(*outcomes)
    backoff = c._Backoff(rpm=6000)
    backoff.hit = lambda *a, **k: None  # 물러남 대기는 재지 않는다
    return c.lookup(client, _T, backoff), client.calls


def test_auth_rejection_is_fatal_and_is_not_retried() -> None:
    res, calls = _lookup(_Err(401))
    assert res["fatal"] and calls == 1


def test_a_refusal_is_asked_twice_before_it_counts_as_the_answer() -> None:
    res, calls = _lookup("I’m sorry, I can’t help.", '{"found": false, "facts": []}')
    assert res["status"] == "not_found" and calls == 2  # 두 번째에 답했다
    res, calls = _lookup("I'm sorry", "Sorry, no.")
    assert res["status"] == "refused" and calls == 2


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
