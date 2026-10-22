package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.PersonalizationHints
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.profile.api.overriddenBy

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
 *
 * [explicit] 은 여행 스냅숏에 **실린 축 키**(`ctx.preferenceSnapshot.keys`)다. 실린 축을 사용자가 **비웠으면**
 * 개인화도 채우지 않는다(BR-U1-38) — 여행 화면에서 일부러 비운 축에 과거 기록이 되살아나면 [overriddenBy] 가
 * 지킨 "고른 게 최종"이 여기서 다시 깨진다. 안 실린 축(구버전 여행·FE 가 안 보낸 축)만 종전대로 보충한다.
 *
 * 수신자는 계정 스냅숏이 아니라 **여행 취향을 얹은 것**([overriddenBy])이어야 한다 — 계정 스냅숏에 바로
 * 부르면 여행에서 고른 취향이 빠진다(실제로 그랬다).
 */
internal fun PreferenceSnapshot.toProfile(view: PersonalizationHints, explicit: Set<String>): PreferenceProfile =
    PreferenceProfile(
        styles = styles,
        activities = if ("activities" in explicit && activities.isEmpty()) activities else (activities + view.activities).distinct(),
        foodTastes = foodTastes,
        transportModes = transportModes,
        pace = if ("pace" in explicit) pace else pace ?: view.pace,
        companionTypes = companionTypes,
        petFriendly = petFriendly,
        budgetTier = budgetTier,
    )
