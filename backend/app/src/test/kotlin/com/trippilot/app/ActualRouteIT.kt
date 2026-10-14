package com.trippilot.app

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.event.OutboxRelay
import com.trippilot.archive.adapter.`in`.web.RouteDayResponse
import com.trippilot.archive.application.ActualRouteService
import com.trippilot.archive.application.RouteDayUpload
import com.trippilot.auth.application.LocationConsentService
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
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
import java.util.UUID

/**
 * 실제 경로(V2.69 · TRIP-1405) 실 DB 검증.
 *
 * 대역이 원리적으로 못 보는 것:
 * - **`text[]` 왕복과 upsert** — 같은 날 재업로드가 행 id 를 지키며 통째로 바뀌는가
 * - **철회 → 릴레이 → 구독자 → 파기**와 그 법정 로그(`ACTUAL_ROUTE`), 그리고 auth 가 더는 지운 것 없는 `gps_track` 를
 *   남기지 않는가(D3) — 이벤트 타입이 양쪽에 리터럴로 박혀 있어 어긋나면 릴레이가 조용히 닫는다
 * - **수집 로그 행의 모양** — 좌표가 없다(PBT-U10-4)
 */
@SpringBootTest
class ActualRouteIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var routes: ActualRouteService
    @Autowired private lateinit var consents: LocationConsentService
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var mapper: ObjectMapper

    private val past = Instant.parse("2026-08-11T01:00:00Z")
    private val day = LocalDate.parse("2026-08-11")
    /** Google 문서의 예 — 세 점. */
    private val sample = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"

    private fun newTrip(): Pair<UUID, UUID> {
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, past)).id.value
        val tripId = trips.save(
            Trip.create(
                accountId = accountId, title = null, startDate = LocalDate.parse("2026-08-10"), endDate = LocalDate.parse("2026-08-12"),
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = past,
            ),
        ).tripId
        consents.update(AccountId(accountId), legalConsent = true, gpsRecordingOptIn = true)
        return accountId to tripId
    }

    private fun legal(accountId: UUID, type: String): List<String> = jdbc.queryForList(
        "SELECT detail::text FROM location_legal_log WHERE account_id = ? AND event_type = ? ORDER BY log_id", String::class.java, accountId, type,
    )

    private fun rows(tripId: UUID): Int =
        jdbc.queryForObject("SELECT count(*) FROM actual_route_day WHERE trip_id = ?", Int::class.java, tripId)!!

    @Test
    fun `세그먼트 배열이 그대로 왕복하고, 재업로드는 같은 행을 바꾸며 저장마다 좌표 없는 수집 로그를 남긴다`() {
        val (accountId, tripId) = newTrip()
        val first = routes.store(accountId, tripId, day, RouteDayUpload(listOf(sample, sample), 2_000_000, 10, null))
        val second = routes.store(accountId, tripId, day, RouteDayUpload(listOf(sample), 1_000_000, 5, null))

        routes.list(accountId, tripId).single().let {
            it.routeDayId shouldBe first.routeDayId
            it.segments shouldBe listOf(sample)
            it.storedPointCount shouldBe 3
            it.distanceM shouldBe second.distanceM
        }
        val stores = legal(accountId, "COLLECTION").map { mapper.readTree(it) }.filter { it["source"].asText() == "ROUTE_TRACE" }
        stores.size shouldBe 2
        stores.last().fieldNames().asSequence().toSet() shouldBe setOf("source", "subjectId", "phase", "pointCount")
        (stores.last()["subjectId"].asText() to stores.last()["pointCount"].asText()) shouldBe (first.routeDayId.toString() to "3")
    }

    /** 응답에 기록 구간·소요시간·속도가 없다(INV-3 · INV-U10-7 · PBT-U10-7) — 기록 구간은 서버가 거리 상한을 재는 데만 쓴다. */
    @Test
    fun `응답 직렬형에는 날짜·세그먼트·거리·클램프 표시·갱신 시각뿐이다`() {
        val (accountId, tripId) = newTrip()
        val saved = routes.store(accountId, tripId, day, RouteDayUpload(listOf(sample), 2_000_000, 10, null, past, past.plusSeconds(86_400)))
        mapper.readTree(mapper.writeValueAsString(RouteDayResponse.from(saved))).fieldNames().asSequence().toSet() shouldBe
            setOf("date", "segments", "distanceM", "distanceClamped", "updatedAt")
    }

    /** 철회에서 출발한다 — 아웃박스 적재·릴레이 배달·구독자 배선이 전부 경로에 들어온다. */
    @Test
    fun `GPS 기록 동의를 철회하면 릴레이를 지나 경로가 지워지고 파기가 실제로 지운 쪽 이름으로 한 번 남는다`() {
        val (accountId, tripId) = newTrip()
        routes.store(accountId, tripId, day, RouteDayUpload(listOf(sample), 2_000_000, 10, null))
        routes.store(accountId, tripId, day.plusDays(1), RouteDayUpload(listOf(sample), 2_000_000, 10, null))

        consents.update(AccountId(accountId), legalConsent = null, gpsRecordingOptIn = false)
        repeat(RELAY_TRIES) { if (rows(tripId) > 0) relay.relay() }

        rows(tripId) shouldBe 0
        val purges = legal(accountId, "PURGE").map { mapper.readTree(it) }
        purges.map { it["scope"].asText() } shouldBe listOf("ACTUAL_ROUTE") // 지운 것 없는 gps_track 은 더 없다(D3), EXIF 는 지울 게 없었다
        purges.single()["purgedCount"].asText() shouldBe "2"
    }

    private companion object {
        const val RELAY_TRIES = 20
    }
}
