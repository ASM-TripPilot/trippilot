package com.trippilot.app

import com.trippilot.app.event.OutboxRelay
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.event.ItineraryGenerated
import com.trippilot.notification.application.FireOutcome
import com.trippilot.notification.application.NotificationFiringService
import com.trippilot.notification.application.NotificationScheduleService
import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationAction
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.NotificationScheduleRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 알림 적재·리마인드 예약 실 DB 검증(TRIP-547 · V2.31·V2.32).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **`source_event_id` UNIQUE**(INV-U6-01) — 같은 아웃박스 이벤트가 두 번 배달돼도 알림은 하나.
 *   앱 선검사가 아니라 `ON CONFLICT` 가 판정하는지
 * - **`action_payload` jsonb 왕복** — 이중 인코딩되면 이스케이프된 스칼라가 저장된다.
 *   jsonb 는 키 순서·공백을 정규화하므로 **문자열이 아니라 값으로** 비교한다
 * - **부분 인덱스 대상 조회** — `fired_at IS NULL AND canceled_at IS NULL` 로 좁히는 경로
 * - **미발화분만 갈아끼우기** — DELETE 조건이 넓으면 이미 보낸 알림을 다시 예약한다
 * - **일정 생성 → 릴레이 → 예약 적재 관통** — 구독자가 실제로 릴레이에 잡히는지
 */
