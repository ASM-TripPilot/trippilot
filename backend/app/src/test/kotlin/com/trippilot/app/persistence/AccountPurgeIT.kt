package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.CascadeSummary
import com.trippilot.auth.domain.DeletionSchedule
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.DeletionScheduleRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldNotContain
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.time.Duration
import java.time.Instant

/**
 * 계정 최종 파기(BR-U0-25) — 실 스키마의 CASCADE·권한·법정 보존이 함께 맞물리는가.
 *
 * 단위 테스트로는 못 본다: 파기는 account 행 하나를 지우고 나머지를 DB 의 ON DELETE CASCADE 에 맡긴다. 동의 증적의
 * FK(V1.2)가 그 삭제를 막고 있던 것도 실 DB 에서만 드러난다(V2.94 전에는 첫 번째 테스트가 FK 위반으로 실패한다).
 */
@SpringBootTest
class AccountPurgeIT : AbstractPostgresIntegrationTest() {

    @Autowired lateinit var accounts: AccountRepository
    @Autowired lateinit var schedules: DeletionScheduleRepository
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var txManager: PlatformTransactionManager

    private val requested = Instant.parse("2026-10-01T00:00:00Z")
    private val purgeAt = requested.plus(Duration.ofDays(30))
    private val grace = Duration.ofDays(7)

    /** 삭제 예약까지 마친 계정 — 프로필·동의 증적·위치 법정 로그·소셜 연결을 함께 만든다. */
    private fun pendingAccount(revocationToken: String? = null): AccountId {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, requested))
        val id = account.id.value
        jdbc.update("insert into profile (account_id, nickname) values (?, ?)", id, "n" + id.toString().take(8))
        jdbc.update(
            "insert into consent_record (account_id, terms_type, terms_version, action, channel) values (?, 'LOCATION_TERMS', '1.0', 'GRANT', 'ONBOARDING')",
            id,
        )
        jdbc.update("insert into location_legal_log (account_id, event_type, detail) values (?, 'CONSENT_GRANTED', '{}'::jsonb)", id)
        jdbc.update(
            "insert into social_identity (account_id, provider, provider_sub, provider_refresh_token_enc) values (?, 'APPLE', ?, ?)",
            id, "sub-$id", revocationToken,
        )
        accounts.save(account.requestDeletion())
        schedules.save(DeletionSchedule.create(account.id, requested, purgeAt, CascadeSummary.forAccount()))
        return account.id
    }

    private fun count(table: String, id: AccountId): Int =
        jdbc.queryForObject("select count(*) from $table where account_id = ?", Int::class.java, id.value)!!

    @Test
    fun `유예가 지난 계정은 지워지고 연관 데이터도 사라진다 — 동의 증적과 위치 법정 로그는 남는다`() {
        val id = pendingAccount()

        accounts.purgeDue(purgeAt.plusSeconds(1), grace, 100) shouldContain id

        count("account", id) shouldBe 0
        count("profile", id) shouldBe 0 // 닉네임 해제(BR-U0-25)
        count("social_identity", id) shouldBe 0
        count("deletion_schedule", id) shouldBe 0
        count("consent_record", id) shouldBe 1 // 법정 보존(INV-D3)
        count("location_legal_log", id) shouldBe 1
    }

    @Test
    fun `유예가 안 지난 계정은 그대로다`() {
        val id = pendingAccount()

        accounts.purgeDue(purgeAt.minusSeconds(1), grace, 100) shouldNotContain id

        count("account", id) shouldBe 1
    }

    @Test
    fun `재로그인으로 복구한 계정은 기한이 지나도 파기하지 않는다`() {
        val id = pendingAccount()
        val schedule = schedules.findActive(id)!!
        schedules.save(schedule.cancel(requested.plus(Duration.ofDays(3))))
        accounts.save(accounts.findById(id)!!.cancelDeletion())

        accounts.purgeDue(purgeAt.plus(Duration.ofDays(60)), grace, 100) shouldNotContain id

        count("account", id) shouldBe 1
        count("profile", id) shouldBe 1
    }

    @Test
    fun `예약이 살아 있어도 계정이 ACTIVE 면 지우지 않는다 — 복구와 파기가 엇갈린 순간`() {
        val id = pendingAccount()
        accounts.save(accounts.findById(id)!!.cancelDeletion()) // 예약 취소 전에 계정만 먼저 ACTIVE 로 돌아온 상태

        accounts.purgeDue(purgeAt.plusSeconds(1), grace, 100) shouldNotContain id

        count("account", id) shouldBe 1
    }

    @Test
    fun `제공자 토큰 revoke 가 남은 계정은 유예 동안 미루고 그 뒤엔 파기한다`() {
        val id = pendingAccount(revocationToken = "enc-token")

        accounts.purgeDue(purgeAt.plusSeconds(1), grace, 100) shouldNotContain id
        count("account", id) shouldBe 1

        accounts.purgeDue(purgeAt.plus(grace), grace, 100) shouldContain id
        count("account", id) shouldBe 0
    }

    @Test
    fun `한 번에 지우는 수는 limit 을 넘지 않고, 엇갈린 ACTIVE 행이 자리를 차지하지 않는다`() {
        val stuck = List(2) { pendingAccount() }.onEach { accounts.save(accounts.findById(it)!!.cancelDeletion()) }
        val ids = List(3) { pendingAccount() }

        val purged = mutableListOf<AccountId>()
        do {
            val batch = accounts.purgeDue(purgeAt.plusSeconds(1), grace, 2)
            (batch.size <= 2) shouldBe true
            purged += batch
        } while (batch.isNotEmpty())

        ids.forEach { purged shouldContain it; count("account", it) shouldBe 0 }
        stuck.forEach { count("account", it) shouldBe 1 }
    }

    @Test
    fun `파기와 복구가 같은 순간이면 복구가 이긴다 — 복구 커밋을 기다린 파기는 그 계정을 지우지 않는다`() {
        val id = pendingAccount()
        val locked = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        // 복구 트랜잭션: 계정을 ACTIVE 로 바꾸고 커밋하기 전에 멈춘다(행 잠금을 쥔 채).
        val restore = CompletableFuture.runAsync {
            TransactionTemplate(txManager).executeWithoutResult {
                jdbc.update("update account set status = 'ACTIVE' where account_id = ?", id.value)
                jdbc.update("update deletion_schedule set cancelled_at = now() where account_id = ?", id.value)
                locked.countDown()
                release.await(10, TimeUnit.SECONDS)
            }
        }
        locked.await(10, TimeUnit.SECONDS)
        // 파기: 복구 전 스냅숏으로 대상을 고른 뒤 잠긴 행을 기다린다. 복구가 커밋되면 최신 판으로 조건을 다시 본다.
        val purge = CompletableFuture.supplyAsync { accounts.purgeDue(purgeAt.plusSeconds(1), grace, 100) }
        Thread.sleep(500) // 파기가 행 잠금에서 기다리는 상태까지 가게 한다
        release.countDown()
        restore.get(10, TimeUnit.SECONDS)

        purge.get(10, TimeUnit.SECONDS) shouldNotContain id
        count("account", id) shouldBe 1
    }

}
