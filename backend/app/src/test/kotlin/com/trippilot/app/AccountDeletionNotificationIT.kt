package com.trippilot.app

import com.trippilot.app.event.OutboxRelay
import com.trippilot.auth.application.AccountDeletionService
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.event.EventEnvelope
import com.trippilot.notification.adapter.`in`.event.AccountDeletionRequestedSubscriber
import com.trippilot.notification.application.NotificationScheduleService
import com.trippilot.notification.application.PushDispatchService
import com.trippilot.notification.application.PushOutcome
import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationKind
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
 * 계정 삭제 요청·철회가 알림을 멈추고 되살리는지 — **운영 경로 그대로**(삭제 서비스 → 이벤트 → 릴레이 → 구독자 → 실 DB).
 *
 * 대역이 못 보는 것: (1) 계정 한 칸으로 훑는 UPDATE 가 **발화한 행·남의 계정을 건드리지 않는가**(WHERE 절), (2) 처리 시점의 **실제 계정 상태**(auth 서비스가
 * 쓴 `account.status`)를 구독자가 읽는가 — 뒤늦게 재배달된 요청 이벤트가 철회 뒤의 예약을 다시 지우지 않으려면 이것이 진짜여야 한다, (3) 발송 지점이
 * 유예 중인 계정에 푸시하지 않는가(토큰은 안 지운다).
 */
