package com.trippilot.profile.domain

import java.util.UUID

/** 프로필 조회·저장 포트(계정당 1행). */
interface ProfileRepository {
    fun find(accountId: UUID): Profile?

    /** 대소문자 무시 닉네임 사용 여부(INV-P1 유일성, DB ux_profile_nickname 과 정합). */
    fun existsByNickname(nickname: String): Boolean

    fun save(profile: Profile): Profile
}

/** 취향 7축 조회·저장 포트(계정당 1행 upsert). */
interface PreferenceSetRepository {
    fun find(accountId: UUID): PreferenceSet?

    fun save(preferenceSet: PreferenceSet): PreferenceSet
}
