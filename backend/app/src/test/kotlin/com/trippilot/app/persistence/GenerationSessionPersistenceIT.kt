package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationSession
import com.trippilot.itinerarygeneration.domain.GenerationSessionRepository
import com.trippilot.itinerarygeneration.domain.GenerationStatus
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
 * TRIP-312 — generation_session 실 DB 검증(V2.22).
 *
 * 여기서만 드러나는 것:
 * - **"진행 중"이 세 곳에서 같은 집합인지** — 도메인 `isRunning` · 영속 `RUNNING_STATUSES` · DB 부분 유니크
 *   인덱스. 하나만 어긋나면 앱이 "없다"고 보고 INSERT 해 사용자에게 500 이 나간다(재계획 세션에서 실제로 겪었다).
 * - **한 트랜잭션 안의 "이전 세션 닫기 → 새 세션 INSERT" 순서** — UPDATE 가 커밋까지 밀리면 INSERT 가 먼저 나가
 *   부분 유니크에 걸린다. `saveAndFlush` 로 막고 있는지는 실 DB 에서만 확인된다.
 * - **`chk_generation_session_finished`** — 끝난 세션에 끝난 시각이 있다는 것.
 */
@SpringBootTest
class GenerationSessionPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var sessions: GenerationSessionRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository

    private val now = Instant.parse("2026-08-11T00:00:00Z")

    /** 세션이 계정을 들고 있어(V2.27) FK 를 만족하려면 여행을 만든 그 계정을 알아야 한다. */
    private lateinit var lastAccountId: UUID

    private fun newTrip(): UUID = trips.save(
        Trip.create(
            accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
                .id.value.also { lastAccountId = it },
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
    fun `세션이 그대로 왕복한다 - day1 전에는 일정 id 가 없다`() {
        val tripId = newTrip()
        val saved = sessions.save(GenerationSession.start(lastAccountId, tripId, GenerationMode.CO_PLAN, now))

        val found = sessions.findById(saved.sessionId)!!
        found.tripId shouldBe tripId
        found.itineraryId shouldBe null
        found.mode shouldBe GenerationMode.CO_PLAN
        found.status shouldBe GenerationStatus.RUNNING
        found.startedAt shouldBe now

        val itineraryId = UUID.randomUUID()
        sessions.save(found.day1Ready(itineraryId, isFallback = true, candidatesLevel = "LOW", at = now))
        val afterDay1 = sessions.findById(saved.sessionId)!!
        afterDay1.itineraryId shouldBe itineraryId
        afterDay1.isFallback shouldBe true
        afterDay1.candidatesLevel shouldBe "LOW"
    }

    @Test
    fun `진행 중 세션은 하나뿐 - 도메인·영속·DB 인덱스가 같은 집합이다`() {
        val tripId = newTrip()
        val running = sessions.save(GenerationSession.start(lastAccountId, tripId, GenerationMode.FULLY_AI, now))
        sessions.findRunningByTrip(tripId)?.sessionId shouldBe running.sessionId

        // DAY1_READY 도 여전히 진행 중이다 — 빠지면 아래 INSERT 가 500 이 된다
        val day1 = sessions.save(running.day1Ready(UUID.randomUUID(), false, null, now))
        sessions.findRunningByTrip(tripId)?.sessionId shouldBe day1.sessionId

        shouldThrow<DataIntegrityViolationException> {
            sessions.save(GenerationSession.start(lastAccountId, tripId, GenerationMode.FULLY_AI, now))
        }
    }

    @Test
    fun `끝난 세션은 진행 중으로 세지 않는다 - 재생성할 수 있고 이력은 남는다`() {
        val tripId = newTrip()
        val first = sessions.save(GenerationSession.start(lastAccountId, tripId, GenerationMode.FULLY_AI, now))
        sessions.save(first.completed(isFallback = false, candidatesLevel = null, at = now))

        sessions.findRunningByTrip(tripId) shouldBe null
        val second = sessions.save(GenerationSession.start(lastAccountId, tripId, GenerationMode.FULLY_AI, now))
        sessions.findRunningByTrip(tripId)?.sessionId shouldBe second.sessionId
        sessions.findById(first.sessionId)!!.status shouldBe GenerationStatus.COMPLETED
    }

    /**
     * 재생성 흐름 그대로 — "이전 세션 닫기 → 새 세션 열기". UPDATE 가 INSERT 뒤로 밀리면 여기서 터진다.
     */
    @Test
    fun `이전 세션을 닫고 곧바로 새로 열 수 있다 - 쓰기 순서가 뒤집히지 않는다`() {
        val tripId = newTrip()
        val previous = sessions.save(GenerationSession.start(lastAccountId, tripId, GenerationMode.FULLY_AI, now))

        sessions.save(previous.canceled(now))
        val fresh = sessions.save(GenerationSession.start(lastAccountId, tripId, GenerationMode.CO_PLAN, now))

        sessions.findRunningByTrip(tripId)?.sessionId shouldBe fresh.sessionId
        sessions.findById(previous.sessionId)!!.status shouldBe GenerationStatus.CANCELED
    }
    /**
     * **계정당 진행 중 세션은 DB 가 하나로 강제한다**(TRIP-403).
     *
     * 앱 가드(`GenerationSessionService.start`)만으로는 동시 요청 둘이 읽고-검사-쓰기 사이를 함께
     * 통과할 수 있다. 이 규칙이 막으려는 것이 **연타**라 그 자리에서 뚫리면 규칙이 없는 것과 같다.
     * 여행 단위 제약(V2.22)과 같은 방식이라 여기서도 실물로 확인한다.
     */
    @Test
    fun `같은 계정에 진행 중 세션이 둘이면 DB 가 막는다`() {
        val tripA = newTrip()
        val account = lastAccountId
        val tripB = trips.save(
            Trip.create(
                accountId = account, title = null,
                startDate = LocalDate.parse("2026-09-10"), endDate = LocalDate.parse("2026-09-12"),
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "부산", 2)), now = now,
            ),
        ).tripId
        sessions.save(GenerationSession.start(account, tripA, GenerationMode.FULLY_AI, now))

        shouldThrow<DataIntegrityViolationException> {
            sessions.save(GenerationSession.start(account, tripB, GenerationMode.FULLY_AI, now))
        }
    }

    /**
     * **닫고 여는 순서가 실물에서 통과한다**(TRIP-403).
     *
     * 만료된 세션을 닫고 다른 여행으로 새로 시작하는 경로는 한 트랜잭션에서 UPDATE→INSERT 를 잇는다.
     * JPA 가 UPDATE 를 커밋까지 미루면 INSERT 가 먼저 나가 계정 유니크에 걸린다 — 어댑터가
     * `saveAndFlush` 를 쓰는 이유가 그것이고, **Fake 는 유니크를 강제하지 않아 이 순서를 못 본다.**
     */
    @Test
    fun `만료 세션을 닫으면 다른 여행으로 새로 시작할 수 있다`() {
        val tripA = newTrip()
        val account = lastAccountId
        val stale = sessions.save(GenerationSession.start(account, tripA, GenerationMode.FULLY_AI, now))
        val tripB = trips.save(
            Trip.create(
                accountId = account, title = null,
                startDate = LocalDate.parse("2026-09-10"), endDate = LocalDate.parse("2026-09-12"),
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "부산", 2)), now = now,
            ),
        ).tripId

        sessions.save(stale.failed(now))
        val fresh = sessions.save(GenerationSession.start(account, tripB, GenerationMode.FULLY_AI, now))

        sessions.findRunningByAccount(account)?.sessionId shouldBe fresh.sessionId
    }

    /** 다른 계정끼리는 서로를 막지 않는다 — 제한 단위가 계정이라는 뜻이 그것이다. */
    @Test
    fun `다른 계정의 진행 중 세션은 서로 막지 않는다`() {
        val tripA = newTrip()
        val accountA = lastAccountId
        val tripB = newTrip()
        val accountB = lastAccountId
        sessions.save(GenerationSession.start(accountA, tripA, GenerationMode.FULLY_AI, now))

        sessions.save(GenerationSession.start(accountB, tripB, GenerationMode.FULLY_AI, now))
            .accountId shouldBe accountB
    }

}
