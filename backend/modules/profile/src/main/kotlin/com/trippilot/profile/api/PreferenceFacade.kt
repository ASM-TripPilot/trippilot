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
