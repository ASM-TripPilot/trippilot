package com.trippilot.profile.application

import com.trippilot.core.export.AccountDataContributor
import com.trippilot.core.export.ExportSection
import com.trippilot.profile.domain.PreferenceSetRepository
import com.trippilot.profile.domain.ProfileRepository
import org.springframework.stereotype.Component
import java.util.UUID

/** 프로필·취향 몫(TRIP-551). 계정당 각각 한 건이라 상한에 걸릴 일이 없다. */
@Component
class ProfileExportContributor(
    private val profiles: ProfileRepository,
    private val preferences: PreferenceSetRepository,
) : AccountDataContributor {
    override val section = "profile"

    override fun export(accountId: UUID, limit: Int): ExportSection {
        val profile = profiles.find(accountId)
        val preference = preferences.find(accountId)
        if (profile == null && preference == null) return ExportSection(section, emptyList())
        val row: Map<String, Any?> = mapOf(
            "nickname" to profile?.nickname,
            "onboardingCompletedAt" to profile?.onboardingCompletedAt?.toString(),
            "preferences" to preference?.let {
                mapOf(
                    "styles" to it.styles,
                    "budgetTier" to it.budgetTier,
                    "companionTypes" to it.companionTypes,
                    "petFlag" to it.petFlag,
                    "activities" to it.activities,
                    "transportModes" to it.transportModes,
                    "foodTastes" to it.foodTastes,
                    "pace" to it.pace,
                    "updatedAt" to it.updatedAt.toString(),
                )
            },
        )
        return ExportSection(section, listOf(row))
    }
}
