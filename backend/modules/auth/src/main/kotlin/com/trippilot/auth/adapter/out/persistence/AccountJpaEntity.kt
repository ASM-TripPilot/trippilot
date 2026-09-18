package com.trippilot.auth.adapter.out.persistence

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * account 테이블 매핑(도메인 Account 와 분리 — 도메인 순수성 R2).
 * 스키마는 Flyway 소유(V1.1). sanction_status·deleted_at 은 TRIP-152 에서 매핑.
 */
@Entity
@Table(name = "account")
class AccountJpaEntity(
    @Id
    @Column(name = "account_id")
    var accountId: UUID,

    @Column(name = "email")
    var email: String?,

    @Column(name = "age_method")
    var ageMethod: String,

    @Column(name = "birth_date")
    var birthDate: LocalDate?,

    @Column(name = "age_confirmed_at")
    var ageConfirmedAt: Instant,

    @Column(name = "status")
    var status: String,

    @Column(name = "sanction_status")
    var sanctionStatus: String,

    @Column(name = "created_at")
    var createdAt: Instant,

    @Column(name = "verified_at")
    var verifiedAt: Instant?,

    @Column(name = "deleted_at")
    var deletedAt: Instant?,
)