@SpringBootTest
class AccountDeletionNotificationIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var deletions: AccountDeletionService
    @Autowired private lateinit var scheduleService: NotificationScheduleService
    @Autowired private lateinit var schedules: NotificationScheduleRepository
    @Autowired private lateinit var tokens: PushTokenRepository
    @Autowired private lateinit var dispatch: PushDispatchService
    @Autowired private lateinit var requestedSubscriber: AccountDeletionRequestedSubscriber
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun newTrip(accountId: UUID, start: String = "2036-08-10", end: String = "2036-08-12"): UUID = trips.save(
        Trip.create(
            accountId = accountId, title = null,
            startDate = LocalDate.parse(start), endDate = LocalDate.parse(end),
            party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", 2)), now = now,
        ),
    ).tripId

    private fun newToken(accountId: UUID): String {
        val value = "ExponentPushToken[${UUID.randomUUID()}]"
        tokens.register(PushToken.register(accountId, value, null, DevicePlatform.IOS, OsPermission.GRANTED, now))
        return value
    }

    private fun canceledCount(tripId: UUID): Int =
        jdbc.queryForObject(
            "SELECT count(*) FROM notification_schedule WHERE trip_id = ? AND canceled_at IS NOT NULL AND fired_at IS NULL",
            Int::class.java, tripId,
        )!!

    private fun pushOf(accountId: UUID) =
        Notification.raise(accountId, NotificationKind.TRIP_DAY, "제목", "본문", now)

    @Test
    fun `탈퇴를 요청하면 운영 경로만으로 리마인드가 멈추고 푸시도 나가지 않는다 — 남의 계정은 그대로, 토큰은 안 지운다`() {
        val leaving = newAccount()
        val tripId = newTrip(leaving)
        scheduleService.reload(tripId)
        val token = newToken(leaving)
        val other = newAccount()
        val otherTrip = newTrip(other)
        scheduleService.reload(otherTrip)
        newToken(other)
        schedules.findPendingByTrip(tripId).size shouldBe 4
        dispatch.dispatch(pushOf(leaving)) shouldBe PushOutcome.SENT

        deletions.requestDeletion(AccountId(leaving))
        repeat(3) { relay.relay() } // 배치 상한 대비 — 다른 IT 의 미발행분이 앞에 있을 수 있다

        schedules.findPendingByTrip(tripId).shouldBeEmpty()
        canceledCount(tripId) shouldBe 4 // 지운 게 아니라 취소 표시다 — 철회 때 되살릴 근거다
        // 푸시는 어떤 종류도 나가지 않는다. 토큰은 그대로다(철회해도 앱이 다시 올리지 않을 수 있다).
        dispatch.dispatch(pushOf(leaving)) shouldBe PushOutcome.MUTED
        tokens.findActive(leaving).map { it.token } shouldBe listOf(token)
        // 남의 계정
        schedules.findPendingByTrip(otherTrip).size shouldBe 4
        dispatch.dispatch(pushOf(other)) shouldBe PushOutcome.SENT
    }

    @Test
    fun `유예 중에 도착한 일정 이벤트는 예약을 다시 세우지 않는다`() {
        val leaving = newAccount()
        val tripId = newTrip(leaving)
        scheduleService.reload(tripId)
        deletions.requestDeletion(AccountId(leaving))
        repeat(3) { relay.relay() }
        schedules.findPendingByTrip(tripId).shouldBeEmpty()

        // 요청 뒤에 도착한 일정 생성·재계산 이벤트(릴레이가 reload 를 부른다)
        scheduleService.reload(tripId)

        schedules.findPendingByTrip(tripId).shouldBeEmpty()
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
    fun `철회하면 취소했던 리마인드가 되살아나고 푸시도 다시 나간다 — 예정된 여행 알림이 말없이 사라지지 않는다`() {
        val leaving = newAccount()
        val tripId = newTrip(leaving)
        // 일정이 아직 없어 리마인드가 만들어진 적 없는 다른 여행 — 철회가 새로 예약을 만들면 안 된다.
        val noReminders = newTrip(leaving, "2036-09-10", "2036-09-12")
        scheduleService.reload(tripId)
        newToken(leaving)
        val before = schedules.findPendingByTrip(tripId).map { it.fireAt }

        deletions.requestDeletion(AccountId(leaving))
        repeat(3) { relay.relay() }
        schedules.findPendingByTrip(tripId).shouldBeEmpty()

        deletions.cancelDeletion(AccountId(leaving))
        repeat(3) { relay.relay() }

        // 같은 시각으로 같은 수 — 취소 표시가 붙은 옛 행은 남고(이력), 새 미발화분이 선다.
        schedules.findPendingByTrip(tripId).map { it.fireAt } shouldBe before
        canceledCount(tripId) shouldBe 4
        schedules.findPendingByTrip(noReminders).shouldBeEmpty()
        dispatch.dispatch(pushOf(leaving)) shouldBe PushOutcome.SENT
    }

    /**
     * **독립 리뷰가 찾은 결함의 재현.** 같은 타입의 다른 구독자(도우미 대화 파기)가 실패하면 릴레이가 요청 이벤트를 통째로 백오프 재배달한다 —
     * 그 사이 사용자가 철회했다면 뒤늦은 요청이 철회 뒤의 예약을 다시 지웠다. 구독자가 이벤트가 아니라 **지금 계정 상태**를 읽으므로 건드리지 않는다.
     */
    @Test
    fun `철회한 뒤 뒤늦게 재배달된 삭제 요청 이벤트는 복원된 예약을 다시 지우지 않는다`() {
        val leaving = newAccount()
        val tripId = newTrip(leaving)
        scheduleService.reload(tripId)
        newToken(leaving)
        val before = schedules.findPendingByTrip(tripId).map { it.fireAt }
        deletions.requestDeletion(AccountId(leaving))
        deletions.cancelDeletion(AccountId(leaving))
        repeat(3) { relay.relay() }   // 요청·철회가 모두 처리됐다 — 예약은 되살아나 있다
        schedules.findPendingByTrip(tripId).map { it.fireAt } shouldBe before

        // 요청 이벤트가 뒤늦게 다시 배달된다(도우미 구독자의 실패로 인한 재배달을 흉내 낸다).
        val stale = EventEnvelope(
            eventId = UUID.randomUUID(), eventType = "auth.AccountDeletionRequested", schemaVersion = 1, aggregateType = "Account",
            aggregateId = leaving.toString(), correlationId = null, occurredAt = now, payload = "{}",
        )
        requestedSubscriber.handle(stale)

        schedules.findPendingByTrip(tripId).map { it.fireAt } shouldBe before
        // 철회한 계정이므로 푸시도 막히지 않는다.
        dispatch.dispatch(pushOf(leaving)) shouldBe PushOutcome.SENT
    }
}
