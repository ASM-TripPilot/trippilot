package com.trippilot.app

import com.trippilot.archive.application.AutoVisitEvent
import com.trippilot.archive.application.AutoVisitKind
import com.trippilot.archive.application.AutoVisitOutcome
import com.trippilot.archive.application.AutoVisitService
import com.trippilot.archive.application.VisitCheckService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.CompletionSource
import com.trippilot.auth.application.LocationConsentService
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
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
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 자동 방문 결과(U10 · TRIP-1403) 실 DB 검증 — 대역이 못 보는 것:
 * - **항목마다 트랜잭션** — 실 JPA·실 트랜잭션에서 한 항목의 거절이 다른 항목을 되돌리지 않는가
 * - **실 일정의 슬롯 키**로 "일정에 있는 슬롯인가"를 가르는가
 * - **되돌림 → 억제 표식 → 수동 재사용**이 실 저장소의 부분 유니크 인덱스(`(trip_id, slot_key)`)를 어기지 않는가
 * - 도착·완료마다 아웃박스에 `VisitChecked`, 되돌리면 `VisitAutoReverted`
 */
@SpringBootTest
class AutoVisitIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var auto: AutoVisitService
    @Autowired private lateinit var visits: VisitCheckService
    @Autowired private lateinit var itineraries: ItineraryRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var consents: LocationConsentService
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var checks: com.trippilot.archive.domain.VisitCheckRepository
    @Autowired private lateinit var txManager: org.springframework.transaction.PlatformTransactionManager

    private val zone = ZoneId.of("Asia/Seoul")
    // 사건은 그날(서울) 00:01 부터 최대 20분 뒤(00:21)까지 — 서버는 지금 + 5분보다 미래를 거절한다(BR-U10-21). 그날을 "오늘"로 두면
    // 자정 직후(지금 < 00:16)엔 마지막 사건이 지금 + 5분을 넘어 OUT_OF_WINDOW 로 깨진다(TRIP-1472). 한 시간 전의 날짜로 두면 01시
    // 이후엔 오늘, 그 전엔 어제라 사건이 언제나 지금보다 앞선다.
    private val day = LocalDate.ofInstant(Instant.now().minusSeconds(3_600), zone)
    private val early = day.atStartOfDay(zone).toInstant().plusSeconds(60)

    private fun seed(): Triple<UUID, UUID, List<UUID>> {
        val past = Instant.now().minusSeconds(86_400)
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, past)).id.value
        val tripId = trips.save(
            Trip.create(
                accountId = accountId, title = null, startDate = day.minusDays(1), endDate = day.plusDays(1),
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = past,
            ),
        ).tripId
        val pois = List(2) { UUID.randomUUID() }
        itineraries.save(
            Itinerary.create(
                tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
                days = listOf(ItineraryDay.of(day, 0, pois.mapIndexed { i, p -> VisitSlot.of(p, null, i, LocalTime.of(10 + i, 0), LocalTime.of(11 + i, 0)) })),
                now = past,
            ),
        )
        consents.update(AccountId(accountId), legalConsent = true, gpsRecordingOptIn = null)
        return Triple(accountId, tripId, pois)
    }

    private fun outbox(type: String, aggregateId: UUID): Int = jdbc.queryForObject(
        "SELECT count(*) FROM outbox_event WHERE event_type = ? AND aggregate_id = ?", Int::class.java, type, aggregateId.toString(),
    )!!

    @Test
    fun `한 항목의 거절이 다른 항목을 되돌리지 않고, 도착·완료마다 사건이 쌓인다`() {
        val (accountId, tripId, pois) = seed()
        val slot = "$day#${pois[0]}"
        val result = auto.apply(
            accountId, tripId,
            listOf(
                AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, slot, pois[0], early),
                AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, "$day#${UUID.randomUUID()}", UUID.randomUUID(), early), // 일정에 없다
                AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.COMPLETE, slot, pois[0], early.plusSeconds(1200), CompletionSource.AUTO_GEOFENCE_EXIT),
            ),
        )

        result.results.map { it.outcome } shouldBe listOf(AutoVisitOutcome.APPLIED, AutoVisitOutcome.CONFLICT, AutoVisitOutcome.APPLIED)
        val stored = result.results.last().visitCheck!!
        jdbc.queryForObject(
            "SELECT completion_source FROM visit_check WHERE visit_check_id = ?", String::class.java, stored.visitCheckId,
        ) shouldBe "AUTO_GEOFENCE_EXIT"
        outbox("archive.VisitChecked", stored.visitCheckId) shouldBe 2
    }

    /** 같은 슬롯에 두 배치가 동시에 오면 둘 다 "없다"를 보고 넣으려 한다 — 하나는 유니크에 걸린다. 그 항목만 서버 값으로 끝나야 한다(500 아님). */
    @Test
    fun `같은 슬롯 도착이 동시에 와도 하나만 들어가고 다른 쪽은 이미 기록됨으로 끝난다`() {
        repeat(5) {
            val (accountId, tripId, pois) = seed()
            val slot = "$day#${pois[0]}"
            val start = java.util.concurrent.CountDownLatch(1)
            val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
            val runs = List(2) {
                pool.submit<AutoVisitOutcome> {
                    start.await()
                    auto.apply(accountId, tripId, listOf(AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, slot, pois[0], early))).results.single().outcome
                }
            }
            start.countDown()
            val outcomes = runs.map { it.get(20, java.util.concurrent.TimeUnit.SECONDS) }
            pool.shutdown()
            outcomes.sorted() shouldBe listOf(AutoVisitOutcome.APPLIED, AutoVisitOutcome.ALREADY_RECORDED)
            jdbc.queryForObject("SELECT count(*) FROM visit_check WHERE trip_id = ?", Int::class.java, tripId) shouldBe 1
        }
    }

    /** 자동 완료가 읽고 저장하는 사이 다른 쓰기가 끼면 낡은 사본으로 덮는다 — 슬롯 행을 잡고 읽어 그 쓰기를 기다리게 한다. */
    @Test
    fun `자동 결과는 슬롯 행을 잡은 다른 트랜잭션이 끝날 때까지 기다린다`() {
        val (accountId, tripId, pois) = seed()
        val slot = "$day#${pois[0]}"
        auto.apply(accountId, tripId, listOf(AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, slot, pois[0], early)))
        val tx = org.springframework.transaction.support.TransactionTemplate(txManager)
        val holding = java.util.concurrent.CountDownLatch(1)
        val finish = java.util.concurrent.CountDownLatch(1)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val holder = pool.submit<Unit> {
                tx.executeWithoutResult {
                    checks.findBySlotForUpdate(tripId, slot)
                    holding.countDown()
                    finish.await(10, java.util.concurrent.TimeUnit.SECONDS)
                }
            }
            holding.await(10, java.util.concurrent.TimeUnit.SECONDS) shouldBe true
            val completing = pool.submit<com.trippilot.archive.application.AutoVisitBatchResult> {
                auto.apply(accountId, tripId, listOf(AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.COMPLETE, slot, pois[0], early.plusSeconds(900), CompletionSource.AUTO_GEOFENCE_EXIT)))
            }
            Thread.sleep(500)
            completing.isDone shouldBe false
            finish.countDown()
            holder.get(10, java.util.concurrent.TimeUnit.SECONDS)
            completing.get(10, java.util.concurrent.TimeUnit.SECONDS).results.single().outcome shouldBe AutoVisitOutcome.APPLIED
        } finally {
            finish.countDown()
            pool.shutdown()
        }
    }

    /**
     * 쓰기 응답의 `updatedAt` 을 그대로 돌려보내 되돌리기를 이어 할 수 있어야 한다 — 응답은 시계 값(Linux 는 나노초), DB 는 마이크로초로
     * 반올림해 저장한다. 정확 비교면 정상 요청이 늘 409 다(macOS 는 시계가 마이크로초라 로컬에선 안 드러난다).
     */
    @Test
    fun `쓰기 응답의 갱신 시각을 그대로 보내 되돌리기를 이어 할 수 있다`() {
        val (accountId, tripId, pois) = seed()
        val slot = "$day#${pois[0]}"
        val completed = auto.apply(
            accountId, tripId,
            listOf(
                AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, slot, pois[0], early),
                AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.COMPLETE, slot, pois[0], early.plusSeconds(900), CompletionSource.AUTO_GEOFENCE_EXIT),
            ),
        ).results.last().visitCheck!!

        val first = auto.revert(accountId, tripId, completed.visitCheckId, expectedUpdatedAt = completed.updatedAt)
        val second = auto.revert(accountId, tripId, completed.visitCheckId, expectedUpdatedAt = first.updatedAt)
        (second.arrivedAt to (second.autoSuppressedAt != null)) shouldBe (null to true)
    }

    @Test
    fun `되돌린 자리를 수동 도착이 같은 행으로 쓰고, 그날 자동 기록은 막힌다`() {
        val (accountId, tripId, pois) = seed()
        val slot = "$day#${pois[1]}"
        val arrived = auto.apply(accountId, tripId, listOf(AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, slot, pois[1], early)))
            .results.single().visitCheck!!

        auto.revert(accountId, tripId, arrived.visitCheckId).arrivedAt shouldBe null
        outbox("archive.VisitAutoReverted", arrived.visitCheckId) shouldBe 1

        visits.arrive(accountId, tripId, slot, pois[1], CheckSource.MANUAL).visitCheckId shouldBe arrived.visitCheckId
        auto.apply(accountId, tripId, listOf(AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, slot, pois[1], early)))
            .results.single().outcome shouldBe AutoVisitOutcome.SUPPRESSED
        jdbc.queryForObject("SELECT count(*) FROM visit_check WHERE trip_id = ?", Int::class.java, tripId) shouldBe 1
    }
}
