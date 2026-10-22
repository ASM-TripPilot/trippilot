"""회고 템플릿 조립의 **순수 단계** — 랭킹·하드 교체·봉투 (TRIP-429·595).

LLM 시도 루프와 폴백 전환 발행은 `agent.py`의 `ReflectAgent` 가 소유한다. 여기 있는
것은 워커도 시계도 모르는 결정론 함수뿐이다 — 같은 후보 목록이면 언제나 같은 템플릿.

- `rank_key` / `finalize` : 후보 랭킹 → 위반 하드 교체 → 봉투(전 시도 실패면 고정 폴백)
- `apply_hard_replacements` / `safe_caption` : 게이트 위반 코드별 결정론 치환
- `bind_placeholders` / `bind_share_card_copy` : 자리표시자를 실제 값으로 — 와이어에 나가는 문구는 다 채워져 있다
"""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import datetime

from trippilot.agents.reflect.fallback import (
    FALLBACK_COVER_SUBTITLE,
    FALLBACK_COVER_TITLE,
    build_fallback_template,
)
from trippilot.domain.common import TraceId
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.reflection import (
    POI_PLACEHOLDER_PATTERN,
    PhotoSlot,
    ReflectionRequest,
    ReflectionTemplate,
    Scene,
    SceneLayout,
    ShareCardCopy,
    TemplateCandidate,
    TemplateViolation,
    ViolationCode,
    ViolationGrade,
)
from trippilot.ports.trace_port import TracePort

MAX_ATTEMPTS = 3  # 계약 §4 — N회 생성 상한 (시간 예산 수치는 BR-U6R-14 후속)

# 교체용 고정 안전 문구 (계약 §4.1 — 스스로 금칙 0·자리표시자 어휘 내를 테스트가 고정).
# PHOTO_CAPTION은 장소명을 부르므로 **교체에 쓴 방문의 인덱스**를 받아야 한다 —
# 고정 {poi:0.name}이면 사진은 방문 k인데 캡션은 방문 0을 말하는 거짓이 된다 (리뷰 지적).
SAFE_CAPTION_BY_LAYOUT: dict[SceneLayout, str] = {
    SceneLayout.PHOTO_FULL: "오래 남겨두고 싶은 장면",
    SceneLayout.PHOTO_CAPTION: "{poi:0.name}에서의 기억",
    SceneLayout.STATS: "이번 여행의 발자취를 한눈에",
    SceneLayout.MAP: "{region}에서 우리가 지나온 길",
    SceneLayout.EVENT: "계획이 바뀌어도 여행은 계속됐다",
}


def safe_caption(layout: SceneLayout, ref_index: int | None = None) -> str:
    """레이아웃별 안전 문구. PHOTO_CAPTION은 ref_index의 장소명을 부른다 —
    사진(visit_ref)과 캡션이 같은 방문을 가리켜야 거짓이 되지 않는다."""
    if layout is SceneLayout.PHOTO_CAPTION and ref_index is not None:
        return f"{{poi:{ref_index}.name}}에서의 기억"
    return SAFE_CAPTION_BY_LAYOUT[layout]

_DETAIL_TOKEN = re.compile(r"\{([^{}]*)\}")  # detail 말미의 {토큰} — 게이트 포맷 고정
_HASHTAG_INDEX = re.compile(r"hashtags\[(\d+)\]")  # 게이트 라벨 인덱스형과 페어
_PLACEHOLDER = re.compile(r"\{([^{}]*)\}")  # 게이트 `_PLACEHOLDER` 와 같은 토큰 경계
_POI_TOKEN = re.compile(POI_PLACEHOLDER_PATTERN)  # 게이트와 같은 상수 — fullmatch(공백 불허)
_DATE_RANGE = re.compile(r"\{start_date\}\s*~\s*\{end_date\}")
_LAST_RESORT_TITLE = "여행의 기록"  # 지역까지 비어 폴백 제목도 못 채울 때 — BE 는 빈 제목 카드를 버린다
# 토큰 바로 뒤 조사 — LLM 은 값을 못 본 채 조사를 붙인다("{poi:3.name}과" → "아쿠아플라넷 제주과",
# 2026-10-20 실측). 뒤에 한글이 이어지면 조사가 아닐 수 있어("이었다") 건드리지 않는다.
_TOKEN_JOSA = re.compile(r"(\{([^{}]*)\})(으로|은|는|이|가|을|를|과|와|로)(?![가-힣])")
_JOSA_PAIRS = {  # 조사 → (받침 있을 때, 없을 때)
    p: pair for pair in (("은", "는"), ("이", "가"), ("을", "를"), ("과", "와"), ("으로", "로"))
    for p in pair
}


