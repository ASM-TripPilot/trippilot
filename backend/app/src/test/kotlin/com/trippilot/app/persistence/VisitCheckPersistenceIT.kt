package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.recalculation.domain.CheckSource
import com.trippilot.recalculation.domain.VisitCheck
import com.trippilot.recalculation.domain.VisitCheckRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * TRIP-115·118 — visit_check 실 DB 검증(V2.21).
 *
 * 여기서만 드러나는 것:
 * - **부분 유니크**(같은 슬롯 1건) — 앱이 놓쳐도 DB 가 막는다. 즉석 방문(slot_key null)은 여러 건 가능해야 한다
 * - **CHECK 두 개** — 완료는 도착 이후 · 완료와 건너뜀은 배타
 * - 체류는 **컬럼이 없다** — 파생값이라 왕복 후에도 두 시각에서 다시 계산된다
 */
@SpringBootTest
class VisitCheckPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var visits: VisitCheckRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository

    private val now = Instant.parse("2026-08-11T01:00:00Z")
    private val day = LocalDate.parse("2026-08-11")

    private fun newTrip(): UUID = trips.save(
        Trip.create(
            accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value,
            title = null,
            startDate = LocalDate.parse("2026-08-10"), endDate = LocalDate.parse("2026-08-12"),
            party = 2, companionType = null, budgetTotal = null,
            preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", 2)), now = now,
        ),
    ).tripId

    @Test
    fun `같은 슬롯은 한 건뿐 · 즉석 방문은 여러 건 가능`() {
        val tripId = newTrip()
        val poi = UUID.randomUUID()
        val slot = "$day#$poi"
        visits.save(VisitCheck.arrive(tripId, slot, poi, CheckSource.AUTO_GEOFENCE, now))

        shouldThrow<DataIntegrityViolationException> {
            visits.save(VisitCheck.arrive(tripId, slot, poi, CheckSource.AUTO_GEOFENCE, now))
        }

        // 계획에 없던 곳은 슬롯 키가 없어 제한을 받지 않는다
        visits.save(VisitCheck.arrive(tripId, null, UUID.randomUUID(), CheckSource.MANUAL, now))
        visits.save(VisitCheck.arrive(tripId, null, UUID.randomUUID(), CheckSource.MANUAL, now))
        visits.findByTrip(tripId).count { it.isSpontaneous } shouldBe 2
    }

    @Test
    fun `완료는 도착 이후여야 한다 — DB 도 같은 규칙`() {
        val tripId = newTrip()
        val poi = UUID.randomUUID()
        val arrived = visits.save(VisitCheck.arrive(tripId, "$day#$poi", poi, CheckSource.MANUAL, now))
        // 도메인을 우회해 뒤집힌 값을 만들어도 CHECK 가 잡는다
        shouldThrow<DataIntegrityViolationException> {
            visits.save(arrived.copy(completedAt = now.minusSeconds(60)))
        }
    }

    @Test
    fun `완료와 건너뜀은 동시에 참일 수 없다 — 갔나 안 갔나가 갈린다`() {
        val tripId = newTrip()
        val poi = UUID.randomUUID()
        val arrived = visits.save(VisitCheck.arrive(tripId, "$day#$poi", poi, CheckSource.MANUAL, now))
        shouldThrow<DataIntegrityViolationException> {
            visits.save(arrived.copy(completedAt = now.plusSeconds(600), skippedAt = now.plusSeconds(600)))
        }
    }

    @Test
    fun `체류는 저장되지 않고 두 시각에서 파생된다`() {
        val tripId = newTrip()
        val poi = UUID.randomUUID()
        val done = visits.save(
            VisitCheck.arrive(tripId, "$day#$poi", poi, CheckSource.MANUAL, now)
                .complete(now.plusSeconds(90 * 60)),
        )
        visits.findById(done.visitCheckId)!!.dwellMinutes shouldBe 90
    }
}
