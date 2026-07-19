package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialIdentity

/** 소셜 연결 영속 포트. `(provider, providerSub)` 로 기존 계정 여부 판별. */
interface SocialIdentityRepository {
    fun findByProviderAndProviderSub(provider: Provider, providerSub: String): SocialIdentity?

    /** 계정에 연결된 소셜 신원 전체(GET /me 요약용). */
    fun findByAccountId(accountId: AccountId): List<SocialIdentity>

    fun save(identity: SocialIdentity): SocialIdentity
}