def fit_josa(word: str, particle: str) -> str:
    """받침에 맞는 조사. 끝 글자가 한글 음절이 아니면(숫자·로마자) 쓴 그대로 둔다."""
    last = word.rstrip(")]」』 ")[-1:]
    if not "가" <= last <= "힣":
        return particle
    jong = (ord(last) - ord("가")) % 28
    with_final, without_final = _JOSA_PAIRS[particle]
    if with_final == "으로" and jong == 8:  # ㄹ 받침은 '로'
        return without_final
    return with_final if jong else without_final


def rank_key(candidate: TemplateCandidate) -> tuple[int, int, int, int]:
    """④ 사전식: 하드 ↑낮게 → 소프트 ↑낮게 → 장면 채움(photo_slot) ↑많게 → 차수 ↑이르게."""
    hard = sum(1 for v in candidate.violations if v.grade is ViolationGrade.HARD)
    soft = len(candidate.violations) - hard
    filled = sum(1 for s in candidate.template.scenes if s.photo_slot is not None)
    return (hard, soft, -filled, candidate.attempt)


def _strip_token(text: str, detail: str) -> str:
    """PLACEHOLDER_OUT — detail 말미 {토큰}만 제거 (계약 §4.1 '해당 토큰만')."""
    m = _DETAIL_TOKEN.search(detail)
    return text.replace("{" + m.group(1) + "}", "") if m else text


def _ref_index(scene: Scene, valid_refs: tuple) -> int | None:
    """장면의 현재 사진 참조가 방문 목록에서 몇 번째인가 (없으면 None)."""
    if scene.photo_slot is None:
        return None
    return next(
        (i for i, r in enumerate(valid_refs) if r == scene.photo_slot.visit_ref), None)


def _valid_ref_picker(template: ReflectionTemplate, valid_refs: tuple):
    """교체용 유효 방문 참조 공급기 — 결정론(입력 순서, 미사용 우선).

    이미 유효하게 쓰인 참조를 먼저 소진 목록에 넣어 중복을 줄이고, 전부
    소진되면 첫 방문을 재사용한다(중복은 소프트 위반이라 카드 보존이 우선).
    """
    allowed = frozenset(valid_refs)
    used = {
        s.photo_slot.visit_ref
        for s in template.scenes
        if s.photo_slot is not None and s.photo_slot.visit_ref in allowed
    }
    if (template.cover.photo_slot is not None
            and template.cover.photo_slot.visit_ref in allowed):
        used.add(template.cover.photo_slot.visit_ref)

    def pick() -> tuple:
        """(참조, 인덱스) — 인덱스는 캡션의 {poi:i.name}과 짝을 맞추는 데 쓴다."""
        for i, ref in enumerate(valid_refs):
            if ref not in used:
                used.add(ref)
                return ref, i
        return valid_refs[0], 0  # 전부 소진 — 재사용 (visits ≥ 1이 보장)

    return pick


