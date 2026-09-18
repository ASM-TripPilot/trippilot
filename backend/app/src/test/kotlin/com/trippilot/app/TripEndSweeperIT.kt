package com.trippilot.app

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.event.OutboxRelay
import com.trippilot.archive.application.VisitCheckService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.reflection.domain.TripSummaryRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.application.TripEndSweeper
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripEndRepository
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldNotBeBlank
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * 여행 종료 스위퍼 실 DB 검증(TRIP-554 · V2.37/V2.38).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **조건부 쓰기의 멱등** — `UPDATE … WHERE ended_at IS NULL` 이 두 번째에 0행을 낸다는 것은
 *   DB 만 안다. Map 대역은 언제나 덮어써 "두 번째는 실패한다"는 성질 자체가 없다
 * - **끝난 여행을 고르는 조건** — `end_date < today AND deleted_at IS NULL` 의 세 항이 부분 인덱스와
 *   같은 집합인가. 하나만 어긋나면 지워진 여행에도 종료가 나가거나, 끝난 여행이 영영 안 잡힌다
 * - **여행지 기준 날짜(KST)** — 러너가 UTC 라 `LocalDate.now()` 로 세우면 오늘/어제가 어긋난다.
 *   서버가 쓰는 존을 그대로 써서 여행을 세운다
 * - **종료→릴레이→요약까지의 배선** — 이벤트 타입 문자열·payload 키·구독자 등록이 전부 맞아야
 *   `trip_summary` 에 행이 생긴다. 셋 중 하나만 틀려도 단위 테스트는 전부 초록이다
 *
 * ⚠ 이 IT 는 스케줄러가 아니라 [TripEndSweeper.sweep] 을 **직접 부른다**. 배경 스위퍼는 테스트
 * 설정에서 사실상 꺼 뒀다(`trippilot.trip.end-sweep-ms`) — 켜 두면 여기서 세운 여행을 테스트가
 * 보기 전에 처리해 간헐 실패가 된다.
 */
