package com.trippilot.app.persistence

import com.trippilot.archive.application.VisitCheckService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.CompletionSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.core.io.ClassPathResource
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 방문 실적 완료 출처(V2.67 · M-U10-a 1단계 · TRIP-1402) 실 DB 검증.
 *
 * 대역이 원리적으로 못 보는 것:
 * - **백필** — Testcontainers 는 빈 DB 로 시작해 마이그레이션의 UPDATE 가 0행을 훑고 끝난다. 파일에서 그 문을 읽어
 *   픽스처에 직접 돌린다(사본을 베껴 쓰면 마이그레이션이 바뀌어도 테스트는 옛 모양을 지킨다)
 * - **CHECK 어휘** — enum 이름과 컬럼 CHECK 가 같은 집합인가
 * - **억제 표식뿐인 행의 제외** — 대역 저장소는 거르지 않는다. 거르는 자리가 영속 어댑터다(G-U10-12)
 */
@SpringBootTest
class VisitCheckCompletionSourceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var visits: VisitCheckService
    @Autowired private lateinit var checks: VisitCheckRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    private fun newTrip(): Pair<UUID, UUID> {
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value
        val tripId = trips.save(
            Trip.create(
                accountId = accountId, title = null,
                startDate = LocalDate.parse("2026-08-10"), endDate = LocalDate.parse("2026-08-12"),
                party = 2, companionType = null, budgetTotal = null,
                preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = now,
            ),
        ).tripId
        return accountId to tripId
    }

    private fun sourceOf(id: UUID): String? =
        jdbc.queryForObject("SELECT completion_source FROM visit_check WHERE visit_check_id = ?", String::class.java, id)

    @Test
    fun `완료하면 출처가 저장되고 그대로 읽힌다`() {
        val (accountId, tripId) = newTrip()
        val poi = UUID.randomUUID()
        val arrived = visits.arrive(accountId, tripId, "2026-08-11#$poi", poi, CheckSource.AUTO_GEOFENCE)
        sourceOf(arrived.visitCheckId) shouldBe null

        visits.complete(accountId, tripId, arrived.visitCheckId)

        sourceOf(arrived.visitCheckId) shouldBe "MANUAL"
        checks.findById(arrived.visitCheckId)!!.completionSource shouldBe CompletionSource.MANUAL
    }

    /** enum 이 CHECK 어휘와 같은 집합인가 — 하나라도 어긋나면 그 출처의 완료 저장이 500 이다. */
    @Test
    fun `완료 출처 셋이 모두 저장된다`() {
        val (_, tripId) = newTrip()
        CompletionSource.entries.forEach { by ->
            val poi = UUID.randomUUID()
            val v = checks.save(VisitCheck.arrive(tripId, "2026-08-11#$poi", poi, CheckSource.AUTO_GEOFENCE, now).complete(now.plusSeconds(600), by))
            checks.findById(v.visitCheckId)!!.completionSource shouldBe by
        }
    }

    /** 자동 되돌림이 남긴 억제 표식뿐인 행은 방문이 아니다(G-U10-12) — 목록·통계·요약이 모두 이 조회를 탄다. */
    @Test
    fun `억제 표식만 남은 행은 여행의 방문 실적에서 빠진다`() {
        val (_, tripId) = newTrip()
        val poi = UUID.randomUUID()
        val kept = checks.save(VisitCheck.arrive(tripId, "2026-08-11#${UUID.randomUUID()}", UUID.randomUUID(), CheckSource.MANUAL, now))
        val suppressed = checks.save(
            VisitCheck.reconstitute(
                UUID.randomUUID(), tripId, "2026-08-11#$poi", poi, null, null, null, CheckSource.AUTO_GEOFENCE, now, now,
                autoSuppressedAt = now,
            ),
        )

        checks.findByTrip(tripId).map { it.visitCheckId } shouldBe listOf(kept.visitCheckId)
        checks.findById(suppressed.visitCheckId)!!.autoSuppressedAt shouldBe now // 행은 남는다 — 그날 자동 쓰기를 막는 표식이다
    }

    @Test
    fun `백필은 완료된 행에만 MANUAL 을 채운다`() {
        val (_, tripId) = newTrip()
        val done = checks.save(VisitCheck.arrive(tripId, "2026-08-11#${UUID.randomUUID()}", UUID.randomUUID(), CheckSource.MANUAL, now).complete(now.plusSeconds(600)))
        val open = checks.save(VisitCheck.arrive(tripId, "2026-08-11#${UUID.randomUUID()}", UUID.randomUUID(), CheckSource.MANUAL, now))
        val auto = checks.save(
            VisitCheck.arrive(tripId, "2026-08-11#${UUID.randomUUID()}", UUID.randomUUID(), CheckSource.AUTO_GEOFENCE, now)
                .complete(now.plusSeconds(600), CompletionSource.AUTO_GEOFENCE_EXIT),
        )
        // 마이그레이션 전 모양 — 옛 코드가 쓴 완료에는 출처가 없다
        jdbc.update("UPDATE visit_check SET completion_source = NULL WHERE visit_check_id = ?", done.visitCheckId)

        jdbc.update(backfill())

        sourceOf(done.visitCheckId) shouldBe "MANUAL"
        sourceOf(open.visitCheckId) shouldBe null // 완료가 없으면 출처도 없다(INV-U10-3)
        sourceOf(auto.visitCheckId) shouldBe "AUTO_GEOFENCE_EXIT" // 이미 있는 출처를 덮지 않는다(2단계 재백필도 같은 문을 쓴다)
    }

    /** V2.67 이 실제로 싣고 있는 백필 UPDATE 문. 파일이 바뀌면 이 테스트도 함께 움직인다. */
    private fun backfill(): String {
        val sql = ClassPathResource("db/migration/V2.67__visit_check_completion_source.sql").inputStream.bufferedReader().readText()
        val start = sql.indexOf("UPDATE visit_check")
        require(start >= 0) { "V2.67 에서 백필 UPDATE 를 찾지 못했다 — 문이 바뀌었으면 이 테스트도 고친다" }
        return sql.substring(start, sql.indexOf(';', start))
    }
}
