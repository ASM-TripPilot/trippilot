package com.trippilot.auth.adapter.out.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialIdentity
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.SocialIdentityRepository
import org.springframework.stereotype.Repository

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

    override fun save(identity: SocialIdentity): SocialIdentity {
        jpa.save(identity.toEntity())
        return identity
    }
}