@SpringBootTest
class TripEndSweeperIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var sweeper: TripEndSweeper
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var tripEnds: TripEndRepository
    @Autowired private lateinit var summaries: TripSummaryRepository
    @Autowired private lateinit var visits: VisitCheckService
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var mapper: ObjectMapper
    @Autowired private lateinit var clock: Clock

    /** 서버가 쓰는 존 그대로 — 러너 기본(UTC)으로 세우면 하루가 어긋난다. */
    private fun todayInTravelZone(): LocalDate = LocalDate.ofInstant(clock.instant(), ZoneId.of("Asia/Seoul"))

    private fun newAccount(): UUID = accounts.save(
        Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.now()),
    ).id.value

    private fun newTrip(accountId: UUID, endDate: LocalDate): UUID = trips.save(
        Trip.create(
            accountId = accountId, title = null,
            startDate = endDate.minusDays(2), endDate = endDate,
            party = 2, companionType = null, budgetTotal = null,
            preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", 2)), now = Instant.now(),
        ),
    ).tripId

    private fun endedAt(tripId: UUID): Instant? = jdbc.queryForObject(
        "SELECT ended_at FROM trip WHERE trip_id = ?", Instant::class.java, tripId,
    )

    /** 이 여행이 남긴 `trip.TripEnded` 행들. 전역 조회가 아니라 aggregateId 로 좁힌다. */
    private fun endedEvents(tripId: UUID): List<Map<String, Any?>> = jdbc.queryForList(
        """
        SELECT payload::text AS payload, published_at
          FROM outbox_event
         WHERE event_type = 'trip.TripEnded' AND aggregate_id = ?
        """.trimIndent(),
        tripId.toString(),
    )

    @Test
    fun `끝난 여행에 종료를 찍고 이벤트를 남긴다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId, todayInTravelZone().minusDays(1))

        sweeper.sweep()

        endedAt(tripId) shouldNotBe null
        val payload = mapper.readTree(endedEvents(tripId).single()["payload"] as String)
        payload["tripId"].asText() shouldBe tripId.toString()
        payload["endedAt"].asText().shouldNotBeBlank()
    }

    @Test
    fun `두 번 쓸어도 이벤트는 하나 — 조건부 쓰기가 곧 멱등이다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId, todayInTravelZone().minusDays(1))

        sweeper.sweep()
        val first = endedAt(tripId)
        sweeper.sweep()

        // 두 번째 UPDATE 는 0행이라 발행 자체가 없다. 시각도 처음 것이 남는다.
        endedEvents(tripId).size shouldBe 1
        endedAt(tripId) shouldBe first
    }

    /**
     * 위 테스트가 재는 것은 **조회 필터**다(두 번째 훑기에서 이미 `ended_at` 이 있어 후보에서 빠진다).
     * 조건부 쓰기 자체는 그 경로로 닿지 않는다 — 실제로 스위퍼의 `if (!markEnded)` 를 지워도 위
     * 테스트는 통과한다(역검증으로 확인했다).
     *
     * 그래서 경합을 **그대로 재현한다**: 두 인스턴스가 훑기를 먼저 끝내 둘 다 같은 여행을 손에 쥔
     * 상태. 스레드 없이 결정론적으로 만들 수 있고, UPDATE 의 `AND ended_at IS NULL` 이 빠지면
     * 여기서만 깨진다.
     */
    @Test
    fun `두 인스턴스가 같은 여행을 집어도 종료는 한 번만 찍힌다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId, todayInTravelZone().minusDays(1))
        val today = todayInTravelZone()

        // 둘 다 아직 아무도 찍지 않은 상태에서 후보를 읽었다.
        val a = tripEnds.findEndedButUnmarked(today, 200)
        val b = tripEnds.findEndedButUnmarked(today, 200)
        a.contains(tripId) shouldBe true
        b.contains(tripId) shouldBe true

        tripEnds.markEnded(tripId, Instant.now()) shouldBe true
        // 진 쪽은 false 를 받아야 한다 — true 를 받으면 이벤트가 두 번 나가고 요약도 두 번 만들어진다.
        tripEnds.markEnded(tripId, Instant.now()) shouldBe false
    }

    @Test
    fun `오늘 끝나는 여행은 아직 끝난 것이 아니다 — 여행지 기준(KST)`() {
        val accountId = newAccount()
        val today = newTrip(accountId, todayInTravelZone())

        sweeper.sweep()

        // 마지막 날 저녁에 "여행이 끝났어요" 알림이 가면 그 자체로 오답이다.
        endedAt(today) shouldBe null
        endedEvents(today) shouldBe emptyList()
    }

    @Test
    fun `지워진 여행은 집지 않는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId, todayInTravelZone().minusDays(1))
        jdbc.update("UPDATE trip SET deleted_at = now() WHERE trip_id = ?", tripId) shouldBe 1

        sweeper.sweep()

        endedAt(tripId) shouldBe null
        endedEvents(tripId) shouldBe emptyList()
    }

    @Test
    fun `종료에서 요약까지 이어진다 — 릴레이가 배달하면 요약이 생긴다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId, todayInTravelZone().minusDays(1))
        val poi = UUID.randomUUID()
        val arrived = visits.arrive(accountId, tripId, "${todayInTravelZone().minusDays(1)}#$poi", poi, CheckSource.MANUAL)
        visits.complete(accountId, tripId, arrived.visitCheckId)
        summaries.find(tripId) shouldBe null

        sweeper.sweep()
        // 배치 상한(100) 때문에 같은 컨테이너를 쓰는 다른 IT 의 미발행분이 앞에 있으면 한 번으로는 못 온다.
        repeat(3) { relay.relay() }

        val summary = summaries.find(tripId)
        summary shouldNotBe null
        // 이벤트 타입·payload 키·구독자 등록 중 하나만 틀려도 여기서 null 이 된다.
        summary!!.narrative.shouldNotBeBlank()
        summary.stats.totalVisits shouldBe 1
        endedEvents(tripId).single()["published_at"] shouldNotBe null
    }
}
