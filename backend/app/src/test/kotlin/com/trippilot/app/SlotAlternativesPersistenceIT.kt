package com.trippilot.app

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SlotAlternative
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
 * 차선책 jsonb 왕복(V2.48 · TRIP-873).
 *
 * ## 인메모리로는 원리적으로 못 보는 것
 *
 * 대역은 `Map` 이라 **넣은 객체가 그대로 돌아온다** — 직렬화를 한 번도 안 탄다. 실제로 갈리는 자리는
 * 셋이고 전부 DB 에서만 드러난다:
 *
 * - **컬럼이 없거나 타입이 다르면** 저장 자체가 실패한다(마이그레이션 누락·오타)
 * - **이중 인코딩** — 문자열로 선직렬화하면 jsonb 에 `"[{\\"poiId\\"...}]"` 가 들어가고,
 *   읽을 때 리스트가 아니라 문자열 한 덩어리가 온다(`unplacedMustVisits` 가 같은 함정을 밟았다)
 * - **NOT NULL DEFAULT** 가 실제로 붙었는가 — 안 붙었으면 옛 행 조회가 null 로 터진다
 *
 * ## 왜 "빈 목록"까지 따로 재나
 *
 * 차선책 없는 슬롯이 압도적으로 많다. 그 경로가 깨지면 **일정 조회 전체가 죽는데**, 차선책이 있는
 * 표본만 테스트하면 초록이다.
 */
@SpringBootTest
class SlotAlternativesPersistenceIT : AbstractPostgresIntegrationTest() {

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

    private fun save(tripId: UUID, alternatives: List<SlotAlternative>) = itineraries.save(
        Itinerary.create(
            tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
            days = listOf(
                ItineraryDay.of(
                    day, 0,
                    listOf(
                        VisitSlot.of(
                            UUID.randomUUID(), null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0),
                            alternatives = alternatives,
                        ),
                    ),
                ),
            ),
            now = now,
        ),
    )

    @Test
    fun `차선책이 저장되고 같은 값으로 돌아온다`() {
        val tripId = newTrip()
        val a = SlotAlternative(UUID.randomUUID(), "같은 카페 후보", "약 1.2km · 도보 추정")
        val b = SlotAlternative(UUID.randomUUID(), "좌표를 모르는 후보", null)

        save(tripId, listOf(a, b))

        val read = itineraries.findByTrip(tripId).single().days.single().slots.single()
        read.alternatives shouldBe listOf(a, b)
        // 거리 미상은 **null 로** 돌아와야 한다 — 빈 문자열이면 화면이 "거리 0"처럼 그린다.
        read.alternatives[1].distanceRange shouldBe null
    }

    @Test
    fun `차선책 없는 슬롯은 빈 목록으로 돌아온다 — null 이 아니다`() {
        val tripId = newTrip()

        save(tripId, emptyList())

        itineraries.findByTrip(tripId).single().days.single().slots.single().alternatives shouldBe emptyList()
    }

    /**
     * **jsonb 에 배열이 들어갔는지 DB 에 직접 묻는다.** 이중 인코딩이면 `jsonb_typeof` 가 `string` 이고,
     * 그 상태로도 애플리케이션 왕복은 통과할 수 있다(쓴 대로 읽으니까). 어긋남은 **다른 도구가 이 값을
     * 읽을 때** 드러나므로 여기서 못 박는다.
     */
    @Test
    fun `컬럼에 실제로 json 배열이 들어간다 — 문자열로 이중 인코딩되지 않는다`() {
        val tripId = newTrip()
        save(tripId, listOf(SlotAlternative(UUID.randomUUID(), "후보", null)))

        val type = jdbc.queryForObject(
            """
            SELECT jsonb_typeof(vs.alternatives)
              FROM app.visit_slot vs
              JOIN app.itinerary_day d ON d.itinerary_day_id = vs.itinerary_day_id
              JOIN app.itinerary i ON i.itinerary_id = d.itinerary_id
             WHERE i.trip_id = ?
            """.trimIndent(),
            String::class.java,
            tripId,
        )

        type shouldBe "array"
    }

    /** 컬럼 기본값이 없으면 옛 행(마이그레이션 이전 데이터) 조회가 null 로 터진다. */
    @Test
    fun `컬럼은 NOT NULL 이고 기본값이 있다`() {
        val row = jdbc.queryForMap(
            """
            SELECT is_nullable, column_default
              FROM information_schema.columns
             WHERE table_schema = 'app' AND table_name = 'visit_slot' AND column_name = 'alternatives'
            """.trimIndent(),
        )

        row["is_nullable"] shouldBe "NO"
        (row["column_default"] as String).contains("'[]'") shouldBe true
    }
}
