package com.trippilot.profile.api

import java.util.UUID

/**
 * 취향 스냅숏 조회 퍼사드(M2 profile) — 일정 생성(itinerary-generation)이 의존하는 공개 계약(R1, `..api..`).
 * api-safe 타입만 노출(UUID·String·Boolean·List) — profile 내부 도메인(PreferenceSet·PreferenceView)은 넘기지 않는다.
 * AI 경계의 preference_snapshot 7축(+budget_tier) 원천 — 계약: backend/docs/design/ai-backend-경계-계약-초안.md.
 */
interface PreferenceFacade {
    /**
     * 계정의 취향 선택값 스냅숏. 미설정 계정도 빈 스냅숏(전 축 empty/null)으로 항상 반환(null 아님).
     * 미설정 축엔 중립 기본값을 주입하지 않고 '선택 없음'을 그대로 노출한다 —
     * 소프트 가중치·중립 처리는 AI 지능이 소유(판단/검증 분리, INV-2). 표시용 중립 파생은 PreferenceService.view 소관.
     */
    fun findPreferences(accountId: UUID): PreferenceSnapshot
}

/** 취향 7축 + 예산등급(api-safe). 미설정 = 배열축 빈 목록·스칼라 null·petFriendly false. */
data class PreferenceSnapshot(
    val styles: List<String>,
    val activities: List<String>,
    val foodTastes: List<String>,
    val transportModes: List<String>,
    val pace: String?,
    val companionTypes: List<String>,
    val petFriendly: Boolean,
    val budgetTier: String?,
)

/**
 * 계정 취향(this) 위에 **여행 생성 때 고른 취향**([trip] = `trip.preference_snapshot`)을 얹는다(BR-U1-38).
 * 생성·재생성·재계획·편집 재검증과 회고 재료(reflection)가 모두 이 함수를 지나야 한 여행이 한 취향으로 만들어진다 —
 * 그래서 축 어휘의 주인인 이 api 에 둔다 — itinerary-generation 안(`internal`)에 두면 회고가 함수 하나 때문에 일정 생성 모듈을 물거나 사본을 둬야 한다.
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
fun PreferenceSnapshot.overriddenBy(trip: Map<String, Any?>): PreferenceSnapshot {
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
