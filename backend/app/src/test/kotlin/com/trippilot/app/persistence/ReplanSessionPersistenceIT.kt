package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import com.trippilot.recalculation.domain.ReplanStatus
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.collections.shouldContainExactly
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
 * 여기서만 드러나는 것:
 * - **Postgres 배열 왕복**(`reasons`·`directives`·`excluded_poi_ids`). 매핑을 잘못하면 조인 테이블을
 *   기대하거나 문자열로 뭉개져 저장 자체가 실패한다 — in-memory 로는 안 보인다.
 * - **"열린 상태"가 세 곳에서 같은 집합인지** — 도메인 `isOpen` · 영속 `OPEN_STATUSES` · DB 부분 유니크
 *   인덱스. 하나만 어긋나도 앱이 "없다"고 보고 INSERT 해 500 이 된다.
 * - **jsonb draft 왕복** — 확정 전 재계획안이 담기는 자리(INV-U4-05).
 */
@SpringBootTest
class ReplanSessionPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var sessions: ReplanSessionRepository
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

    private fun start(
        tripId: UUID,
        origin: ReplanOrigin = ReplanOrigin(OriginKind.GPS, 33.45, 126.56),
        reasons: List<String> = listOf("비가 와요", "다리가 아파요"),
        excluded: List<UUID> = listOf(UUID.randomUUID()),
    ) = ReplanSession.start(
        tripId, UUID.randomUUID(), null, ReplanScope.PARTIAL_SLOTS, now, origin,
        reasons, listOf("실내로 바꿔줘"), "근처 카페면 좋겠어요", excluded, now,
    )

    @Test
    fun `배열·jsonb 가 그대로 왕복한다`() {
        val tripId = newTrip()
        val excluded = listOf(UUID.randomUUID(), UUID.randomUUID())
        val saved = sessions.save(start(tripId, excluded = excluded))

        val found = sessions.findById(saved.sessionId)!!
        found.reasons shouldContainExactly listOf("비가 와요", "다리가 아파요")
        found.directives shouldContainExactly listOf("실내로 바꿔줘")
        found.excludedPoiIds shouldContainExactly excluded
        found.freeText shouldBe "근처 카페면 좋겠어요"
        found.origin.kind shouldBe OriginKind.GPS
        found.origin.lat shouldBe 33.45

        // 확정 전 재계획안은 jsonb 에만 있다(INV-U4-05)
        val drafted = sessions.save(found.solving().drafted(mapOf("days" to listOf("2026-08-11"))))
        sessions.findById(drafted.sessionId)!!.draft shouldBe mapOf("days" to listOf("2026-08-11"))
    }

    @Test
    fun `빈 배열도 왕복한다 — 기본값이 null 로 새면 도메인이 깨진다`() {
        val tripId = newTrip()
        val saved = sessions.save(start(tripId, reasons = emptyList(), excluded = emptyList()))
        val found = sessions.findById(saved.sessionId)!!
        found.reasons shouldBe emptyList()
        found.excludedPoiIds shouldBe emptyList()
    }

    @Test
    fun `열린 세션은 하나뿐 — 도메인·영속·DB 인덱스가 같은 집합이다`() {
        val tripId = newTrip()
        val collecting = sessions.save(start(tripId))
        sessions.findOpenByTrip(tripId)?.sessionId shouldBe collecting.sessionId

        // SOLVING·DRAFT 도 여전히 열려 있다 — 어느 하나라도 빠지면 아래 INSERT 가 500 이 된다
        val solving = sessions.save(collecting.solving())
        sessions.findOpenByTrip(tripId)?.sessionId shouldBe solving.sessionId
        val draft = sessions.save(solving.drafted(mapOf("a" to 1)))
        sessions.findOpenByTrip(tripId)?.sessionId shouldBe draft.sessionId

        shouldThrow<DataIntegrityViolationException> { sessions.save(start(tripId)) }
    }

    @Test
    fun `닫힌 세션은 열린 것으로 세지 않는다 — 새로 열 수 있고 이력은 남는다`() {
        val tripId = newTrip()
        val first = sessions.save(start(tripId))
        sessions.save(first.canceled(now))

        sessions.findOpenByTrip(tripId) shouldBe null
        val second = sessions.save(start(tripId))
        sessions.findOpenByTrip(tripId)?.sessionId shouldBe second.sessionId
        sessions.findById(first.sessionId)!!.status shouldBe ReplanStatus.CANCELED
    }

    @Test
    fun `좌표 없는 기준점도 저장된다 — 마지막 방문지·숙소는 서버가 유도한다`() {
        val tripId = newTrip()
        val saved = sessions.save(start(tripId, origin = ReplanOrigin(OriginKind.STAY_ANCHOR, null, null)))
        val found = sessions.findById(saved.sessionId)!!
        found.origin.kind shouldBe OriginKind.STAY_ANCHOR
        found.origin.lat shouldBe null
        found.origin.isEstimated shouldBe true
    }
}
