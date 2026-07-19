package com.trippilot.profile.adapter.out.persistence

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

/** profile 매핑(V1.5, 계정당 1행). 닉네임 유일성은 DB 인덱스 ux_profile_nickname. */
@Entity
@Table(name = "profile")
class ProfileJpaEntity(
    @Id
    @Column(name = "account_id")
    var accountId: UUID,

    @Column(name = "nickname")
    var nickname: String,

    @Column(name = "nickname_updated_at")
    var nicknameUpdatedAt: Instant,

    @Column(name = "onboarding_completed_at")
    var onboardingCompletedAt: Instant?,
)

/**
 * preference_set 매핑(V1.5, 계정당 1행). 배열 축은 text[](@JdbcTypeCode ARRAY).
 * NULL=미설정(INV-PR2) — 중립 기본값은 저장하지 않는다.
 */
@Entity
@Table(name = "preference_set")
class PreferenceSetJpaEntity(
    @Id
    @Column(name = "account_id")
    var accountId: UUID,

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "styles")
    var styles: Array<String>?,

    @Column(name = "budget_tier")
    var budgetTier: String?,

    @Column(name = "budget_raw_amount")
    var budgetRawAmount: Long?,

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "companion_types")
    var companionTypes: Array<String>?,

    @Column(name = "pet_flag")
    var petFlag: Boolean,

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "activities")
    var activities: Array<String>?,

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "transport_modes")
    var transportModes: Array<String>?,

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "food_tastes")
    var foodTastes: Array<String>?,

    @Column(name = "pace")
    var pace: String?,

    @Column(name = "updated_at")
    var updatedAt: Instant,
)
