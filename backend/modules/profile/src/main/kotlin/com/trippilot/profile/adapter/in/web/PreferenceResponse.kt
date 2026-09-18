package com.trippilot.profile.adapter.`in`.web

import com.trippilot.profile.domain.PreferenceView

/** GET·PUT /me/preferences 응답 — 도메인 [PreferenceView] 를 웹 계약으로 매핑(도메인 형상 비노출). */
data class PreferenceResponse(
    val styles: ArrayAxis,
    val activities: ArrayAxis,
    val transportModes: ArrayAxis,
    val foodTastes: ArrayAxis,
    val pace: ScalarAxis,
    val companion: CompanionAxis,
    val budget: Budget,
) {
    data class ArrayAxis(val value: List<String>, val isNeutralDefault: Boolean)
    data class ScalarAxis(val value: String?, val isNeutralDefault: Boolean)
    data class CompanionAxis(val companionTypes: List<String>, val petFlag: Boolean, val isNeutralDefault: Boolean)
    data class Budget(val tier: String?, val rawAmount: Long?, val isNeutralDefault: Boolean)

    companion object {
        fun from(v: PreferenceView) = PreferenceResponse(
            styles = ArrayAxis(v.styles.value, v.styles.isNeutralDefault),
            activities = ArrayAxis(v.activities.value, v.activities.isNeutralDefault),
            transportModes = ArrayAxis(v.transportModes.value, v.transportModes.isNeutralDefault),
            foodTastes = ArrayAxis(v.foodTastes.value, v.foodTastes.isNeutralDefault),
            pace = ScalarAxis(v.pace.value, v.pace.isNeutralDefault),
            companion = CompanionAxis(v.companion.companionTypes, v.companion.petFlag, v.companion.isNeutralDefault),
            budget = Budget(v.budget.tier, v.budget.rawAmount, v.budget.isNeutralDefault),
        )
    }
}
