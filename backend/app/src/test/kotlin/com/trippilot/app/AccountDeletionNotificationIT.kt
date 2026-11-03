package com.trippilot.app

import com.trippilot.app.event.OutboxRelay
import com.trippilot.auth.application.AccountDeletionService
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.notification.application.NotificationScheduleService
import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.NotificationScheduleRepository
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 계정 삭제 요청·철회가 알림을 멈추고 되살리는지 — **운영 경로 그대로**(삭제 서비스 → 이벤트 → 릴레이 → 구독자).
 *
 * 대역이 못 보는 것: (1) 계정 한 칸으로 훑는 UPDATE·DELETE 가 **발화한 행·남의 계정을 건드리지 않는가**(WHERE 절),
 * (2) 같은 이벤트 타입을 도우미 구독자도 받는데 **한 릴레이 배달에서 둘 다 도는가**(`groupBy(eventType)`).
 * 종전엔 알림 모듈에 이 구독이 없어 **탈퇴를 요청한 계정에 리마인드·푸시가 유예 내내 계속 갔다.**
 */
@SpringBootTest
class AccountDeletionNotificationIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var deletions: AccountDeletionService
    @Autowired private lateinit var scheduleService: NotificationScheduleService
    @Autowired private lateinit var schedules: NotificationScheduleRepository
    @Autowired private lateinit var tokens: PushTokenRepository
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun newTrip(accountId: UUID): UUID = trips.save(
        Trip.create(
            accountId = accountId, title = null,
            startDate = LocalDate.parse("2036-08-10"), endDate = LocalDate.parse("2036-08-12"),
            party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", 2)), now = now,
        ),
    ).tripId

    private fun newToken(accountId: UUID, invalidatedAt: Instant? = null): String {
        val value = "ExponentPushToken[${UUID.randomUUID()}]"
        tokens.register(PushToken.register(accountId, value, null, DevicePlatform.IOS, OsPermission.GRANTED, now))
        if (invalidatedAt != null) tokens.invalidate(value, invalidatedAt)
        return value
    }

    private fun tokenCount(accountId: UUID): Int =
        jdbc.queryForObject("SELECT count(*) FROM push_token WHERE account_id = ?", Int::class.java, accountId)!!

    private fun canceledCount(tripId: UUID): Int =
        jdbc.queryForObject(
            "SELECT count(*) FROM notification_schedule WHERE trip_id = ? AND canceled_at IS NOT NULL AND fired_at IS NULL",
            Int::class.java, tripId,
        )!!

    @Test
    fun `탈퇴를 요청하면 운영 경로만으로 리마인드가 멈추고 푸시 토큰이 지워진다 — 남의 계정은 그대로`() {
        val leaving = newAccount()
        val tripId = newTrip(leaving)
        scheduleService.reload(tripId)
        newToken(leaving)
        newToken(leaving, invalidatedAt = now) // 무효화된 토큰도 계정에 남지 않아야 한다
        val other = newAccount()
        val otherTrip = newTrip(other)
        scheduleService.reload(otherTrip)
        val otherToken = newToken(other)
        schedules.findPendingByTrip(tripId).size shouldBe 4
        tokenCount(leaving) shouldBe 2

        deletions.requestDeletion(AccountId(leaving))
        repeat(3) { relay.relay() } // 배치 상한 대비 — 다른 IT 의 미발행분이 앞에 있을 수 있다

        schedules.findPendingByTrip(tripId).shouldBeEmpty()
        canceledCount(tripId) shouldBe 4 // 지운 게 아니라 취소 표시다 — 지난 사실과 구분된다
        tokenCount(leaving) shouldBe 0
        // 남의 계정
        schedules.findPendingByTrip(otherTrip).size shouldBe 4
        tokens.findActive(other).map { it.token } shouldBe listOf(otherToken)
    }

    @Test
    fun `이미 발화한 예약은 취소 표시를 받지 않는다 — 조건부 쓰기`() {
        val leaving = newAccount()
        val tripId = newTrip(leaving)
        scheduleService.reload(tripId)
        val fired = schedules.findPendingByTrip(tripId).first()
        schedules.markFired(fired.scheduleId, now) shouldBe true

        val canceled = schedules.cancelPendingOf(leaving, now)

        canceled shouldBe 3
        val row = jdbc.queryForMap(
            "SELECT fired_at IS NOT NULL AS fired, canceled_at IS NOT NULL AS canceled FROM notification_schedule WHERE schedule_id = ?",
            fired.scheduleId,
        )
        row["fired"] shouldBe true
        row["canceled"] shouldBe false
        // 두 번째 호출은 할 일이 없다(at-least-once 재배달).
        schedules.cancelPendingOf(leaving, now) shouldBe 0
    }

    @Test
    fun `철회하면 취소했던 리마인드가 되살아난다 — 예정된 여행 알림이 말없이 사라지지 않는다`() {
        val leaving = newAccount()
        val tripId = newTrip(leaving)
        scheduleService.reload(tripId)
        val before = schedules.findPendingByTrip(tripId).map { it.fireAt }

        deletions.requestDeletion(AccountId(leaving))
        repeat(3) { relay.relay() }
        schedules.findPendingByTrip(tripId).shouldBeEmpty()

        deletions.cancelDeletion(AccountId(leaving))
        repeat(3) { relay.relay() }

        // 같은 시각으로 같은 수 — 취소 표시가 붙은 옛 행은 남고(이력), 새 미발화분이 선다.
        schedules.findPendingByTrip(tripId).map { it.fireAt } shouldBe before
        canceledCount(tripId) shouldBe 4
    }
}
