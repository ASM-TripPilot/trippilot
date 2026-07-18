package com.trippilot.auth.adapter.out.persistence

import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

/** Spring Data JPA — account 테이블 CRUD. */
interface AccountJpaRepository : JpaRepository<AccountJpaEntity, UUID>

/** Spring Data JPA — social_identity 테이블 CRUD + (provider, sub) 조회. */
interface SocialIdentityJpaRepository : JpaRepository<SocialIdentityJpaEntity, UUID> {
    fun findByProviderAndProviderSub(provider: String, providerSub: String): SocialIdentityJpaEntity?
}
