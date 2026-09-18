package com.trippilot.profile.adapter.out.persistence

import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

/** profile — 계정당 1행. 닉네임 유일성은 대소문자 무시(ux_profile_nickname=lower(nickname)). */
interface ProfileJpaRepository : JpaRepository<ProfileJpaEntity, UUID> {
    fun existsByNicknameIgnoreCase(nickname: String): Boolean
}

/** preference_set — 계정당 1행 upsert. */
interface PreferenceSetJpaRepository : JpaRepository<PreferenceSetJpaEntity, UUID>
