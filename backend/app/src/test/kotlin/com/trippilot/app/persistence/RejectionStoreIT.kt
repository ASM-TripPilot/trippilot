package com.trippilot.app.persistence

import com.trippilot.itinerarygeneration.domain.RejectedPoi
import com.trippilot.itinerarygeneration.domain.RejectionStore
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID

/**
 * `trip_poi_rejection`(V2.53) 실 DB 검증 — 인메모리 Fake 로는 원리적으로 못 보는 둘을 본다.
 *
 * - **upsert 원자성** — 같은 (trip, poi, kind) 재기록이 행 분열 없이 count 증가로 접히는지는
 *   `ON CONFLICT` 가 실 DB 에서 무는지에 달렸다. Fake 는 Map 이라 언제나 접힌다.
 * - **CASCADE** — 거절의 수명은 여행까지다(사용자 결정 2026-09-26). 여행이 지워졌는데 이력이
 *   남으면 지운 여행이 저장소에 유령으로 남고, 계정 파기(퍼지) 경로도 이 행에 걸려 멈춘다.
 */
@SpringBootTest
class RejectionStoreIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var store: RejectionStore
    @Autowired private lateinit var jdbc: JdbcTemplate

    private fun newTrip(): Pair<UUID, UUID> {
        val account = UUID.randomUUID()
        val trip = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO account (account_id, age_method, age_confirmed_at) VALUES (?, 'SELF_DECLARED', now())",
            account,
        )
        jdbc.update(
            """
            INSERT INTO trip (trip_id, account_id, title, start_date, end_date, party, preference_snapshot)
            VALUES (?, ?, '거절 이력 검증', DATE '2026-08-10', DATE '2026-08-12', 2, '{}'::jsonb)
            """.trimIndent(),
            trip, account,
        )
        return account to trip
    }

    @Test
    fun `같은 거절을 반복하면 행이 늘지 않고 count 가 는다`() {
        val (_, trip) = newTrip()
        val poi = UUID.randomUUID()

        store.record(trip, listOf(poi), RejectedPoi.Kind.SWAPPED_OUT)
        store.record(trip, listOf(poi), RejectedPoi.Kind.SWAPPED_OUT)

        store.findByTrip(trip) shouldBe listOf(RejectedPoi(poi, RejectedPoi.Kind.SWAPPED_OUT, 2))
        jdbc.queryForObject(
            "SELECT count(*) FROM trip_poi_rejection WHERE trip_id = ?", Int::class.java, trip,
        ) shouldBe 1
    }

    /** 같은 POI 라도 종류가 다르면 별개 행이다 — AI 가 종류별로 다른 계단을 오른다. */
    @Test
    fun `종류가 다르면 별개로 센다`() {
        val (_, trip) = newTrip()
        val poi = UUID.randomUUID()

        store.record(trip, listOf(poi), RejectedPoi.Kind.SWAPPED_OUT)
        store.record(trip, listOf(poi), RejectedPoi.Kind.REGENERATED)

        store.findByTrip(trip).toSet() shouldBe setOf(
            RejectedPoi(poi, RejectedPoi.Kind.SWAPPED_OUT, 1),
            RejectedPoi(poi, RejectedPoi.Kind.REGENERATED, 1),
        )
    }

    /**
     * 거절의 수명은 여행까지다. CASCADE 가 안 걸려 있으면 이 행이 계정 파기(퍼지)의
     * FK 걸림돌이 된다 — 지금 초록인 퍼지 IT 가 이 테이블 추가로 조용히 빨개지는 것을 막는다.
     */
    @Test
    fun `여행이 지워지면 거절 이력도 함께 지워진다`() {
        val (_, trip) = newTrip()
        store.record(trip, listOf(UUID.randomUUID()), RejectedPoi.Kind.REGENERATED)

        jdbc.update("DELETE FROM trip WHERE trip_id = ?", trip)

        store.findByTrip(trip) shouldBe emptyList()
    }
}
