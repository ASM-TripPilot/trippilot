package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.PersonalizationHints
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.profile.api.PreferenceSnapshot

/**
 * 계정 취향(this) 위에 **여행 생성 때 고른 취향**([trip] = `trip.preference_snapshot`)을 얹는다(BR-U1-38).
 * 생성·재생성·재계획·편집 재검증이 모두 이 함수를 지나야 한 여행이 한 취향으로 만들어진다.
 *
 * - 키가 **있으면** 그 값이 최종이다 — 빈 배열이어도. 사용자가 1/4 시트에서 축을 비운 것(전해제 허용)을
 *   계정 값으로 되살리면 "고른 게 무시된다"가 그대로 남는다.
 * - 키가 **없는** 축만 계정 값 — 구버전 여행(`{}`), FE 가 안 보내는 축(현재 styles·activities 만 보낸다).
 * - 키 어휘는 [PreferenceSnapshot] 필드명(camelCase) — FE 제출(`TripNewStep1Page`)이 그 이름으로 싣는다.
 *   자유 맵(타입 보증 없음)이라 모양이 틀린 값은 빈 값으로 읽는다(목록은 문자열만 남긴다).
 *
 * 생성 이후 계정 취향을 바꿔도 여행에 실린 축은 움직이지 않는다(생성 시점 동결). 실리지 않은 축은
 * 계정 현재값을 따른다 — 그 축은 애초에 여행이 정한 적이 없다.
 */
internal fun PreferenceSnapshot.overriddenBy(trip: Map<String, Any?>): PreferenceSnapshot {
    fun list(key: String, own: List<String>) =
        if (trip.containsKey(key)) (trip[key] as? List<*>)?.filterIsInstance<String>().orEmpty() else own
    return PreferenceSnapshot(
        styles = list("styles", styles),
        activities = list("activities", activities),
        foodTastes = list("foodTastes", foodTastes),
        transportModes = list("transportModes", transportModes),
        pace = if (trip.containsKey("pace")) trip["pace"] as? String else pace,
        companionTypes = list("companionTypes", companionTypes),
        petFriendly = if (trip.containsKey("petFriendly")) trip["petFriendly"] == true else petFriendly,
        budgetTier = if (trip.containsKey("budgetTier")) trip["budgetTier"] as? String else budgetTier,
    )
}

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
 * 수신자는 계정 스냅숏이 아니라 **여행 취향을 얹은 것**([overriddenBy])이어야 한다 — 계정 스냅숏에 바로
 * 부르면 여행에서 고른 취향이 빠진다(실제로 그랬다).
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
