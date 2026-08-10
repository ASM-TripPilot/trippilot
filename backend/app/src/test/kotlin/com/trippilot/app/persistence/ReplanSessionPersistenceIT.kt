package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.planb.domain.EmptyReason
import com.trippilot.planb.domain.ReplanMode
import com.trippilot.planb.domain.ReplanReason
import com.trippilot.planb.domain.ReplanSession
import com.trippilot.planb.domain.ReplanSessionRepository
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
 * TRIP-273 — replan_session 실 DB 검증(V2.17).
 *
 * 여기서만 볼 수 있는 것: **DB 부분 유니크 인덱스(`ux_replan_session_active`)와 앱의 "진행 중" 판정이
 * 같은 집합인지.** 어긋나면 앱은 "없다"고 보고 INSERT 하는데 DB 가 막아 사용자에게 500 이 나간다.
 * API 테스트로는 안 보인다 — 거기서는 세션이 LOADING 을 벗어나지 않기 때문이다.
 */
@SpringBootTest
class ReplanSessionPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var sessions: ReplanSessionRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository

    private val now = Instant.parse("2026-08-11T00:00:00Z")

    /** replan_session → trip → account 로 FK 가 이어진다 — 실 DB 라 계정부터 만든다. */
    private fun newTrip(): UUID = trips.save(
        Trip.create(
            accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value,
            title = null,
            startDate = LocalDate.parse("2026-08-10"),
            endDate = LocalDate.parse("2026-08-12"),
            party = 2,
            companionType = null,
            budgetTotal = null,
            preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", 2)),
            now = now,
        ),
    ).tripId

    @Test
    fun `LOADING 과 PROPOSED 는 둘 다 진행 중 — 앱 판정과 DB 인덱스가 같은 집합이다`() {
        val tripId = newTrip()
        val loading = sessions.save(ReplanSession.start(tripId, ReplanReason.WEATHER, ReplanMode.AI, now))
        sessions.findActiveByTrip(tripId)?.replanSessionId shouldBe loading.replanSessionId

        // 산출이 끝나 PROPOSED 가 돼도 **여전히 진행 중**이다(사용자가 고르는 중).
        val proposed = sessions.save(loading.proposed(alternativeCount = 2, emptyReason = null, at = now))
        sessions.findActiveByTrip(tripId)?.replanSessionId shouldBe proposed.replanSessionId

        // 그 상태에서 새 세션을 밀어넣으면 **DB 가 막는다** — 앱 판정이 이보다 좁으면 여기서 500 이 된다.
        shouldThrow<DataIntegrityViolationException> {
            sessions.save(ReplanSession.start(tripId, ReplanReason.FATIGUE, ReplanMode.MANUAL, now))
        }
    }

    @Test
    fun `종료된 세션은 진행 중이 아니다 — 새 세션을 열 수 있고 이력은 남는다`() {
        val tripId = newTrip()
        val first = sessions.save(ReplanSession.start(tripId, ReplanReason.WEATHER, ReplanMode.AI, now))
        sessions.save(first.canceled(now))

        sessions.findActiveByTrip(tripId) shouldBe null
        val second = sessions.save(ReplanSession.start(tripId, ReplanReason.FATIGUE, ReplanMode.MANUAL, now))
        sessions.findActiveByTrip(tripId)?.replanSessionId shouldBe second.replanSessionId
        sessions.findById(first.replanSessionId)!!.status.name shouldBe "CANCELED" // 지우지 않는다
    }

    @Test
    fun `빈 사유가 왕복한다 — 닫힌 집합이라 이름 그대로 저장된다`() {
        val tripId = newTrip()
        val s = sessions.save(ReplanSession.start(tripId, ReplanReason.NONE, ReplanMode.AI, now))
        sessions.save(s.proposed(0, EmptyReason.NOT_AVAILABLE, now))

        sessions.findById(s.replanSessionId)!!.emptyReason shouldBe EmptyReason.NOT_AVAILABLE
    }
}
