package com.trippilot.auth.adapter.out.persistence

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

/** location_consent_state 매핑(V1.3, 계정당 1행). L1 미러·L2 법정·L3 GPS. */
@Entity
@Table(name = "location_consent_state")
class LocationConsentStateJpaEntity(
    @Id
    @Column(name = "account_id")
    var accountId: UUID,

    @Column(name = "os_permission_mirror")
    var osPermissionMirror: String,

    @Column(name = "legal_consent")
    var legalConsent: Boolean,

    @Column(name = "gps_recording_opt_in")
    var gpsRecordingOptIn: Boolean,

    @Column(name = "updated_at")
    var updatedAt: Instant,
)

/**
 * location_legal_log 매핑(V1.3). **append-only** — log_id 는 bigint IDENTITY(DB 생성).
 * app_user 는 UPDATE/DELETE 권한 없음(V1.7, INV-LL1). detail 은 jsonb(원시 좌표 미포함).
 */
@Entity
@Table(name = "location_legal_log")
class LocationLegalLogJpaEntity(
    @Column(name = "account_id")
    var accountId: UUID,

    @Column(name = "event_type")
    var eventType: String,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "detail")
    var detail: String,

    @Column(name = "occurred_at")
    var occurredAt: Instant,

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "log_id")
    var logId: Long? = null,
)
