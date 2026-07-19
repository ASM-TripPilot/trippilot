package com.trippilot.auth

import com.trippilot.auth.domain.RefreshSession
import com.trippilot.auth.domain.RefreshSessionId
import com.trippilot.auth.domain.port.GeneratedRefreshToken
import com.trippilot.auth.domain.port.RefreshSessionRepository
import com.trippilot.auth.domain.port.RefreshTokenGenerator
import java.time.Instant
import java.util.UUID

/** 인메모리 리프레시 세션 저장소(테스트용) — DB 없이 서비스 로직 검증. */
internal class FakeRefreshSessionRepository : RefreshSessionRepository {
    val sessions = linkedMapOf<RefreshSessionId, RefreshSession>()

    override fun save(session: RefreshSession): RefreshSession = session.also { sessions[it.id] = it }

    override fun findByTokenHash(tokenHash: String): RefreshSession? =
        sessions.values.firstOrNull { it.tokenHash == tokenHash }

    override fun revokeChain(chainId: UUID, now: Instant): Int {
        val targets = sessions.values.filter { it.chainId == chainId && it.revokedAt == null }
        targets.forEach { sessions[it.id] = it.revoke(now) }
        return targets.size
    }
}

/** 결정적 리프레시 토큰 생성기(테스트용) — 원문 raw-N, 해시 h:raw-N. */
internal class FakeRefreshTokenGenerator : RefreshTokenGenerator {
    private var counter = 0

    override fun generate(): GeneratedRefreshToken {
        val raw = "raw-${counter++}"
        return GeneratedRefreshToken(rawToken = raw, tokenHash = hash(raw))
    }

    override fun hash(rawToken: String): String = "h:$rawToken"
}
