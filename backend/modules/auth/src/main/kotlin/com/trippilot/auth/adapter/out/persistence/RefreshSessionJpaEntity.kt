package com.trippilot.auth.adapter.out.persistence

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

/**
 * refresh_session 테이블 매핑(V1.4). 원문 미저장(token_hash 만).
 * 현행/회전/폐기 판정은 도메인(RefreshSession) 소유 — 여기선 컬럼 그대로 보관.
 */
@Entity
@Table(name = "refresh_session")
class RefreshSessionJpaEntity(
    @Id
    @Column(name = "session_id")
    var sessionId: UUID,

    @Column(name = "account_id")
    var accountId: UUID,

    @Column(name = "device_id")
    var deviceId: String,

    @Column(name = "token_hash")
    var tokenHash: String,

    @Column(name = "chain_id")
    var chainId: UUID,

    @Column(name = "issued_at")
    var issuedAt: Instant,

    @Column(name = "expires_at")
    var expiresAt: Instant,

    @Column(name = "rotated_at")
    var rotatedAt: Instant?,

    @Column(name = "revoked_at")
    var revokedAt: Instant?,
)
