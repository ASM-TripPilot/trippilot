"""U6 Reflect generator — RFL-P1~P7 (business-rules.md §3 · business-logic-model.md §7).

용도:
- reflection_requests() / reflection_templates(): 유효 도메인 값 전분포 — RFL-P6
  직렬화 왕복(U5-P10 승계). 장면은 layout별 post-init 제약(PHOTO_*⇒slot,
  EVENT⇒source_event)을 지키고, datetime은 항상 tz-aware.
- pollution_base_requests(): 오염 스윕용 기준 요청 — 이벤트 kind를 PLAN_B로 한정해
  EVENT_NOT_FOUND(=SKIPPED 주입)가 항상 성립하게 한다.
- polluted_body_for(request): **파싱은 성립하되** 검증 항목을 오염시킨 게이트 입력
  body — 오염 종류 부분집합 스윕(0~100%, polluted_scored_pois 선례). (body, 적용
  오염 집합)을 돌려준다. RFL-P1~P3(교체 후 하드 0)·P4(랭킹 결정론)·P7(소프트
  비차단)의 적대적 입력원.
- HASHTAG_COLON_POLLUTIONS: 콜론이 든 해시태그 오염 — composer 교체 맵의
  detail 라벨 파싱("hashtags:{태그}:" split) 적대 케이스 전용 풀.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from hypothesis import strategies as st

from trippilot.domain.common import PoiId
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
    TripEventRecord,
    VisitRecord,
    VisitRef,
)

_KST = timezone(timedelta(hours=9))  # Asia/Seoul 고정 오프셋 (1차 출시)
_DATES = st.dates(min_value=date(2026, 1, 1), max_value=date(2026, 12, 31))
_POI_IDS = st.integers(min_value=0, max_value=999).map(lambda i: PoiId(f"poi-{i}"))
_REFS = st.builds(VisitRef, date=_DATES, poi_id=_POI_IDS)
_SLOTS = st.builds(PhotoSlot, visit_ref=_REFS)
_TEXT = st.text(min_size=1, max_size=24)


# ── RFL-P6 — 유효 도메인 값 전분포 ──────────────────────────


@st.composite
def reflection_requests(draw) -> ReflectionRequest:
    start = draw(st.dates(min_value=date(2026, 1, 1), max_value=date(2026, 12, 20)))
    span = draw(st.integers(min_value=0, max_value=6))
    n_visits = draw(st.integers(min_value=1, max_value=4))
    visits = tuple(
        VisitRecord(
            ref=VisitRef(
                date=start + timedelta(days=draw(st.integers(0, span))),
                poi_id=draw(_POI_IDS),
            ),
            poi_name=draw(_TEXT),
            category=draw(_TEXT),
            order_in_day=draw(st.integers(min_value=1, max_value=9)),
            photo_count=draw(st.integers(min_value=0, max_value=9)),
        )
        for _ in range(n_visits)
    )
    events = tuple(
        TripEventRecord(
            kind=draw(st.sampled_from(list(SourceEventKind))),
            date=start + timedelta(days=draw(st.integers(0, span))),
            detail=draw(_TEXT),
        )
        for _ in range(draw(st.integers(min_value=0, max_value=2)))
    )
    return ReflectionRequest(
        kind=draw(st.sampled_from(list(ReflectionKind))),
        region=draw(_TEXT),
        start_date=start,
        end_date=start + timedelta(days=span),
        visits=visits,
        events=events,
        persona_summary=draw(st.text(max_size=20)),
        weather_summary=draw(st.text(max_size=20)),
    )


@st.composite
def _valid_scenes(draw) -> Scene:
    layout = draw(st.sampled_from(list(SceneLayout)))
    if layout in (SceneLayout.PHOTO_FULL, SceneLayout.PHOTO_CAPTION):
        photo_slot = draw(_SLOTS)  # post-init: PHOTO_*는 slot 필수
    else:
        photo_slot = draw(st.none() | _SLOTS)
    if layout is SceneLayout.EVENT:
        source_event = draw(st.sampled_from(list(SourceEventKind)))  # EVENT는 필수
    else:
        source_event = draw(st.none() | st.sampled_from(list(SourceEventKind)))
    return Scene(
        layout=layout,
        photo_slot=photo_slot,
        caption=draw(_TEXT),
        source_event=source_event,
    )


def reflection_templates() -> st.SearchStrategy[ReflectionTemplate]:
    return st.builds(
        ReflectionTemplate,
        template_id=_TEXT,
        kind=st.sampled_from(list(ReflectionKind)),
        format=st.just(ReflectionFormat.CARD_NEWS),
        generated_at=st.datetimes(
            min_value=datetime(2026, 1, 1),
            max_value=datetime(2026, 12, 31),
            timezones=st.sampled_from((timezone.utc, _KST)),
        ),
        is_fallback=st.booleans(),
        cover=st.builds(Cover, title=_TEXT, subtitle=_TEXT, photo_slot=st.none() | _SLOTS),
        scenes=st.lists(_valid_scenes(), max_size=6).map(tuple),
        hashtags=st.lists(_TEXT, max_size=4).map(tuple),
    )


# ── RFL-P1~P4·P7 — 오염 주입 (파싱 성립·검증 항목 오염) ─────

# 교체 맵(business-logic-model §4)의 하드 코드 전부를 최소 1개 오염으로 커버한다.
HARD_POLLUTIONS: tuple[str, ...] = (
    "scene_time_expr",       # TIME_EXPR — 캡션 시간 표현 (INV-3)
    "scene_vocab_out",       # PLACEHOLDER_OUT — 어휘 밖 토큰
    "scene_poi_index_out",   # PLACEHOLDER_OUT — {poi:i} 인덱스 범위 밖
    "scene_visit_ref_out",   # VISIT_REF_OUT — 방문 기록 밖 참조 (INV-1 사영)
    "cover_time_expr",       # TIME_EXPR — 표지
    "cover_visit_ref_out",   # VISIT_REF_OUT — 표지 슬롯
    "event_not_found",       # EVENT_NOT_FOUND — 입력에 없는 source_event
    "hashtag_vocab_out",     # PLACEHOLDER_OUT — 해시태그 (콜론 없는 태그)
    "hashtag_time_expr",     # TIME_EXPR — 해시태그 (콜론 없는 태그)
)
SOFT_POLLUTIONS: tuple[str, ...] = (
    "caption_len",     # CAPTION_LEN — 40자 초과
    "dup_visit_ref",   # DUP_VISIT_REF — 장면 간 중복 참조
    "scene_count_out", # SCENE_COUNT — 3~8 밖
)
# 태그 자체에 콜론(:)이 들어가는 적대 케이스 — 교체 맵의 "hashtags:{태그}:" 라벨
# split(":", 2) 파싱이 태그를 복원하지 못하는지 겨냥한다 (별도 풀 — 버그 재현 전용).
HASHTAG_COLON_POLLUTIONS: tuple[str, ...] = (
    "hashtag_colon_poi_index",  # 태그 = "{poi:i.name}" (인덱스 범위 밖 + 콜론)
    "hashtag_colon_time",       # 태그 = "#명소:3시간코스" (시간 표현 + 콜론)
)

_GHOST_POI = "ghost-999"  # pollution_base_requests의 poi-{i}와 절대 미충돌
_TIME_PHRASES = ("이동 30분", "3시간 코스", "오전 10시 출발", "도착은 2시")


@st.composite
def pollution_base_requests(draw) -> ReflectionRequest:
    """오염 스윕 기준 요청 — 이벤트 kind는 PLAN_B 한정(SKIPPED 주입 = 항상 미실재)."""
    start = draw(st.dates(min_value=date(2026, 1, 1), max_value=date(2026, 12, 20)))
    span = draw(st.integers(min_value=0, max_value=3))
    n_visits = draw(st.integers(min_value=1, max_value=4))
    visits = tuple(
        VisitRecord(
            ref=VisitRef(
                date=start + timedelta(days=draw(st.integers(0, span))),
                poi_id=PoiId(f"poi-{i}"),
            ),
            poi_name=f"명소{i}",
            category="SIGHT",
            order_in_day=i + 1,
            photo_count=draw(st.integers(min_value=0, max_value=5)),
        )
        for i in range(n_visits)
    )
    events = tuple(
        TripEventRecord(kind=SourceEventKind.PLAN_B, date=start, detail="코스 변경")
        for _ in range(draw(st.integers(min_value=0, max_value=2)))
    )
    return ReflectionRequest(
        kind=draw(st.sampled_from(list(ReflectionKind))),
        region="부산",
        start_date=start,
        end_date=start + timedelta(days=span),
        visits=visits,
        events=events,
        persona_summary="느긋한 일정 선호",
        weather_summary="맑음",
    )


def _slot_of(ref: VisitRef) -> dict:
    return {"visit_ref": {"date": ref.date.isoformat(), "poi_id": str(ref.poi_id)}}


@st.composite
def polluted_body_for(
    draw,
    request: ReflectionRequest,
    pool: tuple[str, ...] = HARD_POLLUTIONS + SOFT_POLLUTIONS,
    min_pollution: int = 0,
) -> tuple[dict, frozenset[str]]:
    """request 기준의 게이트 입력 body — 스키마는 항상 성립(파싱 실패 없음),
    적용 오염 부분집합은 0~100% 스윕. (body, 적용 오염 집합) 반환."""
    kinds = draw(st.sets(st.sampled_from(pool), min_size=min_pollution))
    n = len(request.visits)
    ref0 = request.visits[0].ref
    ghost = {"date": request.start_date.isoformat(), "poi_id": _GHOST_POI}

    cover: dict = {"title": "여행의 기록", "subtitle": "{region} · {start_date}~{end_date}"}
    base_scenes: list[dict] = [
        {"layout": "PHOTO_FULL", "photo_slot": _slot_of(ref0), "caption": "가장 오래 머문 골목"},
        {"layout": "STATS", "caption": "{visit_count}곳 · {distance_km}km"},
        {"layout": "MAP", "caption": "우리가 지나온 길"},
    ]
    hashtags: list[str] = ["#여행기록"]
    extra: list[dict] = []

    if "scene_time_expr" in kinds:
        extra.append({"layout": "MAP", "caption": draw(st.sampled_from(_TIME_PHRASES))})
    if "scene_vocab_out" in kinds:
        extra.append({"layout": "STATS", "caption": "오늘의 {speed} 기록"})
    if "scene_poi_index_out" in kinds:
        idx = draw(st.integers(min_value=n, max_value=n + 5))
        extra.append({"layout": "MAP", "caption": f"{{poi:{idx}.name}} 다음 길"})
    if "scene_visit_ref_out" in kinds:
        layout = draw(st.sampled_from(("PHOTO_FULL", "PHOTO_CAPTION", "STATS")))
        extra.append({"layout": layout, "photo_slot": {"visit_ref": ghost}, "caption": "환각 장면"})
    if "cover_time_expr" in kinds:
        cover[draw(st.sampled_from(("title", "subtitle")))] = "3시간의 기록"
    if "cover_visit_ref_out" in kinds:
        cover["photo_slot"] = {"visit_ref": ghost}
    if "event_not_found" in kinds:  # 기준 요청 이벤트는 PLAN_B 한정 — SKIPPED는 항상 미실재
        extra.append({"layout": "EVENT", "caption": "계획이 바뀐 날", "source_event": "SKIPPED"})
    if "hashtag_vocab_out" in kinds:
        hashtags.append("#{speed}")
    if "hashtag_time_expr" in kinds:
        hashtags.append("#3시간")
    if "hashtag_colon_poi_index" in kinds:
        idx = draw(st.integers(min_value=n, max_value=n + 5))
        hashtags.append(f"{{poi:{idx}.name}}")
    if "hashtag_colon_time" in kinds:
        hashtags.append("#명소:3시간코스")
    if "caption_len" in kinds:
        extra.append({"layout": "MAP", "caption": "가" * 41})
    if "dup_visit_ref" in kinds:  # base PHOTO_FULL(ref0)과 중복
        extra.append({"layout": "PHOTO_CAPTION", "photo_slot": _slot_of(ref0), "caption": "같은 곳 한 장 더"})
    if "scene_count_out" in kinds:
        extra.extend({"layout": "MAP", "caption": "걷고 또 걸은 길"} for _ in range(6))

    scenes = base_scenes + list(draw(st.permutations(extra))) if extra else base_scenes
    return {"cover": cover, "scenes": scenes, "hashtags": hashtags}, frozenset(kinds)


@st.composite
def polluted_reflection_cases(
    draw,
    pool: tuple[str, ...] = HARD_POLLUTIONS + SOFT_POLLUTIONS,
    min_pollution: int = 0,
    n_bodies: tuple[int, int] = (1, 1),
) -> tuple[ReflectionRequest, list[tuple[dict, frozenset[str]]]]:
    """같은 요청에 대한 오염 body n건 — 후보 집합(랭킹 P4·P7)용."""
    request = draw(pollution_base_requests())
    count = draw(st.integers(min_value=n_bodies[0], max_value=n_bodies[1]))
    bodies = [
        draw(polluted_body_for(request, pool=pool, min_pollution=min_pollution))
        for _ in range(count)
    ]
    return request, bodies
