package com.trippilot.app

import com.trippilot.archive.application.VisitCheckService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.reflection.application.StyleAnalysisService
import com.trippilot.reflection.domain.StyleAnalysis
import com.trippilot.reflection.domain.StyleOutcome
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrowAny
import io.kotest.matchers.longs.shouldBeLessThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.types.shouldBeInstanceOf
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 스타일 분석 실 DB 검증(TRIP-555 · V2.39).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **DB 임계(`CHECK sample_visit_count >= 10`)** — 앱을 우회한 INSERT 도 막는가. 도메인 `require`
 *   하나만 믿으면 나중에 배치·마이그레이션이 그 옆으로 들어온다(INV-U5-09)
 * - **jsonb 왕복** — `trait_gauges`·`category_breakdown` 이 이중 인코딩되면 object 가 아니라
 *   이스케이프된 문자열로 저장된다
 * - **계정 단위 생애주기(INV-U5-08)** — **여행이 지워져도 분석은 남고**, 계정이 지워지면 함께 간다.
 *   회고(`trip_id` FK)와 정반대 성질이라 대역으로는 확인 자체가 불가능하다
 * - **계정당 한 행** — 재분석이 덮어쓰는가. Map 대역은 언제나 덮어써 이 성질이 존재하지 않는다
 */
