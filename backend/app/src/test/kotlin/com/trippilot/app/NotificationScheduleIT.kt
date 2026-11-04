package com.trippilot.app

import com.trippilot.app.event.OutboxRelay
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.itinerarygeneration.api.event.ItineraryGenerated
import com.trippilot.recalculation.api.event.ItineraryRecalculated
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
import com.trippilot.trip.application.EditTripCommand
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
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
    @Autowired private lateinit var subscribers: List<OutboxSubscriber>
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var tripService: com.trippilot.trip.application.TripService
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
    /**
     * **운영 경로만으로** 비워져야 한다(TRIP-1061) — 종전 이 테스트는 삭제 뒤 reload 를 손으로 불러
     * "삭제 시 reload 를 부르는 경로가 없다"는 운영 공백을 가렸다. 지금은 서비스 삭제가 TripDeleted 를
     * 발행하고 릴레이→구독자가 비운다. reload 수동 호출이 남아 있으면 이 AC 를 증명한 것이 아니다.
     */
    @Test
    fun `여행을 삭제하면 운영 경로(이벤트-릴레이)만으로 미발화 예약이 비워진다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        scheduleService.reload(tripId)
        schedules.findPendingByTrip(tripId).size shouldBe 4

        tripService.delete(accountId, tripId)
        repeat(3) { relay.relay() } // 배치 상한 대비 — 다른 IT 의 미발행분이 앞에 있을 수 있다

        schedules.findPendingByTrip(tripId) shouldBe emptyList()
    }

    private fun editPeriod(start: String, end: String) = EditTripCommand(
        title = null, startDate = LocalDate.parse(start), endDate = LocalDate.parse(end), party = 2,
        companionType = null, budgetTotal = null, destinations = listOf(TripDestination(0, "제주", 2)),
    )

    private fun periodEvents(tripId: UUID, where: String): Int = jdbc.queryForObject(
        "SELECT count(*) FROM outbox_event WHERE event_type = 'trip.TripPeriodChanged' AND aggregate_id = ? AND $where",
        Int::class.java, tripId.toString(),
    )!!

    /** 같은 컨테이너의 다른 IT 가 내 행을 먼저 집어갈 수 있다 — 내 사건이 배달될 때까지 돌린다(이 리포의 관용구). */
    private fun deliverPeriodEvent(tripId: UUID) =
        repeat(20) { if (periodEvents(tripId, "published_at IS NULL") > 0) relay.relay() }

    /**
     * 기간을 고치면 **운영 경로만으로** 예약이 새 기간으로 다시 선다(TRIP-1758) — 편집 → 아웃박스 → 릴레이 → 구독자.
     * 종전에는 편집이 이벤트를 내지 않아, 일정을 다시 짜기 전까지 예약이 옛 날짜 그대로였다(늘린 날엔 안 울리고 줄인 날엔 울렸다).
     */
    @Test
    fun `여행 기간을 고치면 운영 경로(이벤트-릴레이)만으로 예약이 새 기간으로 다시 선다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId) // 2036-08-10 ~ 08-12
        scheduleService.reload(tripId)
        schedules.findPendingByTrip(tripId).size shouldBe 4

        tripService.edit(accountId, tripId, editPeriod("2036-08-10", "2036-08-13"))
        deliverPeriodEvent(tripId)

        periodEvents(tripId, "published_at IS NOT NULL") shouldBe 1 // '배달됐다'를 센다
        val pending = schedules.findPendingByTrip(tripId)
        pending.size shouldBe 5 // 전날 1 + 4일
        pending.last().fireAt shouldBe LocalDate.parse("2036-08-13").atTime(8, 0).atZone(ZoneId.of("Asia/Seoul")).toInstant()
    }

    /**
     * 일정을 짜기 전에 기간만 고친 여행에 예약을 새로 세우면 없는 일정의 알림이 울린다 — 예약은 일정 생성·재계산 이벤트가 처음 만든다.
     * **빈 결과만으로는 "가드가 막았다"와 "사건이 배달되지 않았다"를 가를 수 없다** — 사건이 구독자에게 닿았다는 것을 먼저 센다(anti-patterns).
     */
    @Test
    fun `예약이 만들어진 적 없는 여행은 기간을 고쳐도 예약이 생기지 않는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)

        tripService.edit(accountId, tripId, editPeriod("2036-08-10", "2036-08-13"))
        deliverPeriodEvent(tripId)

        // 구독자가 있어야 '구독자 없음으로 닫힘'이 아니라 '구독자가 받고 가드가 막음'이다. 던졌다면 행이 미발행으로 남아 여기서 먼저 깨진다.
        subscribers.map { it.eventType } shouldContain "trip.TripPeriodChanged"
        periodEvents(tripId, "published_at IS NOT NULL") shouldBe 1
        schedules.findPendingByTrip(tripId) shouldBe emptyList()
    }

    /** 존재 판정 SQL — 대역은 "상태 무관·여행 한정"을 흉내낼 뿐이라 실 DB 에서 한 번 본다. 미발화 조건이 붙으면 발화를 마친 여행이 '예약 없음'으로 읽혀 기간을 늘려도 새 날의 알림이 안 선다. */
    @Test
    fun `예약 존재 판정은 발화·취소한 행도 센다 — 다른 여행의 행은 세지 않는다`() {
        val accountId = newAccount()
        val used = newTrip(accountId)
        val untouched = newTrip(accountId)
        val fired = NotificationSchedule.pending(accountId, used, NotificationKind.TRIP_DAY, now.plusSeconds(3600))
        val canceled = NotificationSchedule.pending(accountId, used, NotificationKind.TRIP_DAY, now.plusSeconds(7200))
        schedules.replacePending(used, listOf(fired, canceled))
        schedules.markFired(fired.scheduleId, now) shouldBe true
        schedules.markCanceled(canceled.scheduleId, now) shouldBe true

        schedules.findPendingByTrip(used) shouldBe emptyList() // 미발화 행이 하나도 없다
        schedules.existsForTrip(used) shouldBe true // 그래도 '적재된 적 있음'
        schedules.existsForTrip(untouched) shouldBe false // 남의 여행 행이 있어도 이 여행은 아니다
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
    /**
     * 문구 컬럼의 실 DB 왕복(V2.47 · TRIP-836).
     *
     * 대역이 **원리적으로** 못 보는 것: 컬럼 폭(제목 60·본문 200)과 **NULL 이 기본**이라는 성질.
     * 대역은 Map 이라 무엇이든 담기고, 넘치는 문자열도 그대로 들어간다 — 실 DB 에서만 거절된다.
     */
    @Test
    fun `문구를 담은 예약이 실 DB 를 왕복하고, 안 담은 것은 NULL 로 남는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val withCopy = NotificationSchedule.pending(
            accountId, tripId, NotificationKind.TRIP_PRE, now.plusSeconds(3600),
        ).copy(title = "AI 제목", body = "AI 본문")
        val without = NotificationSchedule.pending(
            accountId, tripId, NotificationKind.TRIP_DAY, now.plusSeconds(7200),
        )

        schedules.replacePending(tripId, listOf(withCopy, without))

        val rows = schedules.findPendingByTrip(tripId).associateBy { it.kind }
        rows[NotificationKind.TRIP_PRE]!!.title shouldBe "AI 제목"
        rows[NotificationKind.TRIP_PRE]!!.body shouldBe "AI 본문"
        // **안 담은 것은 빈 문자열이 아니라 NULL 이어야 한다** — "못 받았다"와 "빈 문구를 받았다"가
        // 값으로 구분돼야 발화가 상수 문구로 갈지 정할 수 있다.
        rows[NotificationKind.TRIP_DAY]!!.title shouldBe null
        jdbc.queryForObject(
            "SELECT title IS NULL AND body IS NULL FROM notification_schedule WHERE schedule_id = ?",
            Boolean::class.java, without.scheduleId,
        ) shouldBe true
    }

    /**
     * **재계획도 예약을 다시 세운다**(INV-U6-08 의 "U4 재계획" 절반).
     *
     * 이 구독이 없던 동안 `recalculation.ItineraryRecalculated` 는 발행되기만 하고 아무도 듣지 않아,
     * 여행 중 하루가 통째로 바뀌어도 리마인드는 **옛 일정 그대로** 울렸다. 생성 경로가 멀쩡히 도는
     * 탓에 "알림은 온다"로 보여 더 안 드러나던 공백이다.
     */
    @Test
    fun `재계획 반영이 릴레이를 지나 리마인드 예약을 다시 세운다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        tx.execute {
            publisher.publish(ItineraryGenerated(UUID.randomUUID().toString(), tripId.toString(), isFallback = false))
        }
        relay.relay()
        // 재적재가 실제로 일어났는지 보려면 기존 예약을 지워 두고 되살아나는지를 본다 —
        // 값이 같으면 "원래 있던 것"과 구분되지 않는다.
        schedules.replacePending(tripId, emptyList())
        schedules.findPendingByTrip(tripId).shouldBeEmpty()

        tx.execute {
            publisher.publish(ItineraryRecalculated(tripId.toString(), UUID.randomUUID().toString()))
        }
        relay.relay()

        schedules.findPendingByTrip(tripId).map { it.kind } shouldContainExactly listOf(
            NotificationKind.TRIP_PRE, NotificationKind.TRIP_DAY, NotificationKind.TRIP_DAY, NotificationKind.TRIP_DAY,
        )
    }
    /**
     * **문구가 적재에서 발화까지 관통하는가**(TRIP-836).
     *
     * 저장 왕복과 발화 문구를 따로만 보면, **폴러가 읽는 질의에 컬럼이 빠져도** 둘 다 통과한다 —
     * `findDue` 는 별도 SQL 이라 `findPendingByTrip` 이 맞아도 여기만 조용히 null 이 될 수 있다.
     * 그러면 "저장은 됐는데 알림은 늘 상수 문구"가 되고, 아무 데서도 안 드러난다.
     */
    @Test
    fun `문구와 함께 적재한 지문이 발화가 읽는 조회로도 나온다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val due = NotificationSchedule.pending(accountId, tripId, NotificationKind.TRIP_DAY, now.minusSeconds(60))
            .copy(title = "AI 제목", body = "AI 본문", copyBasis = "0123456789abcdef")
        val legacy = NotificationSchedule.pending(accountId, tripId, NotificationKind.TRIP_DAY, now.minusSeconds(30))
            .copy(title = "옛 문구", body = "옛 본문")      // 지문 칸이 생기기 전에 붙은 문구 — NULL 이어야 한다
        schedules.replacePending(tripId, listOf(due, legacy))

        val picked = schedules.findDue(now, 500).associateBy { it.scheduleId }

        picked.getValue(due.scheduleId).copyBasis shouldBe "0123456789abcdef"
        picked.getValue(legacy.scheduleId).copyBasis shouldBe null
    }

    @Test
    fun `적재한 문구가 폴러를 지나 알림 제목이 된다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val due = NotificationSchedule.pending(
            accountId, tripId, NotificationKind.TRIP_DAY, now.minusSeconds(60),
        ).copy(title = "오늘은 성산일출봉", body = "해 뜨는 시간에 맞춰 가 보세요.")
        schedules.replacePending(tripId, listOf(due))

        // 발화기가 쓰는 조회 경로로 집는다(findPendingByTrip 이 아니라).
        val picked = schedules.findDue(now, 500).single { it.scheduleId == due.scheduleId }

        picked.toNotification(now).title shouldBe "오늘은 성산일출봉"
        picked.toNotification(now).body shouldBe "해 뜨는 시간에 맞춰 가 보세요."
    }

    /**
     * 재시작으로 사라진 문구 채움 대기열을 되살리는 입력 질의의 SQL — 대역은 같은 조건을 **흉내**낼 뿐이라, 실 DB 에서
     * (1) 시각 범위 (from, until], (2) 제목·본문 둘 중 하나라도 비면 문구 없음, (3) 발화·취소된 행 제외를 한 번 본다.
     * 같은 컨테이너를 공유하는 다른 테스트의 행이 섞이므로 **이 테스트의 여행**만 포함·제외로 단정한다.
     */
    @Test
    fun `문구 없는 미발화 예약이 범위 안에 있는 여행만 찾는다 — 문구가 붙으면 빠진다`() {
        val accountId = newAccount()
        val lacking = newTrip(accountId)
        val filled = newTrip(accountId)
        val half = newTrip(accountId)
        scheduleService.reload(lacking)
        scheduleService.reload(filled)
        scheduleService.reload(half)
        val from = Instant.parse("2036-08-01T00:00:00Z")
        val until = Instant.parse("2036-08-31T00:00:00Z")

        // 모든 행에 문구를 붙이면 그 여행은 빠진다. 한 행이라도 비면 남는다(여행은 한 번만 나온다).
        schedules.findPendingByTrip(filled).forEach { schedules.attachCopy(it.scheduleId, "제목", "본문", "basis") }
        schedules.findPendingByTrip(half).first().let { schedules.attachCopy(it.scheduleId, "제목", "본문", "basis") }

        val found = schedules.findTripsLackingCopy(from, until, 1000)
        (lacking in found) shouldBe true
        (filled in found) shouldBe false
        (half in found) shouldBe true          // 네 행 중 한 행(TRIP_PRE)만 채웠다
        found.count { it == lacking } shouldBe 1

        // 범위 (from, until] — 경계 밖은 안 나온다.
        (lacking in schedules.findTripsLackingCopy(Instant.parse("2037-01-01T00:00:00Z"), Instant.parse("2037-02-01T00:00:00Z"), 1000)) shouldBe false
        (lacking in schedules.findTripsLackingCopy(from, Instant.parse("2036-08-08T00:00:00Z"), 1000)) shouldBe false

        // 발화·취소된 행은 대상이 아니다.
        schedules.findPendingByTrip(lacking).forEachIndexed { i, row ->
            if (i % 2 == 0) schedules.markFired(row.scheduleId, now) else schedules.markCanceled(row.scheduleId, now)
        }
        (lacking in schedules.findTripsLackingCopy(from, until, 1000)) shouldBe false
    }

    /**
     * **같은 여행의 적재가 겹쳐도 미발화 예약이 두 벌이 되지 않는다.** 릴레이와 문구 재시도 폴러가 한 여행을
     * 동시에 적재하면(스케줄 풀 > 1) 뒤엣것의 DELETE 가 앞엣것이 막 넣은 행을 못 보고 자기 행을 더 넣는다 —
     * 미발화분 유일 제약이 없어 DB 가 못 막고, 사용자는 같은 날 리마인드를 두 번 받는다. 앞 트랜잭션이 커밋 전에
     * 머무는 동안 뒤 트랜잭션이 들어오게 해 경합을 결정적으로 만든다(잠금을 빼면 8행이 된다).
     */
    @Test
    fun `같은 여행의 적재가 겹쳐도 미발화 예약은 한 벌이다 — 여행 단위 잠금`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        fun rows() = listOf(NotificationKind.TRIP_PRE, NotificationKind.TRIP_DAY, NotificationKind.TRIP_DAY, NotificationKind.TRIP_DAY)
            .mapIndexed { i, kind -> NotificationSchedule.pending(accountId, tripId, kind, Instant.parse("2036-08-09T23:00:00Z").plusSeconds(86_400L * i)) }
        fun load(holdMs: Long) = tx.executeWithoutResult {
            schedules.lockTrip(tripId)
            schedules.replacePending(tripId, rows())
            Thread.sleep(holdMs) // 커밋 전에 머문다 — 이 사이에 다른 적재가 들어온다
        }
        val first = Thread { load(holdMs = 800) }.apply { start() }
        Thread.sleep(200)
        val second = Thread { load(holdMs = 0) }.apply { start() }
        first.join(10_000); second.join(10_000)

        schedules.findPendingByTrip(tripId).size shouldBe 4
    }

    /**
     * **제자리 채우기 쓰기(`attachCopy`)의 조건이 SQL 에서 지켜지는가.** 대역으로는 못 본다 — WHERE 절이 느슨하면
     * 먼저 붙은 문구를 덮거나, 이미 발화한 행을 고치거나, 그 사이 재적재가 새로 만든 행에 옛 문구를 붙인다.
     * "문구 없음"의 기준은 도메인(`hasCopy` — 제목·본문 둘 다 비어 있지 않음)과 같아서, 한쪽만 있던 행은 채운다.
     */
    @Test
    fun `제자리 채우기는 문구 없는 미발화 행에만 붙는다 — 이미 붙은 문구·발화한 행·없는 행은 건드리지 않는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        fun row(kind: NotificationKind, plusSec: Long) = NotificationSchedule.pending(accountId, tripId, kind, now.plusSeconds(plusSec))
        val lacking = row(NotificationKind.TRIP_DAY, 3600)
        val halfFilled = row(NotificationKind.TRIP_DAY, 7200).copy(title = "제목만", body = null)
        val filled = row(NotificationKind.TRIP_PRE, 10800).copy(title = "먼저 붙은 제목", body = "먼저 붙은 본문")
        val fired = row(NotificationKind.TRIP_DAY, 14400)
        schedules.replacePending(tripId, listOf(lacking, halfFilled, filled, fired))
        schedules.markFired(fired.scheduleId, now) shouldBe true

        schedules.attachCopy(lacking.scheduleId, "새 제목", "새 본문", "basis-1") shouldBe true
        schedules.attachCopy(halfFilled.scheduleId, "새 제목2", "새 본문2", "basis-2") shouldBe true   // 한쪽만 있던 행도 채운다
        schedules.attachCopy(filled.scheduleId, "덮는 제목", "덮는 본문", "basis-x") shouldBe false       // 먼저 붙은 문구가 이긴다
        schedules.attachCopy(fired.scheduleId, "x", "y", "b") shouldBe false                       // 이미 발화한 행
        schedules.attachCopy(UUID.randomUUID(), "x", "y", "b") shouldBe false                      // 없는 행(그 사이 재적재가 지웠다)

        val rows = schedules.findPendingByTrip(tripId).associateBy { it.scheduleId }
        rows.getValue(lacking.scheduleId).let { it.title to it.body } shouldBe ("새 제목" to "새 본문")
        rows.getValue(halfFilled.scheduleId).let { it.title to it.body } shouldBe ("새 제목2" to "새 본문2")
        rows.getValue(filled.scheduleId).let { it.title to it.body } shouldBe ("먼저 붙은 제목" to "먼저 붙은 본문")
        // **문구와 함께 붙은 지문이 왕복한다**(V2.90) — 발화가 읽는 `findDue` 경로로도 나와야 대조가 된다.
        rows.getValue(lacking.scheduleId).copyBasis shouldBe "basis-1"
        rows.getValue(halfFilled.scheduleId).copyBasis shouldBe "basis-2"
        rows.getValue(filled.scheduleId).copyBasis shouldBe null              // 덮이지 않았으니 지문도 그대로(없음)
        // 발화한 행은 문구가 안 붙은 채 남는다 — 이미 나간 알림을 고치지 않는다.
        jdbc.queryForObject(
            "SELECT title IS NULL AND body IS NULL FROM notification_schedule WHERE schedule_id = ?",
            Boolean::class.java, fired.scheduleId,
        ) shouldBe true
    }
}
