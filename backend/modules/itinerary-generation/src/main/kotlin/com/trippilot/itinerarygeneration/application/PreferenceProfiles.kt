package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.PersonalizationHints
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.profile.api.PreferenceSnapshot

/**
 * 취향 스냅숏(7축) + 기록 기반 개인화 → AI 경계 프로필.
 *
 * 생성과 재계획이 **같은 척도**로 이 프로필을 만들어야 한다 — 두 경로가 다른 취향으로 돌면
 * "원래 자리보다 나은 것만 바꾼다"(재계획 §4)의 비교가 성립하지 않는다. 그래서 생성 서비스의
 * private 이던 것을 공용으로 올렸다(재계획 연동 B-1).
 *
 * 기록 기반 개인화([view])는 **보태기만 한다**(TRIP-556). 사용자가 온보딩에서 고른 값이 언제나
 * 우선이다 — 과거 행동이 명시적 선택을 뒤집으면 "왜 내가 고른 게 무시되지"가 된다.
 *
 * - `activities`: 합집합. 순서는 사용자가 고른 것이 앞
 * - `pace`: 스칼라라 합칠 수 없다 → **비어 있을 때만** 채운다
 *
 * 동의가 없거나 근거가 모자라면 [view] 는 빈 값이라 이 함수는 아무것도 보태지 않는다.
 */
internal fun PreferenceSnapshot.toProfile(view: PersonalizationHints): PreferenceProfile =
    PreferenceProfile(
        styles = styles,
        activities = (activities + view.activities).distinct(),
        foodTastes = foodTastes,
        transportModes = transportModes,
        pace = pace ?: view.pace,
        companionTypes = companionTypes,
        petFriendly = petFriendly,
        budgetTier = budgetTier,
    )
