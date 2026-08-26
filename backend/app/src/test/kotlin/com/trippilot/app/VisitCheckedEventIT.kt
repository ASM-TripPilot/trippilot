package com.trippilot.app

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.event.OutboxRelay
import com.trippilot.archive.application.VisitCheckService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.error.ConflictDetected
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * `archive.VisitChecked` 적재 실 DB 검증(TRIP-541).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **트랜잭션 동거** — 방문 저장과 아웃박스 적재가 한 트랜잭션이다. 롤백하면 **둘 다 없다**.
 *   대역에는 트랜잭션이 없어 이 성질 자체가 존재하지 않는다
 * - **payload jsonb 왕복** — 이중 인코딩되면 이스케이프된 스칼라가 저장된다. jsonb 는 키 순서·공백을
 *   정규화하므로 **문자열이 아니라 값으로** 비교한다
 * - **릴레이가 실제로 집어 닫는지** — 구독자가 없으면 발행 표시만 하고 버린다(TRIP-539 설계).
 *   쌓이면 배치가 그것으로 채워져 뒤가 밀린다
 *
 * ⚠ **구독자 도달까지는 여기서 재지 않는다.** 배달 자체는 이벤트 타입과 무관한 공통 기구라
 * `OutboxRelayIT` 가 이미 검증한다. 여기에 검증용 구독자를 `@TestConfiguration` 으로 올리면
 * 스프링 컨텍스트가 하나 더 뜨고 각자 커넥션 풀을 잡아 **무관한 IT 가 기동 실패**한다(TRIP-539 실측).
 */
@SpringBootTest
class VisitCheckedEventIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var visits: VisitCheckService
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var mapper: ObjectMapper
    @Autowired private lateinit var txManager: PlatformTransactionManager

    private val tx by lazy { TransactionTemplate(txManager) }
    private val now = Instant.parse("2026-08-11T01:00:00Z")

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun newTrip(accountId: UUID): UUID = trips.save(
        Trip.create(
            accountId = accountId, title = null,
            startDate = LocalDate.parse("2026-08-10"), endDate = LocalDate.parse("2026-08-12"),
            party = 2, companionType = null, budgetTotal = null,
            preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", 2)), now = now,
        ),
    ).tripId

    /** 이 방문이 남긴 `archive.VisitChecked` 행들. 전역 조회가 아니라 aggregateId 로 좁힌다. */
    private fun rowsFor(visitCheckId: UUID): List<Map<String, Any?>> = jdbc.queryForList(
        """
        SELECT event_type, aggregate_type, payload::text AS payload, published_at
          FROM outbox_event
         WHERE event_type = 'archive.VisitChecked' AND aggregate_id = ?
        """.trimIndent(),
        visitCheckId.toString(),
    )

    @Test
    fun `방문 완료가 아웃박스에 경계 키를 실은 이벤트를 남긴다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val poi = UUID.randomUUID()
        val slot = "2026-08-11#$poi"

        val arrived = visits.arrive(accountId, tripId, slot, poi, CheckSource.AUTO_GEOFENCE)
        rowsFor(arrived.visitCheckId) shouldBe emptyList() // 도착만으로는 안 남는다
        visits.complete(accountId, tripId, arrived.visitCheckId)

        val row = rowsFor(arrived.visitCheckId).single()
        row["event_type"] shouldBe "archive.VisitChecked"
        row["aggregate_type"] shouldBe "VisitCheck"
        // 값으로 비교한다 — jsonb 는 키 순서·공백을 정규화하므로 문자열 비교는 저장 형식에 대한 거짓 단정이다.
        val payload = mapper.readTree(row["payload"] as String)
        payload["tripId"].asText() shouldBe tripId.toString()
        payload["slotKey"].asText() shouldBe slot
        payload["poiId"].asText() shouldBe poi.toString()
        payload["completedAt"].isNull shouldBe false
        // 스칼라로 이스케이프돼 들어갔으면 object 가 아니라 string 이 된다.
        jdbc.queryForObject(
            "SELECT jsonb_typeof(payload) FROM outbox_event WHERE aggregate_id = ?",
            String::class.java, arrived.visitCheckId.toString(),
        ) shouldBe "object"
    }

    @Test
    fun `트랜잭션이 롤백되면 방문도 이벤트도 남지 않는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val poi = UUID.randomUUID()
        var visitCheckId: UUID? = null

        runCatching {
            tx.execute {
                val v = visits.arrive(accountId, tripId, "2026-08-11#$poi", poi, CheckSource.MANUAL)
                visitCheckId = v.visitCheckId
                visits.complete(accountId, tripId, v.visitCheckId)
                error("의도된 롤백")
            }
        }

        // 둘 다 없다 — 그것이 트랜잭셔널 아웃박스의 전부다. 한쪽만 남으면 사실이 갈린다.
        rowsFor(visitCheckId!!) shouldBe emptyList()
        jdbc.queryForObject(
            "SELECT count(*) FROM visit_check WHERE visit_check_id = ?", Int::class.java, visitCheckId,
        ) shouldBe 0
    }

    @Test
    fun `중복 완료는 409 라 이벤트도 하나뿐이다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val poi = UUID.randomUUID()
        val arrived = visits.arrive(accountId, tripId, "2026-08-11#$poi", poi, CheckSource.MANUAL)
        visits.complete(accountId, tripId, arrived.visitCheckId)

        shouldThrow<ConflictDetected> { visits.complete(accountId, tripId, arrived.visitCheckId) }

        rowsFor(arrived.visitCheckId).size shouldBe 1
    }

    @Test
    fun `릴레이가 이 이벤트를 집어 닫는다 — 미발행으로 쌓이지 않는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val poi = UUID.randomUUID()
        val arrived = visits.arrive(accountId, tripId, "2026-08-11#$poi", poi, CheckSource.MANUAL)
        visits.complete(accountId, tripId, arrived.visitCheckId)
        rowsFor(arrived.visitCheckId).single()["published_at"] shouldBe null

        // 한 번에 집는 양이 배치 상한(100)이라, 같은 컨테이너를 쓰는 다른 IT 가 남긴 미발행 이벤트가
        // 앞에 있으면 한 번으로는 여기까지 못 온다. 전체 빌드에서만 깨지는 형태라 여유를 준다.
        repeat(3) { relay.relay() }

        // 구독자가 아직 없어 릴레이는 "닫기"로 처리한다(TRIP-539). 남겨 두면 나중에 과거가 한꺼번에 배달된다.
        (rowsFor(arrived.visitCheckId).single()["published_at"] != null) shouldBe true
    }
}
