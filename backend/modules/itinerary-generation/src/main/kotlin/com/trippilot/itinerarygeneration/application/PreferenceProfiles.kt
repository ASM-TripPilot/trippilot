package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.PersonalizationHints
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.trip.api.TripPreferenceSnapshot

/**
 * 여행별 취향 + 계정 취향(7축) + 기록 기반 개인화 → AI 경계 프로필.
 *
 * 생성과 재계획이 **같은 척도**로 이 프로필을 만들어야 한다 — 두 경로가 다른 취향으로 돌면
 * "원래 자리보다 나은 것만 바꾼다"(재계획 §4)의 비교가 성립하지 않는다. 그래서 생성 서비스의
 * private 이던 것을 공용으로 올렸다(재계획 연동 B-1).
 *
 * ## 세 출처의 우선순위 — 명시적일수록 이긴다
 *
 * 1. **[trip] 여행별 취향** — 이 여행을 만들며 고른 값. 가장 구체적인 의사표시다
 * 2. **계정 취향**(수신자) — 온보딩에서 고른 평소 값
 * 3. **[view] 기록 기반 개인화** — 과거 행동에서 뽑은 추정. **보태기만 한다**(TRIP-556)
 *
 * 보충은 **축 단위**다(사용자 결정 2026-10-05). 여행별 취향이 `styles` 만 담고 있으면
 * `styles` 만 이기고 나머지 축은 계정 값이 그대로 간다 — 덩어리로 갈아치우면 여행에서 한 축을
 * 골랐다는 이유로 평소 취향 전부가 사라진다.
 *
 * 과거 행동이 명시적 선택을 뒤집으면 "왜 내가 고른 게 무시되지"가 되므로 [view] 는 끝까지 보탬이다:
 * - `activities`: 합집합. 순서는 사용자가 고른 것이 앞
 * - `pace`: 스칼라라 합칠 수 없다 → **비어 있을 때만** 채운다
 *
 * 동의가 없거나 근거가 모자라면 [view] 는 빈 값이라 아무것도 보태지 않는다.
 */
internal fun PreferenceSnapshot.toProfile(
    view: PersonalizationHints,
    trip: TripPreferenceSnapshot = TripPreferenceSnapshot.EMPTY,
): PreferenceProfile =
    PreferenceProfile(
        styles = trip.styles.ifEmpty { styles },
        activities = (trip.activities.ifEmpty { activities } + view.activities).distinct(),
        foodTastes = trip.foodTastes.ifEmpty { foodTastes },
        transportModes = trip.transportModes.ifEmpty { transportModes },
        pace = trip.pace ?: pace ?: view.pace,
        companionTypes = trip.companionTypes.ifEmpty { companionTypes },
        petFriendly = trip.petFriendly ?: petFriendly,
        budgetTier = trip.budgetTier ?: budgetTier,
    )