def apply_hard_replacements(
    candidate: TemplateCandidate,
    valid_refs: tuple,
    valid_events: frozenset,
    photoless_refs: frozenset = frozenset(),
) -> ReflectionTemplate:
    """⑤ 잔존 하드 위반만 계약 §4.1 교체 맵으로 결정론 교체.

    **장면을 생략하지 않는다** (팀 결정 2026-08-25, TRIP-558): 잘못된 참조는
    유효한 값으로 갈아끼우고 캡션을 안전 문구로 바꿔 카드를 보존한다. 캡션을
    함께 바꾸는 이유 — 원 캡션이 다른 장소를 서술하면 갈아끼운 사진과 어긋나
    거짓이 된다. 소프트 위반은 교체하지 않는다(랭킹 감점만). 순수 함수.

    갈아끼우는 참조는 **사진 있는 방문**(valid_refs − photoless_refs)에서만 고른다 —
    사진 0장 방문으로 바꾸면 재게이트에서 PHOTO_SLOT_EMPTY 가 다시 난다. 그런
    방문이 없으면 슬롯을 비운다(PHOTO_* 장면은 STATS 로 전환, 표지는 None).
    """
    if not valid_refs:
        # 공개 함수 — 조용한 IndexError 대신 계약 위반을 명시한다
        # (compose 경유 시 ReflectionRequest.visits ≥ 1이 보장해 도달 불가)
        raise ValueError("valid_refs ≥ 1 — 교체할 유효 방문이 필요 (BR-U6R-15)")
    template = candidate.template
    hard = [v for v in candidate.violations if v.grade is ViolationGrade.HARD]
    if not hard:
        return template
    photo_refs = tuple(r for r in valid_refs if r not in photoless_refs)
    pick_ref = _valid_ref_picker(template, photo_refs)

    # ── 표지 (scene_index None, detail "cover.…") ──
    cover = template.cover
    for v in hard:
        if v.scene_index is not None or not v.detail.startswith("cover."):
            continue
        if v.code in (ViolationCode.VISIT_REF_OUT, ViolationCode.PHOTO_SLOT_EMPTY):
            # 슬롯 제거 대신 사진 있는 방문으로 교체 — 표지 사진을 잃지 않는다.
            # 그런 방문이 없을 때만 제거 (표지 슬롯은 선택 필드).
            # 표지 부제는 장소명을 부르지 않아 인덱스 불요
            cover = replace(cover, photo_slot=(
                PhotoSlot(visit_ref=pick_ref()[0]) if photo_refs else None))
        elif v.detail.startswith("cover.title"):
            cover = replace(
                cover,
                title=(_strip_token(cover.title, v.detail).strip()
                       if v.code is ViolationCode.PLACEHOLDER_OUT else "")
                or FALLBACK_COVER_TITLE,
            )
        elif v.detail.startswith("cover.subtitle"):
            cover = replace(
                cover,
                subtitle=(_strip_token(cover.subtitle, v.detail).strip()
                          if v.code is ViolationCode.PLACEHOLDER_OUT else "")
                or FALLBACK_COVER_SUBTITLE,
            )

    # ── 장면 (scene_index 기준) ──
    by_scene: dict[int, list[TemplateViolation]] = {}
    for v in hard:
        if v.scene_index is not None:
            by_scene.setdefault(v.scene_index, []).append(v)

    scenes: list[Scene] = []
    for i, scene in enumerate(template.scenes):
        for v in by_scene.get(i, []):
            if v.code is ViolationCode.EVENT_NOT_FOUND:
                if valid_events:
                    # 실재 이벤트로 교체 (결정론: enum 값 정렬 첫 번째)
                    scene = replace(
                        scene,
                        source_event=sorted(valid_events, key=lambda e: e.value)[0],
                        caption=safe_caption(scene.layout, _ref_index(scene, valid_refs)),
                    )
                else:
                    # 입력에 이벤트가 0건 — EVENT 장면의 존재 근거가 없다.
                    # 생략 대신 레이아웃 전환으로 카드를 살린다 (사진 있으면
                    # 사진 카드, 없으면 통계 카드 — 둘 다 source_event 불요)
                    layout = (SceneLayout.PHOTO_CAPTION
                              if scene.photo_slot is not None else SceneLayout.STATS)
                    idx = None
                    if scene.photo_slot is not None:
                        # 기존 슬롯은 이 시점에 유효하다(무효였다면 VISIT_REF_OUT이
                        # 먼저 갈아끼운다) — 그 방문의 인덱스로 캡션을 맞춘다
                        idx = next(
                            (i for i, r in enumerate(valid_refs)
                             if r == scene.photo_slot.visit_ref), None)
                    scene = replace(
                        scene, layout=layout, source_event=None,
                        caption=safe_caption(layout, idx),
                    )
            elif v.code in (ViolationCode.VISIT_REF_OUT, ViolationCode.PHOTO_SLOT_EMPTY):
                if photo_refs:
                    # 슬롯 제거·장면 생략 대신 사진 있는 방문으로 교체. 캡션도 함께 —
                    # 원 캡션이 다른 장소를 서술하면 갈아끼운 사진과 어긋난다.
                    # 인덱스는 valid_refs 기준이어야 {poi:i.name} 과 짝이 맞는다
                    # (공급기 인덱스는 photo_refs 기준이라 쓰면 다른 방문을 부른다)
                    ref, _ = pick_ref()
                    scene = replace(
                        scene,
                        photo_slot=PhotoSlot(visit_ref=ref),
                        caption=safe_caption(scene.layout, valid_refs.index(ref)),
                    )
                else:
                    # 사진 있는 방문이 하나도 없다 — 슬롯을 비운다. PHOTO_* 는 슬롯
                    # 필수(post-init)라 레이아웃을 같이 바꾼다 (EVENT_NOT_FOUND 0건 선례)
                    layout = (SceneLayout.STATS
                              if scene.layout in (SceneLayout.PHOTO_FULL,
                                                  SceneLayout.PHOTO_CAPTION)
                              else scene.layout)
                    scene = replace(scene, layout=layout, photo_slot=None,
                                    caption=safe_caption(layout))
            elif v.code is ViolationCode.TIME_EXPR:
                scene = replace(
                    scene,
                    caption=safe_caption(scene.layout, _ref_index(scene, valid_refs)),
                )
            elif v.code is ViolationCode.PLACEHOLDER_OUT:
                stripped = _strip_token(scene.caption, v.detail).strip()
                scene = replace(
                    scene,
                    caption=stripped or safe_caption(
                        scene.layout, _ref_index(scene, valid_refs)),
                )
        scenes.append(scene)  # 카드는 항상 보존 (TRIP-558)

    # ── 해시태그 (detail "hashtags[i]: …") — 위반 태그만 인덱스로 제거.
    # 태그 문자열 재파싱 금지 — 태그 내 콜론({poi:i.name})이 split을 깨뜨린다 (PBT 실측)
    bad_idx = set()
    for v in hard:
        if v.scene_index is None:
            m = _HASHTAG_INDEX.match(v.detail)
            if m:
                bad_idx.add(int(m.group(1)))
    hashtags = tuple(
        t for i, t in enumerate(template.hashtags) if i not in bad_idx)

    return replace(template, cover=cover, scenes=tuple(scenes), hashtags=hashtags)


