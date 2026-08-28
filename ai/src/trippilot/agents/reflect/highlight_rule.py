"""메타 기반 결정론 하이라이트 폴백 — LLM 0회 (TRIP-595, FD business-logic §6 ⓐ).

PHOTO_HIGHLIGHT 호출이 실패(타임아웃·비지원 어댑터·파싱 실패·전량 드롭)했을 때의
최후 보루. 사진 **메타만** 보고 고르므로 이미지 바이트도, 외부 호출도 필요 없다 —
그래서 이 경로는 언제나 답을 낸다 (INV-4: 침묵 실패 금지, 발행은 호출측).

규칙 (FD §6 ⓐ "방문당 1장·시간 분산"):
  ① 방문(visit_ref)별로 묶고, 방문을 일자 순으로 돌며 한 장씩 뽑는다 (라운드 로빈)
  ② 상한이 남으면 2순위·3순위를 같은 순서로 계속 뽑는다
  ③ 방문 안에서는 촬영 시각 순 — 라운드가 올라갈수록 같은 방문의 뒷시간 사진이 붙는다
①+③의 합이 "시간 분산"이다: 여행 전체(방문 = 일자)로 먼저 퍼뜨리고, 한 방문에서
여러 장을 쓸 때만 그 안의 시간 순서를 쓴다. 한 방문에 사진이 몰려 있어도 다른 방문이
먼저 채워지므로 결과가 하루에 쏠리지 않는다.

**결정론의 근거**: 정렬 키가 전순서다 — 마지막 키가 photo_id(입력 집합에서 유일)라
동률이 남지 않는다. 그리고 정렬 키에 입력 순서가 들어가지 않으므로 **같은 사진 집합을
어떤 순서로 넘겨도 같은 결과**가 나온다 (재시도·병렬 조립에서 결과가 흔들리지 않는다).
시각이 없는(taken_at=None) 사진은 항상 뒤로 — None 비교 대신 bool 선행 키를 쓴다.
"""

from __future__ import annotations

from collections.abc import Sequence

from trippilot.domain.reflection import PhotoId, PhotoRef


def _group_key(photo: PhotoRef) -> tuple[bool, str, str]:
    """방문 묶음 키 — 일자 → 방문지. 방문 미상(visit_ref=None)은 한 묶음으로 맨 뒤."""
    ref = photo.visit_ref
    if ref is None:
        return (True, "", "")
    return (False, ref.date.isoformat(), str(ref.poi_id))


def _within_group_key(photo: PhotoRef) -> tuple[bool, str, str]:
    """묶음 안 순서 — 촬영 시각 → photo_id(전순서 보장용 최종 키)."""
    return (
        photo.taken_at is None,
        photo.taken_at.isoformat() if photo.taken_at else "",
        str(photo.photo_id),
    )


def select_highlights(photos: Sequence[PhotoRef], *, limit: int) -> tuple[PhotoId, ...]:
    """대표 사진 결정론 선별. 입력 순서 무관 · 같은 입력 → 같은 출력 · LLM 0회.

    `VisionInput`이 아니라 `Sequence[PhotoRef]`를 받는다 — 이 규칙은 아무것도 밖으로
    보내지 않으므로 동의 증빙이 필요 없다. 호출측은 `vision.photos`를 그대로 넘긴다.
    """
    if limit < 1:
        raise ValueError("limit ≥ 1")

    groups: dict[tuple[bool, str, str], list[PhotoRef]] = {}
    for photo in photos:
        groups.setdefault(_group_key(photo), []).append(photo)
    ordered = [
        sorted(members, key=_within_group_key) for _, members in sorted(groups.items())
    ]

    selected: list[PhotoId] = []
    seen: set[PhotoId] = set()  # 같은 photo_id가 두 번 실려 와도 산출은 중복 0
    for rank in range(max((len(g) for g in ordered), default=0)):
        for group in ordered:
            if len(selected) >= limit:
                return tuple(selected)
            if rank < len(group) and group[rank].photo_id not in seen:
                seen.add(group[rank].photo_id)
                selected.append(group[rank].photo_id)
    return tuple(selected)
