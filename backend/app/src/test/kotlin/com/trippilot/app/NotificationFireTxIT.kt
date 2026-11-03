package com.trippilot.app

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedPlaceView
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.notification.application.FireOutcome
import com.trippilot.notification.application.NotificationFiringService
import com.trippilot.notification.application.NotificationScheduleService
import com.trippilot.notification.domain.CopyBasis
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.notification.domain.NotificationScheduleRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 발화가 **일정 읽기 실패에 오염되지 않는가** — 실 트랜잭션으로만 보인다.
 *
 * 일정 퍼사드는 `@Transactional(readOnly = true)` 다. 발화 트랜잭션 **안**에서 읽다 던지면 거기에 합류해 그 트랜잭션이 rollback-only 가
 * 되고, `runCatching` 으로 삼켜도 커밋이 `UnexpectedRollbackException` 으로 끝난다. 푸시는 그 전에 이미 나갔으므로(`dispatch` 가 커밋 전에
 * 보낸다) 발화가 되돌아가 다음 폴링이 같은 예약을 다시 집고, 유예(10분) 동안 매분 같은 푸시가 나간다. 트랜잭션이 없는 단위 테스트
 * 대역("읽다 실패하면 상수 문구")은 이를 원리적으로 못 본다 — 대역에 트랜잭션이 없기 때문이다.
 */
@SpringBootTest
class NotificationFireTxIT : AbstractPostgresIntegrationTest() {

    /** 읽기가 **항상** 던지는 일정 퍼사드 — 실물과 같은 `@Transactional(readOnly = true)` 경계를 가진다(프록시가 있어야 합류가 재현된다). */
    open class FailingPlanFacade : ItineraryPlanFacade {
        @Transactional(readOnly = true)
        override fun findPlanSlots(accountId: UUID, tripId: UUID): List<PlannedSlotView> = emptyList()

        @Transactional(readOnly = true)
        override fun findPlannedPlaces(accountId: UUID, tripId: UUID): Map<LocalDate, List<PlannedPlaceView>> =
            error("의도된 일정 읽기 실패")
    }

    @TestConfiguration
    class FailingPlans {
        @Bean
        @Primary
        fun failingPlanFacade(): ItineraryPlanFacade = FailingPlanFacade()
    }

    @Autowired private lateinit var firing: NotificationFiringService
    @Autowired private lateinit var scheduleService: NotificationScheduleService
    @Autowired private lateinit var schedules: NotificationScheduleRepository
    @Autowired private lateinit var notifications: NotificationRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    @Test
    fun `일정 읽기가 던져도 발화는 커밋되고 상수 문구가 나간다 — 같은 예약이 다시 집히지 않는다`() {
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value
        val tripId = trips.save(
            Trip.create(
                accountId = accountId, title = null,
                startDate = LocalDate.parse("2036-08-10"), endDate = LocalDate.parse("2036-08-12"),
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = now,
            ),
        ).tripId
        scheduleService.reload(tripId)
        // 문구가 붙은 행만 발화 때 일정을 읽는다 — 하나에 문구와 지문을 붙인다.
        val target = schedules.findPendingByTrip(tripId).first { it.kind == NotificationKind.TRIP_DAY }
        schedules.attachCopy(target.scheduleId, "AI 제목", "AI 본문", CopyBasis.of(listOf("성산일출봉"))) shouldBe true
        val withCopy = schedules.findPendingByTrip(tripId).first { it.scheduleId == target.scheduleId }

        // 수정 전: 여기서 UnexpectedRollbackException(커밋 단계)이 터진다.
        firing.fire(withCopy) shouldBe FireOutcome.FIRED

        // 커밋됐다 — 발화 표시와 알림함 행이 남고, 문구는 검증 못 했으니 상수다(AI 제목이 나가면 안 된다).
        jdbc.queryForObject("SELECT fired_at IS NOT NULL FROM notification_schedule WHERE schedule_id = ?", Boolean::class.java, target.scheduleId) shouldBe true
        val inbox = notifications.findByAccount(accountId, unreadOnly = false, limit = 10)
        inbox.size shouldBe 1
        inbox.single().title shouldBe "오늘의 일정"
        // 같은 예약이 다시 집힐 수 없다.
        firing.fire(withCopy) shouldBe FireOutcome.ALREADY_TAKEN
    }
}