def _is_template_only(text: str) -> bool:
    """자리표시자·구분자(`·` `~`)·공백뿐인 문구 — FE `isTemplateOnly`(TRIP-1425)와 같은 판정."""
    rest = _PLACEHOLDER.sub("", text)
    return rest != text and not re.sub(r"[\s·~]", "", rest)


def placeholder_values(request: ReflectionRequest) -> dict[str, str]:
    """요청으로 **정확히 아는** 어휘 값. 여기 없는 토큰은 못 채운다.

    - `{distance_km}` 는 요청에 거리가 없어 빠진다
    - 사진이 0장이면 `{photo_count}` 를 비운다 — "사진 0장으로 남긴 기억" 은 참이지만 회고 문장이 아니다
    """
    photos = sum(v.photo_count for v in request.visits)
    values = {
        "region": request.region.strip(),
        "start_date": request.start_date.isoformat(),
        "end_date": request.end_date.isoformat(),
        "visit_count": str(len({v.ref for v in request.visits})),
        "photo_count": str(photos) if photos else "",
    }
    return {k: v for k, v in values.items() if v}


def _binder(request: ReflectionRequest):
    """요청 값으로 문구를 채우는 함수 — 다 채운 문구, 못 채운 토큰이 남거나 비면 None."""
    names = tuple(v.poi_name.strip() for v in request.visits)
    values = placeholder_values(request)
    same_day = request.start_date == request.end_date

    def value_of(token: str) -> str:
        poi_m = _POI_TOKEN.fullmatch(token)
        if poi_m is not None:
            i = int(poi_m.group(1))
            return names[i] if i < len(names) else ""
        return values.get(token, "")

    def bind(text: str, *, tag: bool = False) -> str | None:
        if same_day:
            text = _DATE_RANGE.sub("{start_date}", text)
        text = _TOKEN_JOSA.sub(
            lambda m: m.group(1) + fit_josa(value_of(m.group(2)), m.group(3)), text)
        missing = False

        def sub(m: re.Match) -> str:
            nonlocal missing
            value = value_of(m.group(1))
            if not value:
                missing = True
                return m.group(0)
            return value.replace(" ", "") if tag else value

        out = _PLACEHOLDER.sub(sub, text).strip()
        return None if missing or not out.lstrip("#") else out

    return bind


def bind_share_card_copy(copy: ShareCardCopy, request: ReflectionRequest) -> ShareCardCopy | None:
    """j06 공유 문구도 와이어에 자리표시자 없이 나간다 — 회고 카드와 같은 바인딩(TRIP-1411 이 부르기 시작했다).

    캡션을 못 채우면(`{distance_km}` 등) None — 호출측이 정적 폴백으로 간다(문장을 지우면 "km" 만 남는다).
    못 채운 해시태그는 뺀다.
    """
    bind = _binder(request)
    caption = bind(copy.caption)
    if caption is None:
        return None
    hashtags = tuple(t for t in (bind(t, tag=True) for t in copy.hashtags) if t)
    return replace(copy, caption=caption, hashtags=hashtags)