@SpringBootTest
class NotificationScheduleIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var notifications: NotificationRepository
    @Autowired private lateinit var schedules: NotificationScheduleRepository
    @Autowired private lateinit var firing: NotificationFiringService
    @Autowired private lateinit var scheduleService: NotificationScheduleService
    @Autowired private lateinit var publisher: DomainEventPublisher
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var txManager: PlatformTransactionManager

    private val tx by lazy { TransactionTemplate(txManager) }
    private val now = Instant.parse("2026-08-11T01:00:00Z")

    /**
     * 이 예약이 아직 폴링에 잡히는가. [NotificationScheduleRepository.findDue] 는 전역 조회라
     * 같은 컨테이너를 공유하는 다른 테스트의 행이 섞인다 — 실제 어댑터 질의를 쓰되 이 건으로 좁힌다.
     */
    private fun NotificationScheduleRepository.isDue(schedule: NotificationSchedule): Boolean =
        findDue(Instant.now(), 500).any { it.scheduleId == schedule.scheduleId }

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun newTrip(accountId: UUID, start: String = "2036-08-10", end: String = "2036-08-12"): UUID = trips.save(
        Trip.create(
            accountId = accountId,
            title = null,
            startDate = LocalDate.parse(start), endDate = LocalDate.parse(end),
            party = 2, companionType = null, budgetTotal = null,
            preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", 2)), now = now,
        ),
    ).tripId

    @Test
    fun `같은 아웃박스 이벤트로는 알림이 하나뿐이다 — DB UNIQUE 가 판정한다`() {
        val accountId = newAccount()
        val eventId = UUID.randomUUID()
        fun raise() = Notification.raise(
            accountId = accountId,
            kind = NotificationKind.PLAN_B,
            title = "비 예보 — 일정이 영향받아요",
            body = "대안 일정을 확인해 보세요.",
            occurredAt = now,
            actionType = NotificationAction.TRIP_ITINERARY,
            actionPayload = mapOf("tripId" to UUID.randomUUID().toString(), "slotKey" to "2036-08-10#x"),
            sourceEventId = eventId,
        )

        notifications.appendIfAbsent(raise()) shouldBe true
        // 릴레이는 at-least-once 다 — 배달 후 발행 표시 전에 죽으면 같은 이벤트가 다시 온다.
        notifications.appendIfAbsent(raise()) shouldBe false

        notifications.findByAccount(accountId, unreadOnly = false, limit = 10).size shouldBe 1
    }

    @Test
    fun `원천 사건이 없는 알림은 UNIQUE 에 걸리지 않는다 — null 은 서로 다르다`() {
        val accountId = newAccount()
        repeat(2) {
            notifications.appendIfAbsent(
                Notification.raise(accountId, NotificationKind.TRIP_DAY, "오늘의 일정", "확인해 보세요.", now),
            ) shouldBe true
        }
        notifications.findByAccount(accountId, unreadOnly = false, limit = 10).size shouldBe 2
    }

    @Test
    fun `action_payload 가 jsonb 로 왕복한다 — 이중 인코딩되면 여기서 깨진다`() {
        val accountId = newAccount()
        val payload = mapOf("tripId" to UUID.randomUUID().toString(), "note" to "따옴표\"와 한글")
        notifications.appendIfAbsent(
            Notification.raise(
                accountId, NotificationKind.PLAN_B, "제목", "본문", now,
                actionType = NotificationAction.TRIP_ITINERARY, actionPayload = payload,
                sourceEventId = UUID.randomUUID(),
            ),
        ) shouldBe true

        // 값으로 비교한다 — jsonb 는 키 순서·공백을 정규화하므로 문자열 비교는 저장 형식에 대한 거짓 단정이 된다.
        notifications.findByAccount(accountId, unreadOnly = false, limit = 1).single().actionPayload shouldBe payload
        // 스칼라로 이스케이프돼 들어갔으면 object 가 아니라 string 이 된다.
        jdbc.queryForObject(
            "SELECT jsonb_typeof(action_payload) FROM notification WHERE account_id = ?", String::class.java, accountId,
        ) shouldBe "object"
    }

    @Test
    fun `읽음 표시는 조건부 UPDATE 다 — 두 번째 호출이 처음 시각을 덮지 않는다`() {
        val accountId = newAccount()
        notifications.appendIfAbsent(Notification.raise(accountId, NotificationKind.SYSTEM, "제목", "본문", now))
        val id = notifications.findByAccount(accountId, unreadOnly = false, limit = 1).single().notificationId

        val first = Instant.parse("2026-08-11T02:00:00Z")
        notifications.markRead(accountId, id, first) shouldBe true
        notifications.markRead(accountId, id, Instant.parse("2026-08-11T03:00:00Z")) shouldBe false
        notifications.markRead(UUID.randomUUID(), id, first) shouldBe false // 남의 것

        notifications.findByAccount(accountId, unreadOnly = true, limit = 10) shouldBe emptyList()
        notifications.findByAccount(accountId, unreadOnly = false, limit = 10).single().readAt shouldBe first
    }

    @Test
    fun `재적재는 미발화분만 갈아끼운다 — 이미 발화한 예약은 남는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val fired = NotificationSchedule.pending(accountId, tripId, NotificationKind.TRIP_DAY, now.plusSeconds(3600))
        val pending = NotificationSchedule.pending(accountId, tripId, NotificationKind.TRIP_DAY, now.plusSeconds(7200))
        schedules.replacePending(tripId, listOf(fired, pending))
        schedules.markFired(fired.scheduleId, now) shouldBe true

        val replacement = NotificationSchedule.pending(accountId, tripId, NotificationKind.TRIP_PRE, now.plusSeconds(10800))
        schedules.replacePending(tripId, listOf(replacement))

        // 미발화였던 것만 사라지고 새것이 들어온다.
        schedules.findPendingByTrip(tripId).map { it.scheduleId } shouldContainExactly listOf(replacement.scheduleId)
        // 발화한 행은 지워지지 않았다 — 지우면 같은 알림을 다시 예약하게 된다.
        jdbc.queryForObject(
            "SELECT count(*) FROM notification_schedule WHERE schedule_id = ?", Int::class.java, fired.scheduleId,
        ) shouldBe 1
    }

    @Test
    fun `조건부 쓰기가 발화 멱등을 만든다 — 두 인스턴스가 같은 행을 집어도 하나만 통과한다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        // 발화 판정은 **앱 컨텍스트의 Clock**(실 시스템 시계)이 한다 — 다른 준비값처럼 고정 시각을 쓰면
        // 유예를 한참 넘겨 CANCELED_LATE 가 된다(실측으로 겪었다). 도래 직후를 흉내 내려면 실제 지금을 기준으로 잡는다.
        val schedule = NotificationSchedule.pending(accountId, tripId, NotificationKind.TRIP_DAY, Instant.now().minusSeconds(60))
        schedules.replacePending(tripId, listOf(schedule))

        firing.fire(schedule) shouldBe FireOutcome.FIRED
        firing.fire(schedule) shouldBe FireOutcome.ALREADY_TAKEN

        notifications.findByAccount(accountId, unreadOnly = false, limit = 10).size shouldBe 1
        // `findDue` 는 전역 조회다 — 다른 테스트가 남긴 예약이 섞이므로 이 건으로 좁혀 본다.
        schedules.isDue(schedule) shouldBe false
    }

    @Test
    fun `유예를 넘긴 예약은 발화 대신 닫힌다(INV-U6-09)`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        // 유예 10분보다 한참 전. "한 시간 전에 시작했어야 할 일정"은 알리지 않는다.
        val stale = NotificationSchedule.pending(accountId, tripId, NotificationKind.TRIP_DAY, Instant.now().minusSeconds(3600))
        schedules.replacePending(tripId, listOf(stale))

        firing.fire(stale) shouldBe FireOutcome.CANCELED_LATE

        notifications.findByAccount(accountId, unreadOnly = false, limit = 10) shouldBe emptyList()
        // 부분 인덱스 조회에서 빠진다 — 다시 집히지 않는다.
        schedules.isDue(stale) shouldBe false
        jdbc.queryForObject(
            "SELECT canceled_at IS NOT NULL AND fired_at IS NULL FROM notification_schedule WHERE schedule_id = ?",
            Boolean::class.java, stale.scheduleId,
        ) shouldBe true
    }

    /**
     * 소프트 삭제는 행이 남으므로 FK CASCADE 가 닿지 않는다 — 예약을 비우는 것은 `deletedAt` 을 보는
     * [com.trippilot.trip.api.TripOwnerFacade] 뿐이다. 그 필터가 빠지면 지운 여행의 알림이 계속 울린다.
     */
    @Test
    fun `여행을 소프트 삭제하면 미발화 예약이 비워진다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        scheduleService.reload(tripId)
        schedules.findPendingByTrip(tripId).size shouldBe 4

        trips.save(trips.findById(tripId)!!.softDelete(Instant.now()))
        scheduleService.reload(tripId)

        schedules.findPendingByTrip(tripId) shouldBe emptyList()
    }

    @Test
    fun `일정 생성이 릴레이를 지나 리마인드 예약으로 적재된다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)

        tx.execute {
            publisher.publish(ItineraryGenerated(UUID.randomUUID().toString(), tripId.toString(), isFallback = false))
        }
        relay.relay()

        // 여행 전날 1건 + 3일치 당일 1건씩.
        val pending = schedules.findPendingByTrip(tripId)
        pending.map { it.kind } shouldContainExactly listOf(
            NotificationKind.TRIP_PRE, NotificationKind.TRIP_DAY, NotificationKind.TRIP_DAY, NotificationKind.TRIP_DAY,
        )
        pending.all { it.accountId == accountId } shouldBe true

        // 두 번 배달돼도 늘지 않는다 — reload 가 미발화분을 통째로 갈아끼우므로 멱등이다.
        val before = pending.map { it.fireAt }
        tx.execute {
            publisher.publish(ItineraryGenerated(UUID.randomUUID().toString(), tripId.toString(), isFallback = false))
        }
        relay.relay()
        schedules.findPendingByTrip(tripId).map { it.fireAt } shouldContainExactly before
    }
}
