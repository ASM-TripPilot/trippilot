package com.trippilot.profile.adapter.out.persistence

import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

/** profile — 계정당 1행. */
interface ProfileJpaRepository : JpaRepository<ProfileJpaEntity, UUID>

/** preference_set — 계정당 1행 upsert. */
interface PreferenceSetJpaRepository : JpaRepository<PreferenceSetJpaEntity, UUID>
