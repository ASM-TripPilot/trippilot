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

    /**
     * 파기 — 한 문장이라 상태 재확인과 삭제 사이에 틈이 없다. 같은 순간 재로그인 복구(cancelDeletion)가 커밋되면 account 행의
     * 최신 판(ACTIVE)으로 조건을 다시 평가해 지우지 않는다(READ COMMITTED 의 갱신 재검사 — 조건의 status 가 대상 행에 있다).
     * revoke 토큰이 남은 연결이 있으면 purge_at + 유예까지 미룬다.
     * 상태 조건이 하위 질의에도 있는 이유: limit 이 상태를 보기 전에 걸리면 예약만 살아 있는 ACTIVE 계정(복구 중 엇갈린 행)이
     * 자리를 차지해 진짜 대상이 영영 안 뽑힌다. 바깥 조건은 그 사이 복구된 행을 거르는 재확인이다.
     */
    @Transactional
    @Query(
        """
        delete from account a
        where a.account_id in (
            select d.account_id from deletion_schedule d
            join account p on p.account_id = d.account_id and p.status = 'DELETION_PENDING'
            where d.cancelled_at is null and d.purge_at <= :now
              and (d.purge_at <= :tokenDeadline
                   or not exists (select 1 from social_identity si
                                  where si.account_id = d.account_id and si.provider_refresh_token_enc is not null))
            order by d.purge_at
            limit :limit)
          and a.status = 'DELETION_PENDING'
        returning a.account_id
        """,
        nativeQuery = true,
    )
    fun purgeDue(@Param("now") now: Instant, @Param("tokenDeadline") tokenDeadline: Instant, @Param("limit") limit: Int): List<UUID>
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
