package com.trippilot.app

import com.trippilot.app.event.OutboxRelay
import com.trippilot.archive.application.ActualRouteService
import com.trippilot.archive.application.RouteDayUpload
import com.trippilot.auth.application.LocationConsentService
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.reflection.application.ReflectionService
import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Instant
import java.time.LocalDate

/**
 * 실제 경로 → 회고 거리 출처(U10 FD §7.2 · BR-U10-39 · TRIP-1406) 관통 검증.
 *
 * 이벤트 타입 문자열(`archive.ActualRouteStored`)이 발행·구독 양쪽에 리터럴로 박혀 있어, 어긋나면 릴레이가 조용히 닫고 회고는
 * 근사값에 머문다. 그래서 경로 저장에서 출발해 릴레이·구독자·실 저장소를 모두 지난다.
 */
@SpringBootTest
class RouteReflectionStatsIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var routes: ActualRouteService
    @Autowired private lateinit var reflections: ReflectionService
    @Autowired private lateinit var consents: LocationConsentService
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository

    private val past = Instant.parse("2026-08-11T01:00:00Z")
    private val day = LocalDate.parse("2026-08-11")

    @Test
    fun `경로가 저장되면 릴레이를 지나 그날 회고의 거리가 실제 경로로 바뀐다`() {
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, past)).id.value
        val tripId = trips.save(
            Trip.create(
                accountId = accountId, title = null, startDate = LocalDate.parse("2026-08-10"), endDate = LocalDate.parse("2026-08-12"),
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = past,
            ),
        ).tripId
        consents.update(AccountId(accountId), legalConsent = true, gpsRecordingOptIn = true)
        reflections.generateDaily(accountId, tripId, day).stats.distanceSource shouldBe DistanceSource.VISIT_LINE

        // Google 문서의 예 — 세 점(약 790km). 기록 구간이 없으니 상한은 하루 × 300km/h.
        routes.store(accountId, tripId, day, RouteDayUpload(listOf("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), 800_000, 10, null))
        repeat(RELAY_TRIES) {
            if (reflections.find(accountId, tripId, day)!!.stats.distanceSource != DistanceSource.ROUTE) relay.relay()
        }

        reflections.find(accountId, tripId, day)!!.stats.let { (it.distanceSource to it.distanceKm) shouldBe (DistanceSource.ROUTE to 800.0) }
    }

    private companion object {
        const val RELAY_TRIES = 20
    }
}
