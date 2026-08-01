package com.trippilot.auth.domain

import java.time.Duration
import java.time.Instant
import java.util.UUID

/** refresh_session PK. */
@JvmInline
value class RefreshSessionId(val value: UUID) {
    companion object {
        fun new(): RefreshSessionId = RefreshSessionId(UUID.randomUUID())
    }
}

/**
 * 리프레시 세션 — 회전 체인(chainId)의 한 마디. 원문 토큰은 저장하지 않고 SHA-256 해시만 보관.
 *
 * 상태: 현행(rotated=null·revoked=null·미만료) → 회전(rotatedAt) 또는 폐기(revokedAt).
 * 한 체인에는 현행 세션이 최대 1개(INV-R1, DB 부분 유니크 인덱스 ux_refresh_chain_current 로 강제).
 * 소진된(회전된) 토큰이 다시 제시되면 재사용 → 체인 전체 폐기(INV-R2)는 서비스가 수행한다.
 */
class RefreshSession private constructor(
    val id: RefreshSessionId,
    val accountId: AccountId,
    val deviceId: String,
    val tokenHash: String,
    val chainId: UUID,
    val issuedAt: Instant,
    val expiresAt: Instant,
    val rotatedAt: Instant?,
    val revokedAt: Instant?,
) {
    fun isExpired(now: Instant): Boolean = !now.isBefore(expiresAt)
    fun isRotated(): Boolean = rotatedAt != null
    fun isRevoked(): Boolean = revokedAt != null
    fun isCurrent(now: Instant): Boolean = !isRotated() && !isRevoked() && !isExpired(now)

    /** 이 세션을 소진 처리(회전). 같은 체인의 후속 토큰은 [next] 로 발급한다. */
    fun rotate(now: Instant): RefreshSession =
        RefreshSession(id, accountId, deviceId, tokenHash, chainId, issuedAt, expiresAt, rotatedAt = now, revokedAt)

    /** 이 세션을 폐기(로그아웃·재사용 대응). */
    fun revoke(now: Instant): RefreshSession =
        RefreshSession(id, accountId, deviceId, tokenHash, chainId, issuedAt, expiresAt, rotatedAt, revokedAt = now)

    companion object {
        /** 새 체인의 첫 세션(로그인 시 발급). */
        fun issue(accountId: AccountId, deviceId: String, tokenHash: String, now: Instant, ttl: Duration): RefreshSession =
            RefreshSession(RefreshSessionId.new(), accountId, deviceId, tokenHash, UUID.randomUUID(), now, now.plus(ttl), null, null)

        /** 회전 후속 — 이전 세션과 같은 체인에 새 토큰을 잇는다. */
        fun next(previous: RefreshSession, tokenHash: String, now: Instant, ttl: Duration): RefreshSession =
            RefreshSession(RefreshSessionId.new(), previous.accountId, previous.deviceId, tokenHash, previous.chainId, now, now.plus(ttl), null, null)

        /** 영속 계층에서 재구성. */
        fun reconstitute(
            id: RefreshSessionId,
            accountId: AccountId,
            deviceId: String,
            tokenHash: String,
            chainId: UUID,
            issuedAt: Instant,
            expiresAt: Instant,
            rotatedAt: Instant?,
            revokedAt: Instant?,
        ): RefreshSession =
            RefreshSession(id, accountId, deviceId, tokenHash, chainId, issuedAt, expiresAt, rotatedAt, revokedAt)
    }
}
