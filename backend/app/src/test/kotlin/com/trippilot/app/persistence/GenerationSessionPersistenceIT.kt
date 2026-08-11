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
    fun `세션이 그대로 왕복한다 - day1 전에는 일정 id 가 없다`() {
        val tripId = newTrip()
        val saved = sessions.save(GenerationSession.start(tripId, GenerationMode.CO_PLAN, now))

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
        val running = sessions.save(GenerationSession.start(tripId, GenerationMode.FULLY_AI, now))
        sessions.findRunningByTrip(tripId)?.sessionId shouldBe running.sessionId

        // DAY1_READY 도 여전히 진행 중이다 — 빠지면 아래 INSERT 가 500 이 된다
        val day1 = sessions.save(running.day1Ready(UUID.randomUUID(), false, null, now))
        sessions.findRunningByTrip(tripId)?.sessionId shouldBe day1.sessionId

        shouldThrow<DataIntegrityViolationException> {
            sessions.save(GenerationSession.start(tripId, GenerationMode.FULLY_AI, now))
        }
    }

    @Test
    fun `끝난 세션은 진행 중으로 세지 않는다 - 재생성할 수 있고 이력은 남는다`() {
        val tripId = newTrip()
        val first = sessions.save(GenerationSession.start(tripId, GenerationMode.FULLY_AI, now))
        sessions.save(first.completed(isFallback = false, candidatesLevel = null, at = now))

        sessions.findRunningByTrip(tripId) shouldBe null
        val second = sessions.save(GenerationSession.start(tripId, GenerationMode.FULLY_AI, now))
        sessions.findRunningByTrip(tripId)?.sessionId shouldBe second.sessionId
        sessions.findById(first.sessionId)!!.status shouldBe GenerationStatus.COMPLETED
    }

    /**
     * 재생성 흐름 그대로 — "이전 세션 닫기 → 새 세션 열기". UPDATE 가 INSERT 뒤로 밀리면 여기서 터진다.
     */
    @Test
    fun `이전 세션을 닫고 곧바로 새로 열 수 있다 - 쓰기 순서가 뒤집히지 않는다`() {
        val tripId = newTrip()
        val previous = sessions.save(GenerationSession.start(tripId, GenerationMode.FULLY_AI, now))

        sessions.save(previous.canceled(now))
        val fresh = sessions.save(GenerationSession.start(tripId, GenerationMode.CO_PLAN, now))

        sessions.findRunningByTrip(tripId)?.sessionId shouldBe fresh.sessionId
        sessions.findById(previous.sessionId)!!.status shouldBe GenerationStatus.CANCELED
    }
}
