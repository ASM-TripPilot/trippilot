package com.trippilot.auth.adapter.out.persistence

import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.port.PendingRevocation
import com.trippilot.auth.domain.port.ProviderRevocationTokenRepository
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Repository
import java.time.Instant
import java.util.UUID

/**
 * [ProviderRevocationTokenRepository] 구현 — `social_identity.provider_refresh_token_enc`(V2.52).
 *
 * 컬럼을 [SocialIdentityJpaEntity] 에 매핑하지 않고 네이티브 쿼리로만 다룬다. 엔티티에 두면
 * `JpaSocialIdentityRepository.save` 가 도메인→엔티티 전체 덮어쓰기라 **저장할 때마다 토큰이 null 로 지워진다.**
 */
@Repository
class JpaProviderRevocationTokenRepository(
    private val jpa: SocialIdentityJpaRepository,
    private val cipher: ProviderTokenCipher,
) : ProviderRevocationTokenRepository {

    override fun store(provider: Provider, providerSub: String, token: String) {
        if (!cipher.configured) {
            log.warn("SOCIAL_TOKEN_ENCRYPTION_KEY 가 없어 {} revoke 토큰을 보관하지 않습니다 — 이 계정은 파기 때 revoke 되지 않습니다.", provider)
            return
        }
        // 같은 트랜잭션에서 방금 persist 한 신규 연결이 아직 INSERT 전일 수 있다 — 네이티브 UPDATE 전에 내보낸다.
        jpa.flush()
        jpa.storeRevocationToken(provider.name, providerSub, cipher.encrypt(token))
    }

    override fun findDueForRevocation(now: Instant, limit: Int): List<PendingRevocation> {
        if (!cipher.configured) return emptyList()
        return jpa.findDueRevocationTokens(now, limit).mapNotNull { row ->
            try {
                PendingRevocation(row.getSocialIdentityId(), Provider.valueOf(row.getProvider()), cipher.decrypt(row.getToken()))
            } catch (e: Exception) {
                // 키가 바뀌었거나 값이 깨졌다 — 이 한 건만 건너뛴다. 나머지 파기 대상을 막지 않는다.
                log.error("revoke 토큰 복호화 실패(social_identity={}, {}) — 건너뜁니다.", row.getSocialIdentityId(), e.javaClass.simpleName)
                null
            }
        }
    }

    override fun clear(socialIdentityId: UUID) {
        jpa.clearRevocationToken(socialIdentityId)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(JpaProviderRevocationTokenRepository::class.java)
    }
}
