package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanInitiator
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
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
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
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var transactions: PlatformTransactionManager

    private val now = Instant.parse("2026-08-11T00:00:00Z")

    /** 열린 세션 조회는 행 잠금이라 트랜잭션 안에서만 돈다 — 쓰는 쪽(시작·선계산)도 늘 트랜잭션 안이다. */
    private fun openOf(tripId: UUID): ReplanSession? =
        TransactionTemplate(transactions).execute { sessions.findOpenByTripForUpdate(tripId) }

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
        tripId, UUID.randomUUID(), null, ReplanScope.PARTIAL_SLOTS,
        LocalDate.ofInstant(now, ZoneId.of("Asia/Seoul")), now, origin,
        reasons, listOf("실내로 바꿔줘"), "근처 카페면 좋겠어요", excluded, now,
    )

    @Test
    fun `배열·jsonb 가 그대로 왕복한다`() {
        val tripId = newTrip()
        val excluded = listOf(UUID.randomUUID(), UUID.randomUUID())
        val saved = sessions.save(start(tripId, excluded = excluded))

        val found = sessions.findById(saved.sessionId)!!
        found.targetDate shouldBe LocalDate.ofInstant(now, ZoneId.of("Asia/Seoul"))
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
        openOf(tripId)?.sessionId shouldBe collecting.sessionId

        // SOLVING·DRAFT 도 여전히 열려 있다 — 어느 하나라도 빠지면 아래 INSERT 가 500 이 된다
        val solving = sessions.save(collecting.solving())
        openOf(tripId)?.sessionId shouldBe solving.sessionId
        val draft = sessions.save(solving.drafted(mapOf("a" to 1)))
        openOf(tripId)?.sessionId shouldBe draft.sessionId

        shouldThrow<DataIntegrityViolationException> { sessions.save(start(tripId)) }
    }

    @Test
    fun `닫힌 세션은 열린 것으로 세지 않는다 — 새로 열 수 있고 이력은 남는다`() {
        val tripId = newTrip()
        val first = sessions.save(start(tripId))
        sessions.save(first.canceled(now))

        openOf(tripId) shouldBe null
        val second = sessions.save(start(tripId))
        openOf(tripId)?.sessionId shouldBe second.sessionId
        sessions.findById(first.sessionId)!!.status shouldBe ReplanStatus.CANCELED
    }

    // ── 선계산(SYSTEM) — situation-awareness BR-SA-18 ─────────────────────────

    private fun system(tripId: UUID, triggerId: UUID, date: LocalDate, at: Instant) = ReplanSession.start(
        tripId, UUID.randomUUID(), triggerId, ReplanScope.FULL_DAY, date, at,
        ReplanOrigin(OriginKind.STAY_ANCHOR, null, null), listOf("WEATHER"), listOf("AVOID_OUTDOOR"), null, emptyList(), at,
        initiatedBy = ReplanInitiator.SYSTEM,
    )

    @Test
    fun `시작 주체가 왕복한다 — 선계산은 SYSTEM, 말하지 않으면 USER`() {
        val tripId = newTrip()
        val user = sessions.save(start(tripId))
        sessions.findById(user.sessionId)!!.initiatedBy shouldBe ReplanInitiator.USER
        sessions.save(user.canceled(now))

        val sys = sessions.save(system(tripId, UUID.randomUUID(), LocalDate.parse("2026-08-12"), now))
        sessions.findById(sys.sessionId)!!.initiatedBy shouldBe ReplanInitiator.SYSTEM
    }

    @Test
    fun `열을 모르는 옛 파드의 INSERT 는 USER 가 된다 — 상수 기본값(롤링 배포 창)`() {
        val tripId = newTrip()
        val id = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO replan_session (session_id, trip_id, itinerary_id, scope, target_date, from_instant, origin_kind,
              status, created_at, closed_at)
            VALUES (?, ?, ?, 'FULL_DAY', DATE '2026-08-11', now(), 'STAY_ANCHOR', 'CANCELED', now(), now())
            """.trimIndent(),
            id, tripId, UUID.randomUUID(),
        )
        sessions.findById(id)!!.initiatedBy shouldBe ReplanInitiator.USER
    }

    @Test
    fun `근거 트리거 없는 SYSTEM 행은 DB 가 막는다 — 도메인 규칙과 같은 CHECK`() {
        val tripId = newTrip()
        val failure = shouldThrow<DataIntegrityViolationException> {
            jdbc.update(
                """
                INSERT INTO replan_session (session_id, trip_id, itinerary_id, trigger_id, scope, target_date, from_instant,
                  origin_kind, status, created_at, initiated_by)
                VALUES (?, ?, ?, NULL, 'FULL_DAY', DATE '2026-08-11', now(), 'STAY_ANCHOR', 'COLLECTING', now(), 'SYSTEM')
                """.trimIndent(),
                UUID.randomUUID(), tripId, UUID.randomUUID(),
            )
        }
        failure.message!!.contains("chk_replan_session_system_trigger") shouldBe true
    }

    @Test
    fun `트리거당 선계산은 하나다 — 재배달 멱등의 마지막 방어선, 사용자 세션은 같은 트리거로 여러 번 연다`() {
        val tripId = newTrip()
        val triggerId = UUID.randomUUID()
        val first = sessions.save(system(tripId, triggerId, LocalDate.parse("2026-08-12"), now))
        sessions.save(first.canceled(now)) // 닫혀도 트리거당 1개는 그대로다

        val dup = shouldThrow<DataIntegrityViolationException> {
            sessions.save(system(tripId, triggerId, LocalDate.parse("2026-08-12"), now))
        }
        dup.message!!.contains("ux_replan_session_system_trigger") shouldBe true

        // 사용자 진입은 알림을 다시 탭할 때마다 같은 트리거로 열린다 — 막으면 두 번째 탭이 500 이다.
        val user = sessions.save(start(tripId).copy(triggerId = triggerId))
        sessions.save(user.canceled(now))
        sessions.save(start(tripId).copy(triggerId = triggerId)).triggerId shouldBe triggerId
    }

    @Test
    fun `선계산 조회 — 트리거로 · 날짜의 가장 최근 것(닫힌 것 포함) · 하루 상한 집계`() {
        val tripId = newTrip()
        val other = newTrip()
        val base = Instant.parse("2039-03-17T00:00:00Z") // 다른 IT 가 쓰지 않는 시각 — 전체 집계가 남의 행을 세지 않게
        val day = LocalDate.parse("2039-03-17")
        val t1 = UUID.randomUUID()
        val t2 = UUID.randomUUID()

        // 사용자 세션(닫힘) — 같은 여행·같은 창이지만 선계산 집계에 들지 않는다
        sessions.save(start(tripId).copy(createdAt = base.plusSeconds(30)).canceled(base.plusSeconds(30)))
        val older = sessions.save(system(tripId, t1, day, base))
        sessions.save(older.canceled(base.plusSeconds(60)))
        val newer = sessions.save(system(tripId, t2, day, base.plusSeconds(60)))
        sessions.save(system(other, UUID.randomUUID(), day, base.plusSeconds(120)))

        sessions.findSystemByTrigger(t1)!!.sessionId shouldBe older.sessionId
        sessions.findSystemByTrigger(UUID.randomUUID()) shouldBe null
        sessions.findLatestSystem(tripId, day)!!.sessionId shouldBe newer.sessionId
        sessions.findLatestSystem(tripId, day.plusDays(1)) shouldBe null

        sessions.countSystemSince(tripId, base) shouldBe 2       // 사용자 세션은 세지 않는다
        sessions.countSystemSince(tripId, base.plusSeconds(1)) shouldBe 1
        sessions.countSystemSince(null, base) shouldBe 3         // 전체 — 다른 여행 포함
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
