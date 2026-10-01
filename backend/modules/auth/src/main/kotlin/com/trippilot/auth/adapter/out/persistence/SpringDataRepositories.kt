package com.trippilot.auth.adapter.out.persistence

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

/** Spring Data JPA — account 테이블 CRUD. */
interface AccountJpaRepository : JpaRepository<AccountJpaEntity, UUID> {
    /**
     * 활성(인덱스 대상 상태) 계정 중 이메일 일치(대소문자 무시) 1건 — 소셜 이메일 충돌 판정(INV-A3).
     * 상태 집합은 ux_account_email_active 인덱스와 동일(DELETED 제외).
     */
    @Query(
        "select a from AccountJpaEntity a where lower(a.email) = lower(:email) " +
            "and a.status in ('PENDING_VERIFICATION', 'ACTIVE', 'DELETION_PENDING')",
    )
    fun findActiveByEmail(@Param("email") email: String): AccountJpaEntity?
}

/** Spring Data JPA — social_identity 테이블 CRUD + (provider, sub) 조회 + 계정별 연결 조회. */
interface SocialIdentityJpaRepository : JpaRepository<SocialIdentityJpaEntity, UUID> {
    fun findByProviderAndProviderSub(provider: String, providerSub: String): SocialIdentityJpaEntity?

    fun findByAccountId(accountId: UUID): List<SocialIdentityJpaEntity>

    // ── 제공자 revoke 토큰(TRIP-933) — 엔티티에 매핑하지 않은 컬럼이라 네이티브로만 다룬다 ──

    @Transactional
    @Modifying
    @Query(
        "update social_identity set provider_refresh_token_enc = :enc where provider = :provider and provider_sub = :sub",
        nativeQuery = true,
    )
    fun storeRevocationToken(@Param("provider") provider: String, @Param("sub") providerSub: String, @Param("enc") enc: String): Int

    /** 파기 예정 시각이 지났고 철회되지 않은 계정의, 토큰이 남은 연결(ix_deletion_purge 를 탄다). */
    @Query(
        """
        select si.social_identity_id as socialIdentityId, si.provider as provider, si.provider_refresh_token_enc as token
        from social_identity si
        join deletion_schedule d on d.account_id = si.account_id
        where d.cancelled_at is null and d.purge_at <= :now and si.provider_refresh_token_enc is not null
        order by d.purge_at
        limit :limit
        """,
        nativeQuery = true,
    )
    fun findDueRevocationTokens(@Param("now") now: Instant, @Param("limit") limit: Int): List<RevocationTokenRow>

    @Transactional
    @Modifying
    @Query("update social_identity set provider_refresh_token_enc = null where social_identity_id = :id", nativeQuery = true)
    fun clearRevocationToken(@Param("id") socialIdentityId: UUID): Int
}

/** [SocialIdentityJpaRepository.findDueRevocationTokens] 행 — 암호문 그대로다. */
interface RevocationTokenRow {
    fun getSocialIdentityId(): UUID
    fun getProvider(): String
    fun getToken(): String
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
