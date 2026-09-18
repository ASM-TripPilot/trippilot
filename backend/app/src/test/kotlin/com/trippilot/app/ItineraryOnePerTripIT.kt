package com.trippilot.app

import com.trippilot.auth.domain.Account
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
import java.util.UUID

/**
 * 여행당 일정 1행(`uq_itinerary_trip`, V2.10 · TRIP-267).
 *
 * ## 왜 뒤늦게 쓰나
 *
 * **행위를 재는 테스트는 있었다** — `ItineraryApiIT` 의 "재생성하면 기존 일정 교체 — 여행당 1개".
 * 다만 그것은 `replaceForTrip` 이 먼저 지우고 넣는 경로라 **제약이 사라져도 통과한다.**
 * 제약 자체를 재는 테스트는 없었고, 그래서 TRIP-536 조사에서 "행이 둘이라 조회가 아무거나
 * 집는 것 아니냐"는 가설이 섰을 때 DB 가 이미 막고 있다는 사실을 코드로 보여줄 수단이 없었다.
 *
 * ⚠ 인메모리 대역으로는 **원리적으로** 못 본다 — Map 은 언제나 덮어써서 "둘이 될 수 있다"는
 * 성질 자체가 재현되지 않는다. 보장하는 주체가 DB 다.
 */
@SpringBootTest
class ItineraryOnePerTripIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var itineraries: ItineraryRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")
    private val day = LocalDate.parse("2026-08-11")

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
        ).tripId
    }

    private fun itineraryOf(tripId: UUID) = Itinerary.create(
        tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
        days = listOf(
            ItineraryDay.of(
                day, 0,
                listOf(VisitSlot.of(UUID.randomUUID(), null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0))),
            ),
        ),
        now = now,
    )

    private fun rowCount(tripId: UUID): Int =
        jdbc.queryForObject("SELECT count(*) FROM itinerary WHERE trip_id = ?", Int::class.java, tripId)!!

    @Test
    fun `여행당 1행 제약이 DB 에 실제로 있다 — 제약을 직접 묻는다`() {
        // 저장이 실패하는 것만 보면 **왜** 실패했는지 모른다(실측으로 이걸 헷갈렸다).
        val kind = jdbc.queryForObject(
            """
            SELECT contype FROM pg_constraint
             WHERE conname = 'uq_itinerary_trip'
               AND conrelid = 'app.itinerary'::regclass
            """.trimIndent(),
            String::class.java,
        )

        kind shouldBe "u"
    }

    @Test
    fun `두 번째 일정을 그냥 저장하면 DB 가 막는다 — 조용히 공존하지 않는다`() {
        val tripId = newTrip()
        itineraries.save(itineraryOf(tripId))

        val failed = runCatching { itineraries.save(itineraryOf(tripId)) }.isFailure

        // 제약이 없으면 여기서 두 행이 생기고, 조회가 어느 것을 집을지 Postgres 는 보장하지 않는다.
        failed shouldBe true
        rowCount(tripId) shouldBe 1
    }

    @Test
    fun `교체는 된다 — 지우고 넣는 것이 유니크에 걸리지 않는다`() {
        val tripId = newTrip()
        val first = itineraries.save(itineraryOf(tripId))

        val replaced = itineraries.replaceForTrip(tripId, itineraryOf(tripId))

        rowCount(tripId) shouldBe 1
        (replaced.itineraryId == first.itineraryId) shouldBe false
        itineraries.findByTrip(tripId).single().itineraryId shouldBe replaced.itineraryId
    }

    @Test
    fun `조회는 언제나 한 행이고 그것이 방금 넣은 것이다`() {
        val tripId = newTrip()
        val saved = itineraries.save(itineraryOf(tripId))

        val found = itineraries.findByTrip(tripId)

        found.size shouldBe 1
        found.single().itineraryId shouldBe saved.itineraryId
    }

    @Test
    fun `여행이 다르면 각자 하나씩 가진다 — 제약이 여행 단위다`() {
        val a = newTrip()
        val b = newTrip()

        itineraries.save(itineraryOf(a))
        itineraries.save(itineraryOf(b))

        rowCount(a) shouldBe 1
        rowCount(b) shouldBe 1
    }
}
