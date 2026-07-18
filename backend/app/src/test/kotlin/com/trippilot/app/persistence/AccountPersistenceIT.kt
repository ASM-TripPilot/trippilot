package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountStatus
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialIdentity
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.SocialIdentityRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Instant
import java.util.UUID

/**
 * TRIP-151 4단계 — auth 영속 어댑터 IT. 조립된 앱 컨텍스트(마이그레이션된 스키마)로 포트 구현을 검증.
 * 149 하네스(AbstractPostgresIntegrationTest) 재사용 — 싱글톤 PG 컨테이너 + Flyway.
 */
@SpringBootTest
class AccountPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired
    lateinit var accounts: AccountRepository

    @Autowired
    lateinit var identities: SocialIdentityRepository

    private val now = Instant.parse("2026-01-01T00:00:00Z")

    @Test
    fun `account 저장·조회 왕복`() {
        val email = "acct-${UUID.randomUUID()}@example.com" // 공유 컨테이너의 이메일 유니크 인덱스 회피
        val account = Account.registerViaSocial(email, AgeMethod.SELF_DECLARED, null, now)
        accounts.save(account)

        val found = accounts.findById(account.id)

        found.shouldNotBeNull()
        found.email shouldBe email
        found.status shouldBe AccountStatus.ACTIVE
        found.verifiedAt shouldBe account.createdAt
    }

    @Test
    fun `social_identity 저장 후 (provider, sub) 로 계정 연결 조회`() {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        val sub = "sub-${UUID.randomUUID()}"
        identities.save(SocialIdentity.link(account.id, SocialProfile(Provider.KAKAO, sub, "user@example.com"), now))

        val found = identities.findByProviderAndProviderSub(Provider.KAKAO, sub)

        found.shouldNotBeNull()
        found.accountId shouldBe account.id
        found.providerEmail shouldBe "user@example.com"
    }

    @Test
    fun `(provider, sub) 복합 유니크 위반 시 예외`() {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        val sub = "sub-${UUID.randomUUID()}"
        identities.save(SocialIdentity.link(account.id, SocialProfile(Provider.NAVER, sub, null), now))

        shouldThrow<Exception> {
            identities.save(SocialIdentity.link(account.id, SocialProfile(Provider.NAVER, sub, null), now))
        }
    }
}
