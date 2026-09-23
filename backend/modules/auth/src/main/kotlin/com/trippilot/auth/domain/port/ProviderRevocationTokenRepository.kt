package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.Provider
import java.time.Instant
import java.util.UUID

/** 파기 시 revoke 해야 할 제공자 토큰 한 건. [token] 은 복호화된 값이다 — 로그에 싣지 않는다. */
data class PendingRevocation(val socialIdentityId: UUID, val provider: Provider, val token: String) {
    override fun toString(): String = "PendingRevocation(socialIdentityId=$socialIdentityId, provider=$provider)"
}

/**
 * 제공자 revoke 토큰 보관(TRIP-933) — `social_identity.provider_refresh_token_enc`(암호화 저장).
 *
 * **값이 남아 있다 = 아직 revoke 하지 않았다.** 별도 재시도 큐를 두지 않고 이 컬럼 자체가 큐다 —
 * revoke 가 성공하면 지우고, 실패하면 그대로 둬 다음 스위프가 다시 집는다.
 */
interface ProviderRevocationTokenRepository {
    /** `(provider, providerSub)` 연결에 토큰을 덮어쓴다(재로그인마다 새 토큰). 보관이 불가능한 환경이면 건너뛴다. */
    fun store(provider: Provider, providerSub: String, token: String)

    /** 파기 예정 시각이 지났고(철회 안 됨) 토큰이 남아 있는 연결들. */
    fun findDueForRevocation(now: Instant, limit: Int): List<PendingRevocation>

    fun clear(socialIdentityId: UUID)
}
