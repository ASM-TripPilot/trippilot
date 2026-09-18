package com.trippilot.profile.domain

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import java.time.Instant
import java.util.UUID

/**
 * 취향 7축(V1.5 preference_set). 각 축은 **NULL=미설정**, 비NULL=선택함(INV-PR2).
 * 중립 기본값은 저장하지 않고 조회 시 파생([view], INV-PR2/PR5). 예산은 tier 없이 금액 불가(INV-PR3).
 *
 * accountId 는 raw UUID — 타 모듈(auth) 내부 타입에 의존하지 않는다(R1).
 */
class PreferenceSet private constructor(
    val accountId: UUID,
    val styles: List<String>?,
    val budgetTier: String?,
    val budgetRawAmount: Long?,
    val companionTypes: List<String>?,
    val petFlag: Boolean,
    val activities: List<String>?,
    val transportModes: List<String>?,
    val foodTastes: List<String>?,
    val pace: String?,
    val updatedAt: Instant,
) {
    /** 조회용 완전 응답 — 미설정 축에 중립 기본값 주입 + isNeutralDefault 표시(INV-PR5). */
    fun view(): PreferenceView = PreferenceView(
        styles = arrayAxis(styles, neutral = emptyList()),
        activities = arrayAxis(activities, neutral = emptyList()),
        transportModes = arrayAxis(transportModes, neutral = NEUTRAL_TRANSPORT),
        foodTastes = arrayAxis(foodTastes, neutral = emptyList()),
        pace = ScalarAxisView(pace, isNeutralDefault = pace == null),
        companion = CompanionView(companionTypes ?: emptyList(), petFlag, isNeutralDefault = companionTypes == null),
        budget = BudgetView(budgetTier, budgetRawAmount, isNeutralDefault = budgetTier == null && budgetRawAmount == null),
    )

    companion object {
        // 각 축 허용값(DB CHECK 제약과 일치, INV-PR2)
        val STYLES = setOf("휴양", "관광", "액티비티", "미식", "쇼핑", "자연", "문화예술")
        val ACTIVITIES = setOf("자연", "역사문화", "테마파크", "맛집투어", "카페", "전시", "야경", "쇼핑")
        val TRANSPORT_MODES = setOf("도보", "대중교통", "렌터카", "택시", "자전거")
        val FOOD_TASTES = setOf("한식", "양식", "일식", "중식", "아시안")
        val COMPANION_TYPES = setOf("혼자", "커플", "친구", "가족", "부모님")
        val BUDGET_TIERS = setOf("저가", "중간", "고급", "럭셔리")
        val PACES = setOf("느긋하게", "균형있게", "알차게")

        /** 이동 축 중립 기본값 — 보수적으로 대중교통(BR-U0-21). 그 외 배열 축은 빈 목록. */
        val NEUTRAL_TRANSPORT = listOf("대중교통")

        /** 저장 전 검증 생성 — 허용값·예산쌍(INV-PR3)·금액 위반 시 [ValidationFailed](400). */
        fun of(
            accountId: UUID,
            styles: List<String>?,
            budgetTier: String?,
            budgetRawAmount: Long?,
            companionTypes: List<String>?,
            petFlag: Boolean,
            activities: List<String>?,
            transportModes: List<String>?,
            foodTastes: List<String>?,
            pace: String?,
            now: Instant,
        ): PreferenceSet {
            val errors = buildList {
                subsetError("styles", styles, STYLES)?.let(::add)
                subsetError("activities", activities, ACTIVITIES)?.let(::add)
                subsetError("transportModes", transportModes, TRANSPORT_MODES)?.let(::add)
                subsetError("foodTastes", foodTastes, FOOD_TASTES)?.let(::add)
                subsetError("companionTypes", companionTypes, COMPANION_TYPES)?.let(::add)
                if (pace != null && pace !in PACES) add(FieldError("pace", "허용되지 않은 값: $pace"))
                if (budgetTier != null && budgetTier !in BUDGET_TIERS) add(FieldError("budgetTier", "허용되지 않은 값: $budgetTier"))
                if (budgetRawAmount != null && budgetRawAmount <= 0) add(FieldError("budgetRawAmount", "0보다 커야 합니다"))
                // INV-PR3: 금액은 tier 동반 필수
                if (budgetRawAmount != null && budgetTier == null) add(FieldError("budgetTier", "예산 금액에는 등급이 필요합니다 (INV-PR3)"))
            }
            if (errors.isNotEmpty()) throw ValidationFailed(errors)
            return PreferenceSet(
                accountId, styles, budgetTier, budgetRawAmount, companionTypes, petFlag,
                activities, transportModes, foodTastes, pace, now,
            )
        }

        /** 미설정 계정 기본(전 축 NULL, petFlag=false). 미저장 파생값. */
        fun empty(accountId: UUID, now: Instant): PreferenceSet =
            PreferenceSet(accountId, null, null, null, null, false, null, null, null, null, now)

        /** 영속 계층 재구성(검증 미적용). */
        fun reconstitute(
            accountId: UUID,
            styles: List<String>?,
            budgetTier: String?,
            budgetRawAmount: Long?,
            companionTypes: List<String>?,
            petFlag: Boolean,
            activities: List<String>?,
            transportModes: List<String>?,
            foodTastes: List<String>?,
            pace: String?,
            updatedAt: Instant,
        ): PreferenceSet = PreferenceSet(
            accountId, styles, budgetTier, budgetRawAmount, companionTypes, petFlag,
            activities, transportModes, foodTastes, pace, updatedAt,
        )

        private fun arrayAxis(stored: List<String>?, neutral: List<String>): ArrayAxisView =
            if (stored == null) ArrayAxisView(neutral, isNeutralDefault = true) else ArrayAxisView(stored, isNeutralDefault = false)

        private fun subsetError(field: String, values: List<String>?, allowed: Set<String>): FieldError? {
            if (values == null) return null
            val invalid = values.filterNot { it in allowed }
            return if (invalid.isEmpty()) null else FieldError(field, "허용되지 않은 값: ${invalid.joinToString()}")
        }
    }
}

/** 배열 축 조회 결과(값 + 중립 파생 여부). */
data class ArrayAxisView(val value: List<String>, val isNeutralDefault: Boolean)

/** 스칼라 축 조회 결과. */
data class ScalarAxisView(val value: String?, val isNeutralDefault: Boolean)

/** 동반 축 — 유형 목록 + 반려동물 플래그. */
data class CompanionView(val companionTypes: List<String>, val petFlag: Boolean, val isNeutralDefault: Boolean)

/** 예산 축 — 등급 + 금액(쌍, INV-PR3). */
data class BudgetView(val tier: String?, val rawAmount: Long?, val isNeutralDefault: Boolean)

/** 7축 완전 조회 응답(중립 기본값 주입, INV-PR5). */
data class PreferenceView(
    val styles: ArrayAxisView,
    val activities: ArrayAxisView,
    val transportModes: ArrayAxisView,
    val foodTastes: ArrayAxisView,
    val pace: ScalarAxisView,
    val companion: CompanionView,
    val budget: BudgetView,
)
