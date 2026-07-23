package com.trippilot.auth.adapter.out.persistence

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

/** Spring Data JPA — account 테이블 CRUD. */
interface AccountJpaRepository : JpaRepository<AccountJpaEntity, UUID>

/** Spring Data JPA — social_identity 테이블 CRUD + (provider, sub) 조회 + 계정별 연결 조회. */
interface SocialIdentityJpaRepository : JpaRepository<SocialIdentityJpaEntity, UUID> {
    fun findByProviderAndProviderSub(provider: String, providerSub: String): SocialIdentityJpaEntity?

    fun findByAccountId(accountId: UUID): List<SocialIdentityJpaEntity>
}

/** Spring Data JPA — refresh_session 테이블 CRUD + 해시 조회 + 체인 폐기. */
interface RefreshSessionJpaRepository : JpaRepository<RefreshSessionJpaEntity, UUID> {
    fun findByTokenHash(tokenHash: String): RefreshSessionJpaEntity?

    /**
     * 체인의 미폐기 세션 전부 폐기(재사용 대응). 영향 행 수 반환.
     * @Transactional: 서비스 tx 안에서는 참여(REQUIRED), 어댑터 직접 호출(IT) 시 자체 tx 로 벌크 UPDATE 보장.
     */
    @Transactional
    @Modifying
    @Query("update RefreshSessionJpaEntity s set s.revokedAt = :now where s.chainId = :chainId and s.revokedAt is null")
    fun revokeChain(@Param("chainId") chainId: UUID, @Param("now") now: Instant): Int

    /** 계정의 미폐기 세션 전부 폐기(삭제 요청 시 전 기기 로그아웃). */
    @Transactional
    @Modifying
    @Query("update RefreshSessionJpaEntity s set s.revokedAt = :now where s.accountId = :accountId and s.revokedAt is null")
    fun revokeByAccount(@Param("accountId") accountId: UUID, @Param("now") now: Instant): Int
}
