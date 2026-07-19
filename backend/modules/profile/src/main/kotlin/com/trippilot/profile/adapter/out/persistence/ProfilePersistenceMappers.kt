package com.trippilot.profile.adapter.out.persistence

import com.trippilot.profile.domain.PreferenceSet
import com.trippilot.profile.domain.Profile

/** profile 영속 ↔ 도메인 매핑. text[] 는 Array ↔ List 변환. */

fun ProfileJpaEntity.toDomain(): Profile =
    Profile.reconstitute(accountId, nickname, nicknameUpdatedAt, onboardingCompletedAt)

fun Profile.toEntity(): ProfileJpaEntity =
    ProfileJpaEntity(accountId, nickname, nicknameUpdatedAt, onboardingCompletedAt)

fun PreferenceSetJpaEntity.toDomain(): PreferenceSet =
    PreferenceSet.reconstitute(
        accountId = accountId,
        styles = styles?.toList(),
        budgetTier = budgetTier,
        budgetRawAmount = budgetRawAmount,
        companionTypes = companionTypes?.toList(),
        petFlag = petFlag,
        activities = activities?.toList(),
        transportModes = transportModes?.toList(),
        foodTastes = foodTastes?.toList(),
        pace = pace,
        updatedAt = updatedAt,
    )

fun PreferenceSet.toEntity(): PreferenceSetJpaEntity =
    PreferenceSetJpaEntity(
        accountId = accountId,
        styles = styles?.toTypedArray(),
        budgetTier = budgetTier,
        budgetRawAmount = budgetRawAmount,
        companionTypes = companionTypes?.toTypedArray(),
        petFlag = petFlag,
        activities = activities?.toTypedArray(),
        transportModes = transportModes?.toTypedArray(),
        foodTastes = foodTastes?.toTypedArray(),
        pace = pace,
        updatedAt = updatedAt,
    )