@SpringBootTest
class StyleAnalysisIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var styles: StyleAnalysisService
    @Autowired private lateinit var visits: VisitCheckService
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")
    private val day = LocalDate.parse("2026-08-11")

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

    /** 좌표·카테고리를 아는 POI. 표면이 있어야 막대와 반경이 생긴다. */
    private fun newPoi(category: String, index: Int): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO poi (poi_id, name_ko, lat, lng, category, data_status, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'ACTIVE', 'MANUAL', now(), now())
            """.trimIndent(),
            id, "장소$index", 33.40 + index * 0.01, 126.50 + index * 0.01, category,
        )
        return id
    }

    /** 방문 n건을 실제로 남긴다 — 도착·완료까지. 카테고리는 돌려 쓴다. */
    private fun recordVisits(accountId: UUID, tripId: UUID, n: Int, categories: List<String>) {
        repeat(n) { i ->
            val poi = newPoi(categories[i % categories.size], i)
            val arrived = visits.arrive(accountId, tripId, "$day#$poi", poi, CheckSource.MANUAL)
            visits.complete(accountId, tripId, arrived.visitCheckId)
        }
    }

    private fun rows(accountId: UUID) =
        jdbc.queryForObject("SELECT count(*) FROM style_analysis WHERE account_id = ?", Int::class.java, accountId)

    @Test
    fun `임계 미만은 저장되지 않는다 — 미리보기는 표에 남지 않는다(INV-U5-09)`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        recordVisits(accountId, tripId, 9, listOf("카페"))

        val outcome = styles.analyze(accountId)

        outcome.shouldBeInstanceOf<StyleOutcome.Preview>().preview.current shouldBe 9
        rows(accountId) shouldBe 0
    }

    @Test
    fun `10곳이면 정식 분석이 저장되고 jsonb 로 왕복한다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        recordVisits(accountId, tripId, 10, listOf("맛집", "카페", "자연", "명소", "쇼핑"))

        val a = styles.analyze(accountId).shouldBeInstanceOf<StyleOutcome.Official>().analysis

        rows(accountId) shouldBe 1
        a.sampleVisitCount shouldBe 10
        a.sampleTripCount shouldBe 1
        // 스칼라로 이스케이프돼 들어갔으면 object/array 가 아니라 string 이 된다.
        jdbc.queryForObject(
            "SELECT jsonb_typeof(trait_gauges) FROM style_analysis WHERE account_id = ?", String::class.java, accountId,
        ) shouldBe "object"
        jdbc.queryForObject(
            "SELECT jsonb_typeof(category_breakdown) FROM style_analysis WHERE account_id = ?",
            String::class.java, accountId,
        ) shouldBe "array"
        // 저장된 것은 **화면 라벨이 아니라 코드**다(O-U5-7). `미식` 이 저장되면 여기서 깨진다.
        jdbc.queryForObject(
            "SELECT category_breakdown->0->>'category' FROM style_analysis WHERE account_id = ?",
            String::class.java, accountId,
        ) shouldNotBe "미식"
        // 다시 읽어도 같은 값 — 왕복이 값을 바꾸지 않는다.
        //
        // ⚠ **통째로 비교하지 않는다.** `analyze()` 가 돌려준 것은 메모리값이라 `updatedAt` 이
        // 나노초까지 있고, 다시 읽은 것은 Postgres `timestamptz` 왕복이라 **마이크로초**다.
        // macOS 는 시계 해상도가 마이크로초라 로컬에선 늘 통과하고 **리눅스 러너에서만** 깨진다
        // (2026-08-26 CI 실측 · 이미 안티패턴 로그에 있는 항목이다).
        // 그래서 시각만 떼어 절단을 명시적으로 단정하고, 나머지 필드는 그대로 정확 비교한다.
        val reread = styles.find(accountId)!!
        reread shouldBe a.copy(updatedAt = reread.updatedAt)
        // 저장 해상도는 **마이크로초**다. `truncatedTo` 로 단정했더니 CI 가 잡았는데(실측),
        // 드라이버가 나노초를 **버리는 게 아니라 반올림**하기 때문이다 — 절단을 가정하면
        // 반올림이 올라간 경우에 1µs 어긋난다. 그래서 "1µs 미만 차이"로 묻는다.
        Duration.between(a.updatedAt, reread.updatedAt).abs().toNanos() shouldBeLessThan 1_000L
    }

    @Test
    fun `재분석은 덮어쓴다 — 계정당 한 행`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        recordVisits(accountId, tripId, 10, listOf("카페"))
        styles.analyze(accountId)

        recordVisits(accountId, tripId, 2, listOf("맛집"))
        val second = styles.analyze(accountId).shouldBeInstanceOf<StyleOutcome.Official>().analysis

        rows(accountId) shouldBe 1
        second.sampleVisitCount shouldBe 12
    }

    @Test
    fun `여행을 지워도 분석은 남는다 — 계정 단위다(INV-U5-08)`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        recordVisits(accountId, tripId, 10, listOf("카페"))
        styles.analyze(accountId)

        jdbc.update("DELETE FROM trip WHERE trip_id = ?", tripId) shouldBe 1

        // 회고(trip_id FK)와 정반대다 — 그쪽은 같은 삭제로 사라진다.
        rows(accountId) shouldBe 1
    }

    @Test
    fun `계정을 지우면 분석도 함께 파기된다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        recordVisits(accountId, tripId, 10, listOf("카페"))
        styles.analyze(accountId)
        jdbc.update("DELETE FROM trip WHERE trip_id = ?", tripId)

        jdbc.update("DELETE FROM account WHERE account_id = ?", accountId) shouldBe 1

        rows(accountId) shouldBe 0
    }

    @Test
    fun `DB 도 임계를 지킨다 — 앱을 우회한 INSERT 는 거부된다`() {
        val accountId = newAccount()

        // 도메인 require 하나만 믿으면 나중에 배치·마이그레이션이 그 옆으로 들어온다.
        shouldThrowAny {
            jdbc.update(
                """
                INSERT INTO style_analysis (account_id, descriptors, trait_gauges, category_breakdown,
                                            avg_places_per_day, avg_radius_km, sample_trip_count, sample_visit_count)
                VALUES (?, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 1.0, 1.0, 1, ?)
                """.trimIndent(),
                accountId, StyleAnalysis.MIN_VISITS - 1,
            )
        }

        rows(accountId) shouldBe 0
    }
}
