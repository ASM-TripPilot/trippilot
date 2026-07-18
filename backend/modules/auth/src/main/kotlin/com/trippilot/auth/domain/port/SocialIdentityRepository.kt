package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialIdentity

/** 소셜 연결 영속 포트. `(provider, providerSub)` 로 기존 계정 여부 판별. */
interface SocialIdentityRepository {
    fun findByProviderAndProviderSub(provider: Provider, providerSub: String): SocialIdentity?

    fun save(identity: SocialIdentity): SocialIdentity
}
