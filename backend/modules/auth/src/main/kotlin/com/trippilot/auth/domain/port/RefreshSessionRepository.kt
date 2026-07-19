package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.RefreshSession
import java.time.Instant
import java.util.UUID

/** 리프레시 세션 영속 포트. 구현은 adapter/out/persistence(JPA). */
interface RefreshSessionRepository {
    fun save(session: RefreshSession): RefreshSession

    fun findByTokenHash(tokenHash: String): RefreshSession?

    /** 체인의 미폐기 세션을 전부 폐기(재사용 대응, INV-R2). 폐기된 건수를 반환. */
    fun revokeChain(chainId: UUID, now: Instant): Int
}
