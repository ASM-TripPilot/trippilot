package com.trippilot.app

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.util.UUID

/**
 * 알림 '모두 읽음'(TRIP-829).
 *
 * ## 인메모리로는 원리적으로 못 보는 것
 *
 * 핵심이 **조건부 UPDATE 한 문장**이라 그 조건이 실제로 붙었는지는 DB 만 안다:
 *
 * - **처음 읽은 시각 보존** — `read_at IS NULL` 을 빠뜨려도 대역은 "읽음"으로 보여 통과한다.
 *   실제로는 이미 읽은 알림의 시각이 덮여 *"어제 본 알림이 방금 본 것"* 이 된다.
 * - **계정 격리** — `account_id` 조건이 빠지면 **남의 알림까지 읽음 처리**된다. 대역은 계정별로
 *   나눠 들고 있어 그 실수를 재현하지 못한다.
 *
 * ## 종류를 안 가린다
 *
 * 대상 집합이 `unreadOnly` 목록과 같아야 뱃지가 0 이 된다. SYSTEM 을 빼면 눌러도 숫자가 남아
 * 버튼이 고장난 것처럼 보인다 — 수신설정에서 SYSTEM 을 못 끄는 것과는 **다른 축**이다.
 */
@SpringBootTest
class NotificationReadAllIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var notifications: NotificationRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    /** 알림을 직접 넣는다 — 발생 경로를 타면 이 스펙이 재는 것과 무관한 규칙이 섞인다. */
    private fun insert(accountId: UUID, kind: NotificationKind, readAt: Instant? = null): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO app.notification
                   (notification_id, account_id, kind, title, body, occurred_at, read_at)
            VALUES (?, ?, ?, '제목', '본문', ?, ?)
            """.trimIndent(),
            id, accountId, kind.name,
            java.sql.Timestamp.from(now),
            readAt?.let { java.sql.Timestamp.from(it) },
        )
        return id
    }

    private fun readAtOf(id: UUID): Instant? =
        jdbc.queryForObject("SELECT read_at FROM app.notification WHERE notification_id = ?", java.sql.Timestamp::class.java, id)
            ?.toInstant()

    @Test
    fun `미읽음을 전부 읽음 처리하고 건수를 돌려준다`() {
        val me = newAccount()
        val a = insert(me, NotificationKind.TRIP_DAY)
        val b = insert(me, NotificationKind.PLAN_B)

        val updated = notifications.markAllRead(me, now)

        updated shouldBe 2
        readAtOf(a) shouldBe now
        readAtOf(b) shouldBe now
    }

    /** SYSTEM 은 수신설정에서 못 끄지만 **알림함에는 뜬다** — 빼면 뱃지가 0 이 안 된다. */
    @Test
    fun `SYSTEM 알림도 읽음 처리한다 — 종류로 거르지 않는다`() {
        val me = newAccount()
        val sys = insert(me, NotificationKind.SYSTEM)

        notifications.markAllRead(me, now)

        readAtOf(sys) shouldBe now
    }

    /**
     * **처음 읽은 시각을 덮지 않는다.** `read_at IS NULL` 조건이 빠지면 이미 읽은 알림의 시각이
     * 새 값으로 밀려 "어제 본 알림이 방금 본 것"이 된다 — 예외도 없고 목록도 멀쩡해 보인다.
     */
    @Test
    fun `이미 읽은 알림의 시각은 덮이지 않는다`() {
        val me = newAccount()
        val earlier = now.minusSeconds(86_400)
        val old = insert(me, NotificationKind.TRIP_DAY, readAt = earlier)
        val fresh = insert(me, NotificationKind.TRIP_DAY)

        val updated = notifications.markAllRead(me, now)

        updated shouldBe 1              // 이미 읽은 건은 대상이 아니다
        readAtOf(old) shouldBe earlier  // 어제 그대로
        readAtOf(fresh) shouldBe now
    }

    /** `account_id` 조건이 빠지면 **남의 알림까지** 읽음 처리된다. */
    @Test
    fun `남의 알림은 건드리지 않는다`() {
        val me = newAccount()
        val other = newAccount()
        insert(me, NotificationKind.TRIP_DAY)
        val theirs = insert(other, NotificationKind.TRIP_DAY)

        notifications.markAllRead(me, now)

        readAtOf(theirs) shouldBe null
    }

    /** 멱등 — 다시 눌러도 0건이고 실패가 아니다(화면이 붉어질 이유가 없다). */
    @Test
    fun `다시 불러도 0건이다 — 멱등하다`() {
        val me = newAccount()
        insert(me, NotificationKind.TRIP_DAY)

        notifications.markAllRead(me, now) shouldBe 1
        notifications.markAllRead(me, now.plusSeconds(60)) shouldBe 0
    }
}
