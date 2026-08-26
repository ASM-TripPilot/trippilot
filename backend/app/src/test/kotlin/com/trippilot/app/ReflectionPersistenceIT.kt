package com.trippilot.app

import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.reflection.application.ReflectionService
import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotBeBlank
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 회고 실 DB 검증(TRIP-552 · V2.36).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **UNIQUE `(trip_id, day_date)`** — 하루 한 장. Map 대역은 언제나 덮어써 이 성질이 존재하지 않는다
 * - **재생성이 `generated_at` 을 밀지 않는지** — 지웠다 넣으면 "언제 처음 만들어졌나"가 사라진다
 * - **`stats` jsonb 왕복** — 이중 인코딩되면 이스케이프된 스칼라가 저장된다
 * - **CASCADE 파기** — 여행이 지워지면 회고도 간다
 */
@SpringBootTest
class ReflectionPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var reflections: ReflectionService
    @Autowired private lateinit var checks: VisitCheckRepository
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

    private fun rows(tripId: UUID) =
        jdbc.queryForObject("SELECT count(*) FROM reflection WHERE trip_id = ?", Int::class.java, tripId)

    @Test
    fun `방문 0곳이어도 기본 카드가 저장된다 — 빈 화면을 그리지 않는다(PBT-U5-1)`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)

        val r = reflections.generateDaily(accountId, tripId, day)

        r.draftNarrative.shouldNotBeBlank()
        r.source shouldBe ReflectionSource.BASIC
        r.stats.visitCount shouldBe 0
        rows(tripId) shouldBe 1
    }

    @Test
    fun `하루 한 장 — 다시 만들어도 행이 늘지 않고 generated_at 이 밀리지 않는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        reflections.generateDaily(accountId, tripId, day)
        val firstGeneratedAt = jdbc.queryForObject(
            "SELECT generated_at FROM reflection WHERE trip_id = ?", Instant::class.java, tripId,
        )

        reflections.generateDaily(accountId, tripId, day)

        rows(tripId) shouldBe 1
        // 지웠다 넣는 구현이었다면 "언제 처음 만들어졌나"가 사라진다.
        jdbc.queryForObject(
            "SELECT generated_at FROM reflection WHERE trip_id = ?", Instant::class.java, tripId,
        ) shouldBe firstGeneratedAt
    }

    @Test
    fun `수정해도 초안은 남는다(INV-U5-06)`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val draft = reflections.generateDaily(accountId, tripId, day).draftNarrative

        val edited = reflections.edit(accountId, tripId, day, "내가 고친 문장")

        edited.draftNarrative shouldBe draft
        edited.editedNarrative shouldBe "내가 고친 문장"
        edited.narrative shouldBe "내가 고친 문장"
    }

    @Test
    fun `재생성이 수정본을 지우지 않는다 — 실 DB 왕복(INV-U5-06 · TRIP-553)`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        reflections.generateDaily(accountId, tripId, day)
        reflections.edit(accountId, tripId, day, "내가 쓴 문장")

        reflections.generateDaily(accountId, tripId, day)

        // upsert 가 도메인 값을 그대로 덮으므로, 도메인이 보존해도 영속에서 날아가면 여기서 잡힌다.
        jdbc.queryForObject(
            "SELECT edited_narrative FROM reflection WHERE trip_id = ?", String::class.java, tripId,
        ) shouldBe "내가 쓴 문장"
        rows(tripId) shouldBe 1
    }

    @Test
    fun `회고가 없어도 바로 쓸 수 있다 — 기본 카드 위에 얹는다(BR-U5-36)`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)

        val written = reflections.edit(accountId, tripId, day, "생성 없이 바로 쓴다")

        written.narrative shouldBe "생성 없이 바로 쓴다"
        written.draftNarrative.shouldNotBeBlank()
        rows(tripId) shouldBe 1
    }

    @Test
    fun `stats 가 jsonb 로 왕복한다 — 이중 인코딩되면 여기서 깨진다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val poi = UUID.randomUUID()
        checks.save(VisitCheck.arrive(tripId, "$day#$poi", poi, CheckSource.MANUAL, Instant.parse("2026-08-11T03:00:00Z")))

        val r = reflections.generateDaily(accountId, tripId, day)

        r.stats.distanceSource shouldBe DistanceSource.VISIT_LINE
        // 스칼라로 이스케이프돼 들어갔으면 object 가 아니라 string 이 된다.
        jdbc.queryForObject(
            "SELECT jsonb_typeof(stats) FROM reflection WHERE trip_id = ?", String::class.java, tripId,
        ) shouldBe "object"
        jdbc.queryForObject(
            "SELECT stats->>'distanceSource' FROM reflection WHERE trip_id = ?", String::class.java, tripId,
        ) shouldBe "VISIT_LINE"
    }

    @Test
    fun `여행을 지우면 회고도 함께 파기된다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        reflections.generateDaily(accountId, tripId, day)
        rows(tripId) shouldBe 1

        jdbc.update("DELETE FROM trip WHERE trip_id = ?", tripId) shouldBe 1

        rows(tripId) shouldBe 0
    }
}
