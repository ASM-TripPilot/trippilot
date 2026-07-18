package com.trippilot.auth.domain

import java.time.Instant
import java.util.UUID

@JvmInline
value class SocialIdentityId(val value: UUID) {
    companion object {
        fun new(): SocialIdentityId = SocialIdentityId(UUID.randomUUID())
    }
}

/**
 * 계정과 소셜 제공자의 연결(도메인). `(provider, providerSub)` 가 계정 식별 기준(유니크).
 */
class SocialIdentity private constructor(
    val id: SocialIdentityId,
    val accountId: AccountId,
    val provider: Provider,
    val providerSub: String,
    val providerEmail: String?,
    val linkedAt: Instant,
) {
    companion object {
        fun link(
            accountId: AccountId,
            profile: SocialProfile,
            now: Instant,
            id: SocialIdentityId = SocialIdentityId.new(),
        ): SocialIdentity = SocialIdentity(
            id = id,
            accountId = accountId,
            provider = profile.provider,
            providerSub = profile.providerSub,
            providerEmail = profile.email,
            linkedAt = now,
        )
    }
}
