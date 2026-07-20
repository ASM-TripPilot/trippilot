package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.RefreshSession
import com.trippilot.auth.domain.RefreshSessionId
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.RefreshSessionRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Duration
import java.time.Instant
import java.util.UUID

/**
 * TRIP-153 2단계 — refresh_session 영속 어댑터 IT. 회전 순서·부분 유니크 인덱스·체인 폐기를 실제 DB로 검증.
 * 149 하네스(싱글톤 PG + Flyway) 재사용. account_id FK 때문에 계정을 먼저 만든다.
 */
@SpringBootTest
class RefreshSessionPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired
    lateinit var accounts: AccountRepository

    @Autowired
    lateinit var sessions: RefreshSessionRepository

    private val now = Instant.parse("2026-07-19T00:00:00Z")
    private val ttl = Duration.ofDays(90)

    private fun newAccount(): AccountId =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id

    private fun hash() = "h-${UUID.randomUUID()}"

    @Test
    fun `저장 후 token_hash 로 조회된다`() {
        val account = newAccount()
        val session = RefreshSession.issue(account, "device-1", hash(), now, ttl)
        sessions.save(session)

        val found = sessions.findByTokenHash(session.tokenHash)

        found.shouldNotBeNull()
        found.accountId shouldBe account
        found.isCurrent(now) shouldBe true
    }

    @Test
    fun `회전은 이전 UPDATE 를 먼저 flush 해 부분 유니크 인덱스를 위반하지 않는다`() {
        val account = newAccount()
        val first = RefreshSession.issue(account, "device-1", hash(), now, ttl)
        sessions.save(first)

        // 소진(UPDATE) → 후속(INSERT) 순서로 저장 — 예외 없이 성공해야 한다
        sessions.save(first.rotate(now))
        val next = RefreshSession.next(first, hash(), now, ttl)
        sessions.save(next)

        sessions.findByTokenHash(first.tokenHash)!!.isRotated() shouldBe true
        sessions.findByTokenHash(next.tokenHash)!!.isCurrent(now) shouldBe true
    }

    @Test
    fun `같은 체인에 현행 세션 2개는 유니크 인덱스가 막는다 (INV-R1)`() {
        val account = newAccount()
        val first = RefreshSession.issue(account, "device-1", hash(), now, ttl)
        sessions.save(first)

        // 같은 chainId 로 또 하나의 현행 세션(rotated·revoked 모두 null)을 강제 생성
        val duplicateCurrent = RefreshSession.reconstitute(
            id = RefreshSessionId.new(),
            accountId = account,
            deviceId = "device-1",
            tokenHash = hash(),
            chainId = first.chainId,
            issuedAt = now,
            expiresAt = now.plus(ttl),
            rotatedAt = null,
            revokedAt = null,
        )

        shouldThrow<Exception> { sessions.save(duplicateCurrent) }
    }

    @Test
    fun `revokeChain 은 체인의 미폐기 세션을 전부 폐기한다`() {
        val account = newAccount()
        val first = RefreshSession.issue(account, "device-1", hash(), now, ttl)
        sessions.save(first)
        sessions.save(first.rotate(now))
        val next = RefreshSession.next(first, hash(), now, ttl)
        sessions.save(next)

        val revoked = sessions.revokeChain(first.chainId, now)

        revoked shouldBe 2 // 회전된 first + 현행 next 모두 revoked_at=null 이었으므로 둘 다 폐기
        sessions.findByTokenHash(first.tokenHash)!!.isRevoked() shouldBe true
        sessions.findByTokenHash(next.tokenHash)!!.isRevoked() shouldBe true
    }
}
