package com.trippilot.auth.adapter.out.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.RefreshSession
import com.trippilot.auth.domain.SocialIdentity
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.RefreshSessionRepository
import com.trippilot.auth.domain.port.SocialIdentityRepository
import org.springframework.stereotype.Repository
import java.time.Instant
import java.util.UUID

/** AccountRepository 포트의 JPA 구현(도메인 ↔ 엔티티 매핑). */
@Repository
class JpaAccountRepository(
    private val jpa: AccountJpaRepository,
) : AccountRepository {
    override fun findById(id: AccountId): Account? = jpa.findById(id.value).orElse(null)?.toDomain()

    override fun save(account: Account): Account {
        jpa.save(account.toEntity())
        return account
    }
}

/** SocialIdentityRepository 포트의 JPA 구현. */
@Repository
class JpaSocialIdentityRepository(
    private val jpa: SocialIdentityJpaRepository,
) : SocialIdentityRepository {
    override fun findByProviderAndProviderSub(provider: Provider, providerSub: String): SocialIdentity? =
        jpa.findByProviderAndProviderSub(provider.name, providerSub)?.toDomain()

    override fun findByAccountId(accountId: AccountId): List<SocialIdentity> =
        jpa.findByAccountId(accountId.value).map { it.toDomain() }

    override fun save(identity: SocialIdentity): SocialIdentity {
        jpa.save(identity.toEntity())
        return identity
    }
}

/**
 * RefreshSessionRepository 포트의 JPA 구현.
 * save 는 saveAndFlush — 회전 시 이전 세션 UPDATE 를 후속 INSERT 보다 먼저 flush 해
 * 부분 유니크 인덱스(ux_refresh_chain_current, 체인당 현행 1개) 위반을 막는다.
 */
@Repository
class JpaRefreshSessionRepository(
    private val jpa: RefreshSessionJpaRepository,
) : RefreshSessionRepository {
    override fun save(session: RefreshSession): RefreshSession {
        jpa.saveAndFlush(session.toEntity())
        return session
    }

    override fun findByTokenHash(tokenHash: String): RefreshSession? =
        jpa.findByTokenHash(tokenHash)?.toDomain()

    override fun revokeChain(chainId: UUID, now: Instant): Int = jpa.revokeChain(chainId, now)

    override fun revokeByAccount(accountId: AccountId, now: Instant): Int = jpa.revokeByAccount(accountId.value, now)
}
