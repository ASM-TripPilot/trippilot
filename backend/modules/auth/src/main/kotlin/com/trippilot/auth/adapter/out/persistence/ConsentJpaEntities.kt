package com.trippilot.auth.adapter.out.persistence

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

/** terms_version 매핑(V1.2). 읽기 전용 사용 — 현행 판정은 도메인/서비스 소유. */
@Entity
@Table(name = "terms_version")
class TermsVersionJpaEntity(
    @Id
    @Column(name = "terms_version_id")
    var termsVersionId: UUID,

    @Column(name = "terms_type")
    var termsType: String,

    @Column(name = "version")
    var version: String,

    @Column(name = "body")
    var body: String,

    @Column(name = "effective_at")
    var effectiveAt: Instant,

    @Column(name = "reconsent_required")
    var reconsentRequired: Boolean,
)

/**
 * consent_record 매핑(V1.2). **append-only** — record_id 는 bigint IDENTITY(DB 생성).
 * app_user 는 UPDATE/DELETE 권한 없음(V1.7, INV-C1) — INSERT 만 수행.
 */
@Entity
@Table(name = "consent_record")
class ConsentRecordJpaEntity(
    @Column(name = "account_id")
    var accountId: UUID,

    @Column(name = "terms_type")
    var termsType: String,

    @Column(name = "terms_version")
    var termsVersion: String,

    @Column(name = "action")
    var action: String,

    @Column(name = "channel")
    var channel: String,

    @Column(name = "occurred_at")
    var occurredAt: Instant,

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "record_id")
    var recordId: Long? = null,
)

/** marketing_consent 매핑(V1.2, 계정당 1행). */
@Entity
@Table(name = "marketing_consent")
class MarketingConsentJpaEntity(
    @Id
    @Column(name = "account_id")
    var accountId: UUID,

    @Column(name = "opt_in")
    var optIn: Boolean,

    @Column(name = "updated_at")
    var updatedAt: Instant,
)
