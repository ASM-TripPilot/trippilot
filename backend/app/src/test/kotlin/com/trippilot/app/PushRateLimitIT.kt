package com.trippilot.app

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * 발송량 상한 조회의 실 DB 검증(COST-U6-01 · V2.46).
 *
 * 여기서만 드러나는 것 — 인메모리 대역은 **원리적으로** 못 본다:
 * - **`FILTER` 집계가 실제로 두 창을 가르는가** — 대역은 코틀린 `count {}` 라 SQL 문법이 검증되지 않는다
 * - **`push_sent_at IS NOT NULL` 부분 조건** — 푸시가 안 나간 행(생략·실패)이 상한에 섞이면
 *   한 번 실패한 계정이 그 뒤로 계속 막힌다
 * - **계정 스코프** — 남의 발송이 내 상한을 깎으면 안 된다
 */
@SpringBootTest
class PushRateLimitIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var notifications: NotificationRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now: Instant = Instant.parse("2026-09-14T12:00:00Z")

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    /** 알림 행을 직접 넣는다 — 발송 경로 전체를 태우지 않고 조회만 검증한다. */
    private fun insert(accountId: UUID, pushSentAt: Instant?, occurredAt: Instant = now) {
        jdbc.update(
            """
            INSERT INTO notification (notification_id, account_id, kind, title, body, occurred_at, push_sent_at)
            VALUES (?, ?, 'SYSTEM', '제목', '본문', ?, ?)
            """.trimIndent(),
            UUID.randomUUID(), accountId,
            java.sql.Timestamp.from(occurredAt),
            pushSentAt?.let { java.sql.Timestamp.from(it) },
        )
    }

    private fun counts(accountId: UUID) =
        notifications.countPushed(accountId, now.minus(1, ChronoUnit.HOURS), now.minus(1, ChronoUnit.DAYS))

    @Test
    fun `시간 창과 일 창이 각각 세어진다`() {
        val acc = newAccount()
        insert(acc, pushSentAt = now.minus(10, ChronoUnit.MINUTES)) // 두 창 모두
        insert(acc, pushSentAt = now.minus(5, ChronoUnit.HOURS)) // 일 창만
        insert(acc, pushSentAt = now.minus(3, ChronoUnit.DAYS)) // 둘 다 아님

        val c = counts(acc)

        c.inHour shouldBe 1L
        c.inDay shouldBe 2L
    }

    /**
     * 푸시가 **안 나간** 행은 상한에 섞이면 안 된다. 섞이면 한 번 실패하거나 생략된 계정이
     * 그 실패 기록 때문에 이후로도 계속 막힌다 — 상한이 스스로를 물어 버린다.
     */
    @Test
    fun `발송되지 않은 알림은 상한에 세지 않는다`() {
        val acc = newAccount()
        repeat(5) { insert(acc, pushSentAt = null) }

        counts(acc).inDay shouldBe 0L
    }

    /** 남의 발송이 내 상한을 깎으면 안 된다. */
    @Test
    fun `상한은 계정 단위로 갈린다`() {
        val mine = newAccount()
        val other = newAccount()
        insert(other, pushSentAt = now.minus(1, ChronoUnit.MINUTES))

        counts(mine).inDay shouldBe 0L
    }
}
