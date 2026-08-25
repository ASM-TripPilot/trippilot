package com.trippilot.app

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.notification.application.NotificationToggleService
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.util.UUID

/**
 * 알림 토글 실 DB 검증(TRIP-548 · V2.35).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **복합 PK `(account_id, kind)`** — 종류당 한 행. Map 대역은 언제나 덮어써 이 성질이 존재하지 않는다
 * - **upsert 가 한 문장인지** — 두 기기가 동시에 눌러도 한쪽이 실패하지 않아야 한다
 * - **`SYSTEM` CHECK** — 애플리케이션이 막지만 DB 도 같은 말을 하는지(INV-U6-04)
 * - **CASCADE 파기** — 계정이 지워지면 설정도 간다
 */
@SpringBootTest
class NotificationTogglePersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var toggles: NotificationToggleService
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun rows(accountId: UUID) =
        jdbc.queryForObject("SELECT count(*) FROM notification_toggle WHERE account_id = ?", Int::class.java, accountId)

    @Test
    fun `조회는 행을 만들지 않는다 — 기본값은 저장 없이 나온다`() {
        val accountId = newAccount()

        toggles.list(accountId).size shouldBe 7

        rows(accountId) shouldBe 0
    }

    @Test
    fun `같은 종류를 여러 번 바꿔도 한 행이다 — 복합 PK 가 보장한다`() {
        val accountId = newAccount()

        toggles.update(accountId, NotificationKind.STAY, pushEnabled = false, inAppEnabled = null)
        toggles.update(accountId, NotificationKind.STAY, pushEnabled = null, inAppEnabled = false)
        toggles.update(accountId, NotificationKind.STAY, pushEnabled = true, inAppEnabled = null)

        rows(accountId) shouldBe 1
        val saved = toggles.list(accountId).single { it.kind == NotificationKind.STAY }
        saved.pushEnabled shouldBe true
        saved.inAppEnabled shouldBe false // 앞선 변경이 살아 있다 — 한쪽만 바꾸는 요청이 다른 쪽을 덮지 않았다
    }

    @Test
    fun `종류가 다르면 행이 따로 쌓인다`() {
        val accountId = newAccount()

        toggles.update(accountId, NotificationKind.STAY, pushEnabled = false, inAppEnabled = null)
        toggles.update(accountId, NotificationKind.PLAN_B, pushEnabled = true, inAppEnabled = null)

        rows(accountId) shouldBe 2
    }

    @Test
    fun `SYSTEM 행은 DB 도 거부한다(INV-U6-04)`() {
        val accountId = newAccount()

        // 애플리케이션을 우회해도 막힌다 — 그 행이 생기면 언젠가 꺼지고 보안 알림이 사라진다.
        try {
            jdbc.update(
                "INSERT INTO notification_toggle (account_id, kind, push_enabled, in_app_enabled) VALUES (?, 'SYSTEM', false, false)",
                accountId,
            )
            throw AssertionError("SYSTEM 행이 들어갔다 — CHECK 가 없다")
        } catch (e: DataIntegrityViolationException) {
            (e.message?.contains("ck_notification_toggle_not_system") ?: false) shouldBe true
        }
    }

    @Test
    fun `계정을 지우면 설정도 함께 파기된다`() {
        val accountId = newAccount()
        toggles.update(accountId, NotificationKind.STAY, pushEnabled = false, inAppEnabled = null)
        rows(accountId) shouldBe 1

        jdbc.update("DELETE FROM account WHERE account_id = ?", accountId) shouldBe 1

        rows(accountId) shouldBe 0
    }
}
