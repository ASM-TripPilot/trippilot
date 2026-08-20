package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.itinerarygeneration.application.GenerationSessionService
import com.trippilot.itinerarygeneration.domain.GenerationMode
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
import java.util.concurrent.Callable
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * TRIP-403 — 동시 생성 제한이 **실제 경합에서** 어떻게 끝나는지.
 *
 * 단일 스레드 테스트는 이것을 원리적으로 못 본다. `guardSingleActive` 는 보고-판단하고-쓰는 순서라,
 * 두 요청이 그 사이를 함께 지나가면 둘 다 "진행 중 없음"으로 읽고 각자 INSERT 한다. 유니크 인덱스가
 * 데이터는 지켜 주지만 진 쪽이 받는 것은 **안내 없는 500** 이다 — 막으려던 것이 연타인데 정확히
 * 연타에서 응답이 무너진다.
 *
 * 그래서 계정 단위로 줄을 세운다(`lockAccount`). 이 테스트는 그 줄이 실제로 서는지 본다.
 */
@SpringBootTest
class GenerationSessionConcurrencyIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var service: GenerationSessionService
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T00:00:00Z")

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun newTrip(accountId: UUID, city: String): UUID = trips.save(
        Trip.create(
            accountId = accountId, title = null,
            startDate = LocalDate.parse("2026-08-10"), endDate = LocalDate.parse("2026-08-12"),
            party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, city, 2)), now = now,
        ),
    ).tripId

    /**
     * **둘이 동시에 눌러도 진 쪽은 409 를 받는다.**
     *
     * 역검증으로 `lockAccount` 를 비우면 이 테스트가 `DataIntegrityViolationException`(→500)으로 깨진다.
     */
    @Test
    fun `서로 다른 여행을 동시에 생성하면 한 쪽만 시작하고 다른 쪽은 안내를 받는다`() {
        val account = newAccount()
        val tripA = newTrip(account, "제주")
        val tripB = newTrip(account, "부산")
        val barrier = CyclicBarrier(2)
        val pool = Executors.newFixedThreadPool(2)

        val outcomes = try {
            pool.invokeAll(
                listOf(tripA, tripB).map { trip ->
                    Callable {
                        barrier.await(10, TimeUnit.SECONDS)
                        runCatching { service.start(account, trip, GenerationMode.FULLY_AI) }
                    }
                },
            ).map { it.get(30, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }

        outcomes.count { it.isSuccess } shouldBe 1

        // 진 쪽이 받는 것 — 500 이 아니라 "무엇을 기다려야 하는지"가 담긴 409 다.
        val rejected = outcomes.first { it.isFailure }.exceptionOrNull()
        (rejected as ConflictDetected).errorCode shouldBe ErrorCode.GENERATION_IN_PROGRESS
        rejected.current shouldBe outcomes.first { it.isSuccess }.getOrThrow().tripId

        jdbc.queryForObject(
            """
            SELECT count(*) FROM generation_session
             WHERE account_id = ? AND status IN ('RUNNING', 'DAY1_READY')
            """.trimIndent(),
            Int::class.java, account,
        )!! shouldBe 1
    }

    /** 잠금이 계정 단위라는 뜻 — 다른 계정끼리는 서로 기다리지 않고 둘 다 시작한다. */
    @Test
    fun `다른 계정은 동시에 시작할 수 있다`() {
        val pairs = listOf(newAccount(), newAccount()).map { it to newTrip(it, "제주") }
        val barrier = CyclicBarrier(2)
        val pool = Executors.newFixedThreadPool(2)

        val outcomes = try {
            pool.invokeAll(
                pairs.map { (account, trip) ->
                    Callable {
                        barrier.await(10, TimeUnit.SECONDS)
                        runCatching { service.start(account, trip, GenerationMode.FULLY_AI) }
                    }
                },
            ).map { it.get(30, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }

        outcomes.count { it.isSuccess } shouldBe 2
    }
}