def bind_placeholders(
    template: ReflectionTemplate, request: ReflectionRequest
) -> ReflectionTemplate:
    """자리표시자를 실제 값으로 채워 내보낸다 — **와이어에 나가는 문구는 다 채워져 있다.**

    렌더러가 채워 줄 거라는 전제는 틀렸다(2026-10-19 확인): FE 는 장면 캡션을 그대로 그리고
    (`ReflectionScenes.tsx`), `fillTemplate` 은 부제에만 쓰며 region·날짜 3종만 안다. BE 는
    아무것도 채우지 않는다. 숫자 환각 차단은 그대로다 — LLM 은 토큰만 고르고 값은 여기서 꺼낸다.
    `{poi:i.name}` 의 i 는 요청 `visits` 인덱스라 그 순서를 아는 곳도 여기뿐이다.

    - **못 채우면 문구를 바꾼다.** 캡션은 안전 문구 → 토큰 없는 문구, 제목은 폴백 제목, 태그는 뺀다.
      토큰을 지우기만 하면 "{distance_km}km" 가 "km" 로 남는다
    - **부제가 자리표시자뿐이면 그대로 둔다** — FE 가 그 꼴을 "서술 없음"으로 읽고 통계 문장을
      그린다(TRIP-1425). 서술이 있는 부제는 채우고, 못 채우면 그 꼴(폴백 부제)로 되돌린다
    - 시작=끝이면 `{start_date}~{end_date}` 를 날짜 하나로 접는다(FE 와 같은 규칙)
    - 토큰 바로 뒤 조사를 채운 값의 받침에 맞춘다(`{poi:3.name}과` → "아쿠아플라넷 제주와")
    - 해시태그는 공백을 담을 수 없어 값의 공백을 지운다(`#해운대 해수욕장` → `#해운대해수욕장`)
    - 빈 제목·빈 캡션도 같은 길로 간다 — BE 는 빈 제목 카드를 통째로 버리고, FE 는 빈 캡션 장면을 버린다
    """
    bind = _binder(request)
    valid_refs = tuple(v.ref for v in request.visits)

    subtitle = template.cover.subtitle
    if not _is_template_only(subtitle):
        subtitle = bind(subtitle) or FALLBACK_COVER_SUBTITLE
    cover = replace(
        template.cover,
        title=bind(template.cover.title) or bind(FALLBACK_COVER_TITLE) or _LAST_RESORT_TITLE,
        subtitle=subtitle,
    )
    scenes = tuple(
        replace(sc, caption=(
            bind(sc.caption)
            or bind(safe_caption(sc.layout, _ref_index(sc, valid_refs)))
            or SAFE_CAPTION_BY_LAYOUT[SceneLayout.PHOTO_FULL]  # 토큰 없는 문구
        ))
        for sc in template.scenes
    )
    hashtags = tuple(t for t in (bind(t, tag=True) for t in template.hashtags) if t)
    return replace(template, cover=cover, scenes=scenes, hashtags=hashtags)


def finalize(
    candidates: list[TemplateCandidate],
    request: ReflectionRequest,
    trace_id: TraceId,
    now: datetime,
    trace: TracePort,
) -> ReflectionTemplate:
    """④⑤⑥ 공통 마무리 — 후보 0건이면 고정 폴백 (INV-4, 침묵 금지)."""
    if not candidates:
        trace.emit(FallbackEvent(
            trace_id=trace_id,
            occurred_at=now,
            component="agents.reflect",
            stage="agent",
            from_mode="llm_template",
            to_mode="fixed_template",
            reason=f"reflection_all_attempts_failed:{MAX_ATTEMPTS}",
        ))
        return bind_placeholders(build_fallback_template(request.kind, trace_id, now), request)
    best = min(candidates, key=rank_key)
    replaced = apply_hard_replacements(
        best,
        tuple(v.ref for v in request.visits),
        frozenset(e.kind for e in request.events),
        request.photoless_refs(),
    )
    # 교체가 만든 안전 문구(`{poi:k.name}에서의 기억`)까지 채우려면 교체 **뒤**여야 한다
    return bind_placeholders(replaced, request)
