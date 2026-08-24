"""TRIP-429 — REFLECTION_TEMPLATE 4종 세트: 프롬프트·게이트·워커·PBT.

증명하는 것 (U6 Reflect FD의 RFL 속성 중 4종 세트 범위):
  ① 게이트 멤버십 (RFL-P1의 게이트 절반) — visit_ref ⊆ 방문 기록·source_event 실재
     판정이 정확하고, 방문 밖 참조는 GateDropEvent로 계측된다 (INV-1 사영)
  ② 파싱 실패 분류 — 스키마 불성립만 error(→ 게이트웨이 폴백 전환), 검증 가능
     항목의 위반은 error가 아니다 (계약 §4 "드롭이 아니라 최선 채택")
  ③ 위반 후보 생존 — 하드·소프트 위반이 있어도 TemplateCandidate는 위반 목록을
     동봉하고 살아 돌아온다 (RFL-P7의 게이트 전제)
  ④ 금칙(TIME_EXPR, INV-3)·자리표시자 어휘(closed-set, RFL-P3의 판정 절반) 기록
  ⑤ 직렬화 왕복 (RFL-P6 부분) — 신규 타입 from_dict(to_dict(x)) == x,
     ReflectionTemplate.to_dict 키 = 계약 §3 JSON 키
  ⑥ 워커 e2e — HEAVY 티어 라우팅, 성공/폴백 경로 (BR-U4-09, INV-4)

범위 밖 (agents/reflect 소유 — 후속): N회 생성 루프·결정론 랭킹(RFL-P4)·
장면/필드 교체(RFL-P1·P2의 교체 절반)·고정 폴백 템플릿(RFL-P5의 템플릿 절반).
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.reflection_template import (
    _CAPTION_MAX,
    _SCENE_MIN,
    ReflectionTemplateContext,
    ReflectionTemplateGate,
)
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.reflection_template import (
    ReflectionTemplateWorker,
    build_reflection_template_vars,
)
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.domain.reflection import (
    Cover,
    PhotoSlot,
    ReflectionFormat,
    ReflectionKind,
    ReflectionRequest,
    ReflectionTemplate,
    Scene,
    SceneLayout,
    SourceEventKind,
    TemplateCandidate,
    TemplateViolation,
    TripEventRecord,
    ViolationCode,
    ViolationGrade,
    VisitRecord,
    VisitRef,
)
from trippilot.domain.observability import FallbackEvent, GateDropEvent

from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace

_NOW = datetime(2026, 8, 20, 9, 0, tzinfo=timezone.utc)
_TID = TraceId("t-u6-rtpl")
_FEAT = LlmFeature.REFLECTION_TEMPLATE
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})

_D1, _D2 = date(2026, 8, 1), date(2026, 8, 2)
_REF1 = VisitRef(date=_D1, poi_id=PoiId("poi-1"))
_REF2 = VisitRef(date=_D2, poi_id=PoiId("poi-2"))
_OUT_REF = VisitRef(date=_D1, poi_id=PoiId("poi-999"))  # 방문 기록 밖

_CTX = ReflectionTemplateContext(
    kind=ReflectionKind.TRIP_SUMMARY,
    visit_refs=(_REF1, _REF2),
    event_kinds=frozenset({SourceEventKind.PLAN_B}),
)


def _visit(ref: VisitRef, name: str, order: int = 1, photos: int = 2) -> VisitRecord:
    return VisitRecord(
        ref=ref, poi_name=name, category="ATTRACTION", order_in_day=order, photo_count=photos
    )


def _request(**overrides) -> ReflectionRequest:
    base = dict(
        kind=ReflectionKind.TRIP_SUMMARY,
        region="부산",
        start_date=_D1,
        end_date=_D2,
        visits=(_visit(_REF1, "감천문화마을"), _visit(_REF2, "해운대")),
        events=(
            TripEventRecord(kind=SourceEventKind.PLAN_B, date=_D1, detail="휴무로 코스 변경"),
        ),
        persona_summary="자연·카페 선호, 느긋한 일정",
        weather_summary="이틀 다 맑음",
    )
    base.update(overrides)
    return ReflectionRequest(**base)


def _slot(ref: VisitRef) -> dict:
    return {"visit_ref": {"date": ref.date.isoformat(), "poi_id": str(ref.poi_id)}}


def _body(scenes: list | None = None, cover: dict | None = None, hashtags: list | None = None) -> dict:
    return {
        "cover": cover
        or {
            "title": "이틀의 기록",
            "subtitle": "{region} · {start_date}~{end_date}",
            "photo_slot": _slot(_REF1),
        },
        "scenes": scenes
        if scenes is not None
        else [
            {"layout": "PHOTO_FULL", "photo_slot": _slot(_REF1), "caption": "첫날은 {poi:0.name}부터"},
            {"layout": "STATS", "caption": "{visit_count}곳 · {distance_km}km"},
            {"layout": "MAP", "caption": "이렇게 움직였어요"},
        ],
        "hashtags": hashtags if hashtags is not None else ["#부산여행", "#TripPilot"],
    }


def _raw(body: dict) -> str:
    return json.dumps({"template": body}, ensure_ascii=False)


def _apply(raw: str, ctx: object = _CTX):
    return ReflectionTemplateGate().apply(raw, ctx, feature=_FEAT, trace_id=_TID, now=_NOW)


def _codes(outcome) -> list[ViolationCode]:
    return [v.code for v in outcome.value.violations]


# ── 게이트: 정상 (①) ────────────────────────────────────────


def test_gate_passes_valid_template_with_zero_violations() -> None:
    out = _apply(_raw(_body()))
    assert out.error is None and out.drop_event is None
    candidate = out.value
    assert isinstance(candidate, TemplateCandidate)
    assert candidate.violations == ()  # 위반 0 = 조기 종료 조건 (계약 §4)
    assert candidate.attempt == 1  # 차수 부여는 composer 몫
    t = candidate.template
    assert t.kind is ReflectionKind.TRIP_SUMMARY
    assert t.format is ReflectionFormat.CARD_NEWS
    assert t.generated_at == _NOW and t.is_fallback is False
    assert t.template_id.startswith("rtpl-")
    assert len(t.scenes) == 3 and t.hashtags == ("#부산여행", "#TripPilot")


def test_gate_template_id_deterministic_per_trace() -> None:
    assert _apply(_raw(_body())).value.template.template_id == _apply(
        _raw(_body())
    ).value.template.template_id


# ── 게이트: 파싱 실패만 실패 (②) ────────────────────────────


@pytest.mark.parametrize(
    "raw",
    [
        "이건 JSON이 아니다",
        json.dumps({"other": {}}),  # 최상위 키 다름
        _raw("문자열"),  # template이 객체가 아님
        _raw({"scenes": []}),  # cover 없음
        _raw({"cover": {"title": "t", "subtitle": "s"}, "scenes": "목록아님"}),
        _raw(_body(scenes=[{"layout": "COLLAGE", "caption": "enum 밖 layout"}])),
        _raw(_body(scenes=[{"layout": "PHOTO_FULL", "caption": "photo_slot 없음"}])),
        _raw(_body(scenes=[{"layout": "EVENT", "caption": "source_event 없음"}])),
        _raw(_body(scenes=[{"layout": "EVENT", "caption": "enum 밖", "source_event": "RAIN"}])),
        _raw(_body(scenes=[{"layout": "MAP", "caption": 3}])),  # caption 타입 오류
        _raw(_body(cover={"title": "t", "subtitle": "s", "photo_slot": {"visit_ref": {"date": "2026-13-99", "poi_id": "poi-1"}}})),
        _raw(_body(hashtags=["#ok", ""])),  # 빈 해시태그
    ],
)
def test_gate_parse_failures_are_the_only_failures(raw: str) -> None:
    out = _apply(raw)
    assert out.error is not None and out.error.startswith("parse_error:")
    assert out.value is None  # error 있으면 value 비움 (base 불변식)


def test_gate_requires_context() -> None:
    out = _apply(_raw(_body()), ctx=None)
    assert out.error is not None and out.error.startswith("gate_error:")


# ── 게이트: 멤버십 + 위반 후보 생존 (①③) ───────────────────


def test_gate_keeps_candidate_with_visit_ref_out_and_meters_drop() -> None:
    body = _body(
        scenes=[
            {"layout": "PHOTO_FULL", "photo_slot": _slot(_REF2), "caption": "둘째 날"},
            {"layout": "PHOTO_CAPTION", "photo_slot": _slot(_OUT_REF), "caption": "환각 참조"},
            {"layout": "MAP", "caption": "이렇게 움직였어요"},
        ]
    )
    out = _apply(_raw(body))
    assert out.error is None and out.value is not None  # 드롭이 아니라 생존 (계약 §4)
    violations = [v for v in out.value.violations if v.code is ViolationCode.VISIT_REF_OUT]
    assert len(violations) == 1
    assert violations[0].grade is ViolationGrade.HARD and violations[0].scene_index == 1
    # INV-1 사영 지표 — 방문 밖 poi_id 계측 (후보 유지와 병행)
    assert out.drop_event is not None
    assert out.drop_event.dropped_ids == (PoiId("poi-999"),)
    assert out.drop_event.dropped_count == 1
    assert out.drop_event.total_count == 3  # cover 1 + 장면 슬롯 2
    assert out.drop_event.feature == "REFLECTION_TEMPLATE"


def test_gate_accepts_all_refs_from_input_visits() -> None:
    body = _body(
        scenes=[
            {"layout": "PHOTO_FULL", "photo_slot": _slot(_REF1), "caption": "첫날"},
            {"layout": "PHOTO_CAPTION", "photo_slot": _slot(_REF2), "caption": "둘째 날"},
            {"layout": "STATS", "caption": "{visit_count}곳"},
        ]
    )
    out = _apply(_raw(body))
    assert out.error is None and out.drop_event is None
    assert ViolationCode.VISIT_REF_OUT not in _codes(out)


def test_gate_records_event_not_found_but_keeps_candidate() -> None:
    body = _body(
        scenes=[
            {"layout": "EVENT", "caption": "건너뛴 곳이 있었어요", "source_event": "SKIPPED"},
            {"layout": "STATS", "caption": "{visit_count}곳"},
            {"layout": "MAP", "caption": "동선"},
        ]
    )
    out = _apply(_raw(body))  # 입력 이벤트는 PLAN_B뿐
    assert out.error is None and out.value is not None
    found = [v for v in out.value.violations if v.code is ViolationCode.EVENT_NOT_FOUND]
    assert len(found) == 1 and found[0].scene_index == 0 and found[0].grade is ViolationGrade.HARD


def test_gate_accepts_event_scene_when_source_event_exists() -> None:
    body = _body(
        scenes=[
            {"layout": "EVENT", "caption": "휴무를 만나 코스를 바꿨어요", "source_event": "PLAN_B"},
            {"layout": "STATS", "caption": "{visit_count}곳"},
            {"layout": "MAP", "caption": "동선"},
        ]
    )
    assert _codes(_apply(_raw(body))) == []


# ── 게이트: 금칙·자리표시자 (④, INV-3·closed-set) ───────────


@pytest.mark.parametrize(
    "caption",
    ["도보 30분 거리였어요", "2시간 코스 완주", "오전 9시의 바다", "Duration: short"],
)
def test_gate_records_time_expr_in_caption(caption: str) -> None:
    out = _apply(_raw(_body(scenes=[{"layout": "MAP", "caption": caption}] * 3)))
    assert out.error is None and out.value is not None  # 생존 + 기록
    assert all(
        v.code is ViolationCode.TIME_EXPR and v.grade is ViolationGrade.HARD
        for v in out.value.violations
    )
    assert len(out.value.violations) == 3


def test_gate_checks_time_expr_in_subtitle_and_hashtags() -> None:
    out = _apply(
        _raw(
            _body(
                cover={"title": "기록", "subtitle": "오후 3시의 부산"},
                hashtags=["#2시간코스"],
            )
        )
    )
    time_violations = [v for v in out.value.violations if v.code is ViolationCode.TIME_EXPR]
    assert len(time_violations) == 2  # 부제 1 + 해시태그 1 (BR-U6R-04)
    assert all(v.scene_index is None for v in time_violations)


def test_gate_records_placeholder_out_of_vocab_and_index_range() -> None:
    body = _body(
        scenes=[
            {"layout": "STATS", "caption": "{spend_total}원 썼어요"},  # 어휘 밖
            {"layout": "MAP", "caption": "{poi:9.name} 근처"},  # 인덱스 범위 밖 (visits 2)
            {"layout": "STATS", "caption": "{poi:1.name}까지 {distance_km}km"},  # 정상
        ]
    )
    out = _apply(_raw(body))
    ph = [v for v in out.value.violations if v.code is ViolationCode.PLACEHOLDER_OUT]
    assert [v.scene_index for v in ph] == [0, 1]
    assert all(v.grade is ViolationGrade.HARD for v in ph)


def test_gate_records_soft_violations_without_blocking() -> None:
    long_caption = "가" * (_CAPTION_MAX + 1)
    body = _body(
        scenes=[
            {"layout": "PHOTO_FULL", "photo_slot": _slot(_REF1), "caption": "첫날"},
            {"layout": "PHOTO_CAPTION", "photo_slot": _slot(_REF1), "caption": long_caption},
        ]  # 장면 2개 (< _SCENE_MIN) + 중복 visit_ref + 캡션 초과
    )
    out = _apply(_raw(body))
    assert out.error is None and out.value is not None and out.drop_event is None
    codes = _codes(out)
    assert sorted(c.value for c in codes) == ["CAPTION_LEN", "DUP_VISIT_REF", "SCENE_COUNT"]
    assert all(v.grade is ViolationGrade.SOFT for v in out.value.violations)
    assert len(body["scenes"]) < _SCENE_MIN  # 테스트 전제 자기 검증


# ── PBT (①②③) ─────────────────────────────────────────────


@given(raw=st.one_of(st.text(max_size=200), st.just("{}"), st.just('{"template": {}}')))
def test_pbt_gate_never_raises_and_error_means_empty_value(raw: str) -> None:
    out = _apply(raw)
    if out.error is not None:
        assert out.value is None
    else:
        assert isinstance(out.value, TemplateCandidate)


_ref_pool = st.sampled_from(
    [
        _REF1,
        _REF2,
        _OUT_REF,
        VisitRef(date=date(2026, 8, 3), poi_id=PoiId("poi-1")),  # poi는 있으나 날짜가 밖
        VisitRef(date=_D2, poi_id=PoiId("poi-x")),
    ]
)


@given(refs=st.lists(_ref_pool, min_size=1, max_size=6))
@settings(max_examples=80, deadline=None)
def test_pbt_gate_membership_flags_exactly_the_outside_refs(refs: list[VisitRef]) -> None:
    """① 게이트 멤버십 — 방문 밖 참조는 전부·그것만 VISIT_REF_OUT으로 기록되고,
    위반이 있어도 후보는 항상 생존한다 (③)."""
    body = _body(
        cover={"title": "기록", "subtitle": "{region}"},  # cover 슬롯 없음 — 장면 참조만 계량
        scenes=[
            {"layout": "PHOTO_CAPTION", "photo_slot": _slot(r), "caption": "장면"} for r in refs
        ],
    )
    out = _apply(_raw(body))
    assert out.error is None and isinstance(out.value, TemplateCandidate)  # 항상 생존
    allowed = set(_CTX.visit_refs)
    expected_outside = [r for r in refs if r not in allowed]
    flagged = [
        v.scene_index for v in out.value.violations if v.code is ViolationCode.VISIT_REF_OUT
    ]
    assert flagged == [i for i, r in enumerate(refs) if r not in allowed]
    if expected_outside:
        assert out.drop_event is not None
        assert out.drop_event.dropped_count == len(expected_outside)
        assert out.drop_event.total_count == len(refs)
        assert set(out.drop_event.dropped_ids) == {r.poi_id for r in expected_outside}
    else:
        assert out.drop_event is None


_corruptions = st.sets(
    st.sampled_from(["time_expr", "bad_placeholder", "ghost_event", "dup_ref", "long_caption"]),
)


@given(corruption=_corruptions)
@settings(max_examples=60, deadline=None)
def test_pbt_corrupted_but_parseable_candidates_always_survive(corruption: set[str]) -> None:
    """③ 스키마가 성립하는 한 어떤 위반 조합에도 후보는 살아 돌아온다 — error 금지."""
    scenes: list[dict] = [
        {"layout": "PHOTO_FULL", "photo_slot": _slot(_REF1), "caption": "첫날"},
        {"layout": "STATS", "caption": "{visit_count}곳"},
        {"layout": "MAP", "caption": "동선"},
    ]
    if "time_expr" in corruption:
        scenes[2] = {"layout": "MAP", "caption": "이동 40분의 동선"}
    if "bad_placeholder" in corruption:
        scenes[1] = {"layout": "STATS", "caption": "{total_cost}원"}
    if "ghost_event" in corruption:
        scenes.append({"layout": "EVENT", "caption": "건너뜀", "source_event": "SKIPPED"})
    if "dup_ref" in corruption:
        scenes.append({"layout": "PHOTO_CAPTION", "photo_slot": _slot(_REF1), "caption": "또 첫날"})
    if "long_caption" in corruption:
        scenes.append({"layout": "MAP", "caption": "가" * (_CAPTION_MAX + 5)})
    out = _apply(_raw(_body(scenes=scenes)))
    assert out.error is None and isinstance(out.value, TemplateCandidate)
    assert bool(out.value.violations) == bool(corruption)


# ── 직렬화 왕복 (⑤, RFL-P6 부분) ────────────────────────────


def _full_template() -> ReflectionTemplate:
    return ReflectionTemplate(
        template_id="rtpl-abc",
        kind=ReflectionKind.DAILY,
        format=ReflectionFormat.CARD_NEWS,
        generated_at=_NOW,
        is_fallback=False,
        cover=Cover(title="기록", subtitle="{region}", photo_slot=PhotoSlot(visit_ref=_REF1)),
        scenes=(
            Scene(layout=SceneLayout.PHOTO_FULL, photo_slot=PhotoSlot(visit_ref=_REF1), caption="c1"),
            Scene(layout=SceneLayout.STATS, photo_slot=None, caption="{visit_count}곳"),
            Scene(layout=SceneLayout.MAP, photo_slot=None, caption="동선"),
            Scene(
                layout=SceneLayout.EVENT,
                photo_slot=None,
                caption="변경",
                source_event=SourceEventKind.PLAN_B,
            ),
        ),
        hashtags=("#부산여행",),
    )


def test_roundtrip_request_template_candidate() -> None:
    req = _request()
    assert ReflectionRequest.from_dict(req.to_dict()) == req
    template = _full_template()
    assert ReflectionTemplate.from_dict(template.to_dict()) == template
    candidate = TemplateCandidate(
        template=template,
        violations=(
            TemplateViolation(
                grade=ViolationGrade.HARD, code=ViolationCode.TIME_EXPR, scene_index=1, detail="d"
            ),
            TemplateViolation(
                grade=ViolationGrade.SOFT, code=ViolationCode.SCENE_COUNT, scene_index=None, detail="d"
            ),
        ),
        attempt=2,
    )
    assert TemplateCandidate.from_dict(candidate.to_dict()) == candidate


def test_template_to_dict_matches_contract_keys() -> None:
    """계약 §3 봉투+본문 키 단위 일치 — to_dict가 곧 경계 응답 본문 (FD §5)."""
    d = _full_template().to_dict()
    assert set(d.keys()) == {
        "template_id", "kind", "format", "generated_at", "is_fallback",
        "cover", "scenes", "hashtags",
    }
    assert set(d["cover"].keys()) == {"title", "subtitle", "photo_slot"}
    assert set(d["scenes"][0].keys()) == {"layout", "photo_slot", "caption"}
    assert d["scenes"][3]["source_event"] == "PLAN_B"
    assert d["scenes"][0]["photo_slot"]["visit_ref"] == {"date": "2026-08-01", "poi_id": "poi-1"}


def test_domain_invariants() -> None:
    with pytest.raises(ValueError):
        _request(visits=())  # BR-U6R-15 — 방문 0건 진입 불가
    with pytest.raises(ValueError):
        _request(start_date=_D2, end_date=_D1)  # 기간 역전
    with pytest.raises(ValueError):
        Scene(layout=SceneLayout.PHOTO_FULL, photo_slot=None, caption="c")
    with pytest.raises(ValueError):
        Scene(layout=SceneLayout.EVENT, photo_slot=None, caption="c")  # source_event 없음
    with pytest.raises(ValueError):
        TemplateViolation(
            grade=ViolationGrade.SOFT, code=ViolationCode.TIME_EXPR, scene_index=None, detail="d"
        )  # 코드-등급 표 위반
    with pytest.raises(ValueError):
        TemplateCandidate(template=_full_template(), violations=(), attempt=4)
    with pytest.raises(ValueError):
        ReflectionTemplateContext(
            kind=ReflectionKind.DAILY, visit_refs=(), event_kinds=frozenset()
        )


# ── 프롬프트 (BR-AF-07 yaml 등록·정본 규칙 문구) ─────────────


def test_prompt_renders_deterministically() -> None:
    reg = PromptRegistry(_PROMPTS)
    p1, ref = reg.render(_FEAT, build_reflection_template_vars(_request()))
    p2, _ = reg.render(_FEAT, build_reflection_template_vars(_request()))
    assert p1 == p2
    assert ref.prompt_id == "prompts/reflection_template.yaml" and ref.version == "0.1.0"
    assert ref.feature == "REFLECTION_TEMPLATE"
    assert "부산" in p1 and "감천문화마을" in p1 and "poi:0" in p1 and "PLAN_B" in p1


def test_prompt_states_contract_rules() -> None:
    """장면 3~8·캡션 40자(게이트 상수와 동일 값)·시간 언급 금지(INV-3)·
    자리표시자 어휘(closed-set)·지어내기 금지 규칙 문구가 실린다."""
    prompt, _ = PromptRegistry(_PROMPTS).render(
        _FEAT, build_reflection_template_vars(_request())
    )
    assert "3~8개" in prompt and f"{_CAPTION_MAX}자 이내" in prompt
    assert "시각·소요시간·이동시간을 언급하지 마세요" in prompt
    assert "지어내지 마세요" in prompt
    for token in ("{visit_count}", "{distance_km}", "{photo_count}", "{region}",
                  "{start_date}", "{end_date}", "{poi:i.name}"):
        assert token in prompt  # PLACEHOLDER_VOCAB 전체가 프롬프트에 명시
    assert '{"template"' in prompt  # 게이트 루트 키와 동일


def test_build_vars_stringifies_with_defaults_and_no_time_fields() -> None:
    variables = build_reflection_template_vars(
        _request(persona_summary=" ", weather_summary="", events=())
    )
    assert all(isinstance(v, str) for v in variables.values())
    assert variables["persona_summary"] == "(요약 없음)"
    assert variables["weather_summary"] == "(요약 없음)"
    assert variables["events"] == "(이벤트 없음)"
    assert variables["kind"] == "TRIP_SUMMARY"
    assert "2026-08-01" in variables["period"]
    # INV-3 원천 차단 — 방문 줄에 시각·체류분 없음 (VisitRecord에 필드 자체가 없다)
    assert "1번째" in variables["visits"] and "사진 2장" in variables["visits"]


# ── 워커 e2e (실물 레지스트리·게이트, ⑥) ────────────────────


def _worker(llm) -> tuple[ReflectionTemplateWorker, InMemoryTrace]:
    trace = InMemoryTrace()
    gateway = GatewayFacade(
        llm, PromptRegistry(_PROMPTS), ReflectionTemplateGate(), _CFG, trace
    )
    return ReflectionTemplateWorker(gateway), trace


def test_worker_end_to_end_success_on_heavy_tier() -> None:
    worker, _ = _worker(FakeLlm(canned=_raw(_body())))
    result = worker.generate(_request(), _TID, _NOW)
    assert result.is_fallback is False
    assert isinstance(result.value, TemplateCandidate) and result.value.violations == ()
    assert result.call_record is not None and result.call_record.success is True
    assert result.call_record.model_id == "m-h"  # HEAVY 티어 (default_tier_map)


def test_worker_keeps_violating_candidate_and_meters_drop() -> None:
    """③ 위반은 폴백이 아니다 — 후보 유지 + GateDropEvent 계측 (INV-1 사영)."""
    body = _body(
        scenes=[
            {"layout": "PHOTO_CAPTION", "photo_slot": _slot(_OUT_REF), "caption": "환각"},
            {"layout": "STATS", "caption": "{visit_count}곳"},
            {"layout": "MAP", "caption": "동선"},
        ]
    )
    worker, trace = _worker(FakeLlm(canned=_raw(body)))
    result = worker.generate(_request(), _TID, _NOW)
    assert result.is_fallback is False
    assert any(v.code is ViolationCode.VISIT_REF_OUT for v in result.value.violations)
    drops = trace.of_type(GateDropEvent)
    assert len(drops) == 1 and drops[0].dropped_ids == (PoiId("poi-999"),)


def test_worker_falls_back_loudly_on_llm_failure() -> None:
    worker, trace = _worker(FailingLlm())
    result = worker.generate(_request(), _TID, _NOW)
    assert result.is_fallback is True and result.value is None
    assert result.error and result.call_record is not None
    assert len(trace.of_type(FallbackEvent)) == 1  # 침묵 실패 금지 (INV-4)


def test_worker_falls_back_on_parse_failure_only() -> None:
    worker, _ = _worker(FakeLlm(canned="장면: 그냥 산문으로 쓴 회고"))
    result = worker.generate(_request(), _TID, _NOW)
    assert result.is_fallback is True and result.value is None
    assert "parse_error" in result.error


@given(raw=st.one_of(st.text(max_size=150), st.just('{"template": {}}')))
@settings(max_examples=50, deadline=None)
def test_pbt_worker_converges_for_any_llm_text(raw: str) -> None:
    """어떤 LLM 응답이 와도: 예외 없음 ∧ (후보 or 폴백 신호) — 침묵 실패 없음 (INV-4)."""
    worker, _ = _worker(FakeLlm(canned=raw))
    result = worker.generate(_request(), _TID, _NOW)
    if result.is_fallback:
        assert result.value is None and result.error
    else:
        assert isinstance(result.value, TemplateCandidate)
