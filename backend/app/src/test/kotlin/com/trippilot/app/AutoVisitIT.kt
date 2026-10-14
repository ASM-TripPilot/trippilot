package com.trippilot.app

import com.trippilot.archive.application.AutoVisitEvent
import com.trippilot.archive.application.AutoVisitKind
import com.trippilot.archive.application.AutoVisitOutcome
import com.trippilot.archive.application.AutoVisitService
import com.trippilot.archive.application.VisitCheckService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.CompletionSource
import com.trippilot.auth.application.LocationConsentService
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 자동 방문 결과(U10 · TRIP-1403) 실 DB 검증 — 대역이 못 보는 것:
 * - **항목마다 트랜잭션** — 실 JPA·실 트랜잭션에서 한 항목의 거절이 다른 항목을 되돌리지 않는가
 * - **실 일정의 슬롯 키**로 "일정에 있는 슬롯인가"를 가르는가
 * - **되돌림 → 억제 표식 → 수동 재사용**이 실 저장소의 부분 유니크 인덱스(`(trip_id, slot_key)`)를 어기지 않는가
 * - 도착·완료마다 아웃박스에 `VisitChecked`, 되돌리면 `VisitAutoReverted`
 */
@SpringBootTest
class AutoVisitIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var auto: AutoVisitService
    @Autowired private lateinit var visits: VisitCheckService
    @Autowired private lateinit var itineraries: ItineraryRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var consents: LocationConsentService
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val zone = ZoneId.of("Asia/Seoul")
    private val today = LocalDate.now(zone)
    private val early = today.atStartOfDay(zone).toInstant().plusSeconds(60) // 오늘(서울) 00:01 — 지금보다 앞선다

    private fun seed(): Triple<UUID, UUID, List<UUID>> {
        val past = Instant.now().minusSeconds(86_400)
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, past)).id.value
        val tripId = trips.save(
            Trip.create(
                accountId = accountId, title = null, startDate = today.minusDays(1), endDate = today.plusDays(1),
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = past,
            ),
        ).tripId
        val pois = List(2) { UUID.randomUUID() }
        itineraries.save(
            Itinerary.create(
                tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
                days = listOf(ItineraryDay.of(today, 0, pois.mapIndexed { i, p -> VisitSlot.of(p, null, i, LocalTime.of(10 + i, 0), LocalTime.of(11 + i, 0)) })),
                now = past,
            ),
        )
        consents.update(AccountId(accountId), legalConsent = true, gpsRecordingOptIn = null)
        return Triple(accountId, tripId, pois)
    }

    private fun outbox(type: String, aggregateId: UUID): Int = jdbc.queryForObject(
        "SELECT count(*) FROM outbox_event WHERE event_type = ? AND aggregate_id = ?", Int::class.java, type, aggregateId.toString(),
    )!!

    @Test
    fun `한 항목의 거절이 다른 항목을 되돌리지 않고, 도착·완료마다 사건이 쌓인다`() {
        val (accountId, tripId, pois) = seed()
        val slot = "$today#${pois[0]}"
        val result = auto.apply(
            accountId, tripId,
            listOf(
                AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, slot, pois[0], early),
                AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, "$today#${UUID.randomUUID()}", UUID.randomUUID(), early), // 일정에 없다
                AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.COMPLETE, slot, pois[0], early.plusSeconds(1200), CompletionSource.AUTO_GEOFENCE_EXIT),
            ),
        )

        result.results.map { it.outcome } shouldBe listOf(AutoVisitOutcome.APPLIED, AutoVisitOutcome.CONFLICT, AutoVisitOutcome.APPLIED)
        val stored = result.results.last().visitCheck!!
        jdbc.queryForObject(
            "SELECT completion_source FROM visit_check WHERE visit_check_id = ?", String::class.java, stored.visitCheckId,
        ) shouldBe "AUTO_GEOFENCE_EXIT"
        outbox("archive.VisitChecked", stored.visitCheckId) shouldBe 2
    }

    @Test
    fun `되돌린 자리를 수동 도착이 같은 행으로 쓰고, 그날 자동 기록은 막힌다`() {
        val (accountId, tripId, pois) = seed()
        val slot = "$today#${pois[1]}"
        val arrived = auto.apply(accountId, tripId, listOf(AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, slot, pois[1], early)))
            .results.single().visitCheck!!

        auto.revert(accountId, tripId, arrived.visitCheckId).arrivedAt shouldBe null
        outbox("archive.VisitAutoReverted", arrived.visitCheckId) shouldBe 1

        visits.arrive(accountId, tripId, slot, pois[1], CheckSource.MANUAL).visitCheckId shouldBe arrived.visitCheckId
        auto.apply(accountId, tripId, listOf(AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, slot, pois[1], early)))
            .results.single().outcome shouldBe AutoVisitOutcome.SUPPRESSED
        jdbc.queryForObject("SELECT count(*) FROM visit_check WHERE trip_id = ?", Int::class.java, tripId) shouldBe 1
    }
}
