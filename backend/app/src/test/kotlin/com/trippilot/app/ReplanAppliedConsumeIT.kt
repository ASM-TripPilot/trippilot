package com.trippilot.app

import com.trippilot.app.event.OutboxRelay
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.recalculation.api.event.ItineraryRecalculated
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 재계획 적용 → 아웃박스 → planb-detection 구독자 → 트리거 CONSUMED 관통(설계서 규칙 16 · T-IT-4).
 *
 * 양 끝은 모듈 테스트가 대역으로 잠갔다. 여기서만 보이는 것은 **사이**다 — 이벤트 타입 문자열이 두 모듈에
 * 각자 리터럴로 있고, payload 키(`triggerId`·`targetDate`)가 jsonb 왕복 뒤에도 그 이름으로 읽히는지, 구독자가
 * 빈으로 잡히는지는 앱 컨텍스트에서만 드러난다. 같은 사건을 듣는 알림 구독자(리마인드 재적재)와 서로 독립으로 돈다.
 */
@SpringBootTest
class ReplanAppliedConsumeIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var events: DomainEventPublisher
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var triggers: PlanBTriggerRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T03:00:00Z")
    private val day = LocalDate.parse("2026-08-11")
    private val tripIds = mutableListOf<UUID>()

    /** 배달 못 한 행이 남으면 같은 컨테이너의 다른 IT 배치를 차지한다 — 내 여행의 사건만 지운다. */
    @AfterEach
    fun cleanUp() {
        tripIds.forEach { jdbc.update("DELETE FROM outbox_event WHERE event_type = ? AND aggregate_id = ?", TYPE, it.toString()) }
    }

    @Test
    fun `적용 사건이 릴레이를 지나 그 날짜의 트리거를 CONSUMED 로 닫는다`() {
        val tripId = newTrip()
        val t = triggers.save(activeOn(tripId, day))

        publishApplied(tripId, t.triggerId, day)
        deliver(tripId)

        published(tripId) shouldBe 1 // '배달됐다'를 센다 — 없음을 세지 않는다
        triggers.findById(t.triggerId)!!.state shouldBe TriggerState.CONSUMED
    }

    @Test
    fun `다른 날을 다시 짰으면 그 트리거는 그대로다 — 내일 트리거로 오늘을 짜도 내일 알림이 닫히지 않는다`() {
        val tripId = newTrip()
        val tomorrow = triggers.save(activeOn(tripId, day.plusDays(1)))

        publishApplied(tripId, tomorrow.triggerId, day)
        deliver(tripId)

        published(tripId) shouldBe 1
        triggers.findById(tomorrow.triggerId)!!.state shouldBe TriggerState.ACTIVE
    }

    @Test
    fun `같은 사건이 다시 배달돼도 결과가 같고 실패로 남지 않는다(at-least-once 멱등)`() {
        val tripId = newTrip()
        val t = triggers.save(activeOn(tripId, day))
        publishApplied(tripId, t.triggerId, day)
        deliver(tripId)

        jdbc.update("UPDATE outbox_event SET published_at = NULL WHERE event_type = ? AND aggregate_id = ?", TYPE, tripId.toString())
        deliver(tripId)

        published(tripId) shouldBe 1
        jdbc.queryForObject(
            "SELECT attempts FROM outbox_event WHERE event_type = ? AND aggregate_id = ?", Int::class.java, TYPE, tripId.toString(),
        ) shouldBe 0
        triggers.findById(t.triggerId)!!.state shouldBe TriggerState.CONSUMED
    }

    private fun publishApplied(tripId: UUID, triggerId: UUID, targetDate: LocalDate) =
        events.publish(ItineraryRecalculated(tripId.toString(), UUID.randomUUID().toString(), triggerId.toString(), targetDate.toString()))

    /** 같은 컨테이너의 다른 IT 가 내 행을 먼저 집어갈 수 있다 — 내 사건이 배달될 때까지 돌린다(이 리포의 관용구). */
    private fun deliver(tripId: UUID) = repeat(RELAY_TRIES) { if (count(tripId, "published_at IS NULL") > 0) relay.relay() }

    private fun published(tripId: UUID): Int = count(tripId, "published_at IS NOT NULL")

    private fun count(tripId: UUID, where: String): Int = jdbc.queryForObject(
        "SELECT count(*) FROM outbox_event WHERE event_type = ? AND aggregate_id = ? AND $where",
        Int::class.java, TYPE, tripId.toString(),
    )!!

    private fun activeOn(tripId: UUID, date: LocalDate) = PlanBTrigger.active(
        tripId, UUID.randomUUID(), TriggerKind.WEATHER, date, null, emptyMap(), TriggerScope.FULL_DAY, "비 소식이 있어요", now,
    )

    private fun newTrip(): UUID {
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value
        return trips.save(
            Trip.create(
                accountId = accountId, title = null,
                startDate = LocalDate.parse("2026-08-10"), endDate = LocalDate.parse("2026-08-12"),
                party = 2, companionType = null, budgetTotal = null,
                preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = now,
            ),
        ).tripId.also { tripIds += it }
    }

    private companion object {
        private const val TYPE = "recalculation.ItineraryRecalculated"

        /** 남의 릴레이 호출에 내 행을 빼앗겨도 결국 결과를 보게 하는 상한. */
        private const val RELAY_TRIES = 20
    }
}
