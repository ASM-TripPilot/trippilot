package com.trippilot.app.persistence

import com.trippilot.auth.adapter.out.persistence.JpaProviderRevocationTokenRepository
import com.trippilot.auth.adapter.out.persistence.ProviderTokenCipher
import com.trippilot.auth.adapter.out.persistence.SocialIdentityJpaRepository
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.CascadeSummary
import com.trippilot.auth.domain.DeletionSchedule
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialIdentity
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.DeletionScheduleRepository
import com.trippilot.auth.domain.port.SocialIdentityRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.util.Base64
import java.util.UUID

/**
 * TRIP-933 — 제공자 revoke 토큰 영속(V2.52). 네이티브 쿼리 셋(보관·파기 도래 조회·삭제)이 실 스키마에서
 * 도는지, 그리고 **DB 에 평문이 남지 않는지**를 본다. 파기 도래 조회는 철회·미도래 계정을 집으면 안 된다 —
 * 집으면 30일 유예 중 철회한 사용자의 애플 연결이 끊긴다.
 */
@SpringBootTest
class ProviderRevocationTokenPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired lateinit var accounts: AccountRepository
    @Autowired lateinit var identities: SocialIdentityRepository
    @Autowired lateinit var schedules: DeletionScheduleRepository
    @Autowired lateinit var identityJpa: SocialIdentityJpaRepository
    @Autowired lateinit var jdbc: JdbcTemplate

    // 컨텍스트의 키는 비어 있다(테스트 설정) — 여기서는 키를 준 인스턴스를 직접 세운다.
    private val repo by lazy {
        JpaProviderRevocationTokenRepository(
            identityJpa,
            ProviderTokenCipher(Base64.getEncoder().encodeToString(ByteArray(32) { 3 })),
        )
    }

    private val requestedAt = Instant.parse("2026-08-01T00:00:00Z")
    private val purgeAt = requestedAt.plusSeconds(2_592_000)

    /** 애플 계정 하나 + (선택) 삭제 예약. 반환: (sub, socialIdentityId). */
    private fun appleAccount(schedule: ((Account) -> DeletionSchedule)?): Pair<String, UUID> {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, requestedAt))
        val sub = "apple-${UUID.randomUUID()}"
        val identity = identities.save(SocialIdentity.link(account.id, SocialProfile(Provider.APPLE, sub, null), requestedAt))
        schedule?.let { schedules.save(it(account)) }
        return sub to identity.id.value
    }

    private fun dueIds(now: Instant) = repo.findDueForRevocation(now, 1_000).map { it.socialIdentityId }.toSet()

    @Test
    fun `파기 시각이 지난 계정의 토큰만 집히고, 철회·미도래·예약 없음은 집히지 않는다`() {
        val (dueSub, dueId) = appleAccount { DeletionSchedule.create(it.id, requestedAt, purgeAt, CascadeSummary.forAccount()) }
        val (cancelledSub, cancelledId) = appleAccount {
            DeletionSchedule.create(it.id, requestedAt, purgeAt, CascadeSummary.forAccount()).cancel(requestedAt.plusSeconds(60))
        }
        val (notYetSub, notYetId) = appleAccount {
            DeletionSchedule.create(it.id, requestedAt, purgeAt.plusSeconds(86_400), CascadeSummary.forAccount())
        }
        val (liveSub, liveId) = appleAccount(null)
        listOf(dueSub, cancelledSub, notYetSub, liveSub).forEach { repo.store(Provider.APPLE, it, "refresh-$it") }

        // 전역 조회라 다른 테스트의 행이 섞일 수 있다 — 이번 건들로 좁혀 묻는다(anti-patterns · TRIP-547).
        val mine = setOf(dueId, cancelledId, notYetId, liveId)
        dueIds(purgeAt.plusSeconds(1)).intersect(mine) shouldBe setOf(dueId)

        val due = repo.findDueForRevocation(purgeAt.plusSeconds(1), 1_000).single { it.socialIdentityId == dueId }
        due.provider shouldBe Provider.APPLE
        due.token shouldBe "refresh-$dueSub"
    }

    @Test
    fun `DB 에는 평문이 아니라 암호문이 남는다`() {
        val (sub, id) = appleAccount(null)
        repo.store(Provider.APPLE, sub, "plain-refresh-token")

        val raw = jdbc.queryForObject(
            "select provider_refresh_token_enc from social_identity where social_identity_id = ?", String::class.java, id,
        )
        raw!! shouldNotContain "plain-refresh-token"
    }

    @Test
    fun `revoke 뒤 지우면 다음 회차에 다시 집히지 않는다 — 재로그인은 토큰을 덮어쓴다`() {
        val (sub, id) = appleAccount { DeletionSchedule.create(it.id, requestedAt, purgeAt, CascadeSummary.forAccount()) }
        repo.store(Provider.APPLE, sub, "first")
        repo.store(Provider.APPLE, sub, "second")

        repo.findDueForRevocation(purgeAt, 1_000).single { it.socialIdentityId == id }.token shouldBe "second"

        repo.clear(id)
        (id in dueIds(purgeAt)) shouldBe false
    }
}
