package com.trippilot.profile.domain

import java.util.UUID

/** 프로필 조회·저장 포트(계정당 1행). 생성/닉네임 설정은 TRIP-157. */
interface ProfileRepository {
    fun find(accountId: UUID): Profile?

    fun save(profile: Profile): Profile
}

/** 취향 7축 조회·저장 포트(계정당 1행 upsert). */
interface PreferenceSetRepository {
    fun find(accountId: UUID): PreferenceSet?

    fun save(preferenceSet: PreferenceSet): PreferenceSet
}
