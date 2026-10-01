package com.trippilot.app.persistence

import com.trippilot.itinerarygeneration.domain.ScoredCandidate
import com.trippilot.itinerarygeneration.domain.ScoredCandidatePool
import com.trippilot.itinerarygeneration.domain.ScoredCandidatePoolStore
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID

/**
 * `trip_scored_candidate_pool`(V2.55) 실 DB 검증 — 인메모리 Fake 로는 원리적으로 못 보는 것들.
 *
 * - **jsonb 왕복** — `{poi_id, score, category}` 배열이 직렬화·역직렬화를 거쳐 같은 값으로
 *   돌아오는지는 실 jsonb 컬럼에서만 드러난다(이중 인코딩·필드명 어긋남이 여기서 걸린다).
 * - **갈아끼움 원자성** — 여행당 1행은 DB PK 가 보장한다. Fake 는 Map 이라 언제나 덮어쓴다.
 * - **CASCADE** — 풀의 수명은 여행까지. 안 걸려 있으면 계정 파기(퍼지)가 이 행에 걸려 멈춘다.
 */
@SpringBootTest
class ScoredCandidatePoolIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var store: ScoredCandidatePoolStore
    @Autowired private lateinit var jdbc: JdbcTemplate

    private fun newTrip(): UUID {
        val account = UUID.randomUUID()
        val trip = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO account (account_id, age_method, age_confirmed_at) VALUES (?, 'SELF_DECLARED', now())",
            account,
        )
        jdbc.update(
            """
            INSERT INTO trip (trip_id, account_id, title, start_date, end_date, party, preference_snapshot)
            VALUES (?, ?, '점수 풀 검증', DATE '2026-08-10', DATE '2026-08-12', 2, '{}'::jsonb)
            """.trimIndent(),
            trip, account,
        )
        return trip
    }

    @Test
    fun `저장한 풀이 같은 값으로 돌아온다 - jsonb 왕복`() {
        val trip = newTrip()
        val pool = ScoredCandidatePool(
            12_000,
            listOf(ScoredCandidate(UUID.randomUUID(), 0.95, "카페"), ScoredCandidate(UUID.randomUUID(), 0.8, "명소")),
        )

        store.replace(trip, pool)

        store.find(trip) shouldBe pool
    }

    @Test
    fun `갈아끼우면 행이 늘지 않고 이전 풀이 사라진다`() {
        val trip = newTrip()
        store.replace(trip, ScoredCandidatePool(3_000, listOf(ScoredCandidate(UUID.randomUUID(), 0.5, "맛집"))))
        val second = ScoredCandidatePool(12_000, listOf(ScoredCandidate(UUID.randomUUID(), 0.9, "카페")))

        store.replace(trip, second)

        store.find(trip) shouldBe second
        jdbc.queryForObject(
            "SELECT count(*) FROM trip_scored_candidate_pool WHERE trip_id = ?", Int::class.java, trip,
        ) shouldBe 1
    }

    @Test
    fun `합치면 같은 poiId 는 나중 값, 반경은 큰 쪽이다 - 1차 뒤 2차`() {
        val trip = newTrip()
        val shared = UUID.randomUUID()
        val onlyFirst = UUID.randomUUID()
        store.replace(trip, ScoredCandidatePool(5_000, listOf(ScoredCandidate(shared, 0.5, "카페"), ScoredCandidate(onlyFirst, 0.7, "명소"))))

        store.merge(trip, ScoredCandidatePool(3_000, listOf(ScoredCandidate(shared, 0.9, "카페"))))

        val merged = store.find(trip)!!
        merged.radiusM shouldBe 5_000
        merged.candidates.toSet() shouldBe setOf(ScoredCandidate(shared, 0.9, "카페"), ScoredCandidate(onlyFirst, 0.7, "명소"))
    }

    @Test
    fun `여행이 지워지면 풀도 함께 지워진다`() {
        val trip = newTrip()
        store.replace(trip, ScoredCandidatePool(3_000, listOf(ScoredCandidate(UUID.randomUUID(), 0.5, "맛집"))))

        jdbc.update("DELETE FROM trip WHERE trip_id = ?", trip)

        store.find(trip) shouldBe null
    }
}
