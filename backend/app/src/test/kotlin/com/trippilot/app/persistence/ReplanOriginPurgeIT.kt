package com.trippilot.app.persistence

import com.trippilot.recalculation.application.ReplanSessionService
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID

/**
 * 재계획 기준점 좌표 파기(TRIP-992 · V2.56) 실 DB 검증 — 인메모리로는 원리적으로 못 보는 것들.
 *
 * - **V2.56 제약 교체가 실제로 물었는가** — 'PURGED' 를 CHECK 가 받는지는 실 DB 만 안다
 *   (제약 이름을 못 맞춰 DROP 이 헛돌면 옛 CHECK 가 남아 여기서 터진다).
 * - **@Modifying JPQL 파기가 좌표·kind 를 함께 바꾸는가** — CHECK(GPS·MANUAL 은 좌표 필수)와의
 *   순서 문제는 실 DB 에서만 드러난다.
 * - **법정 로그가 append-only 로 남는가**(INV-LL1) — 파기 1건 = PURGE 1행.
 */
@SpringBootTest
class ReplanOriginPurgeIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var sessions: ReplanSessionService
    @Autowired private lateinit var jdbc: JdbcTemplate

    private fun newTripWith(accountId: UUID): UUID {
        val trip = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO account (account_id, age_method, age_confirmed_at) VALUES (?, 'SELF_DECLARED', now())",
            accountId,
        )
        jdbc.update(
            """
            INSERT INTO trip (trip_id, account_id, title, start_date, end_date, party, preference_snapshot)
            VALUES (?, ?, '파기 검증', DATE '2026-08-10', DATE '2026-08-12', 2, '{}'::jsonb)
            """.trimIndent(),
            trip, accountId,
        )
        return trip
    }

    private fun insertSession(trip: UUID, kind: String, lat: Double?, lng: Double?): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO replan_session (session_id, trip_id, itinerary_id, scope, target_date, from_instant,
                                        origin_kind, origin_lat, origin_lng,
                                        reasons, directives, excluded_poi_ids, status, created_at, closed_at)
            VALUES (?, ?, ?, 'FULL_DAY', (now() AT TIME ZONE 'Asia/Seoul')::date, now(),
                    ?, ?, ?, '{}', '{}', '{}', 'CANCELED', now(), now())
            """.trimIndent(),
            id, trip, UUID.randomUUID(), kind, lat, lng,
        )
        return id
    }

    @Test
    fun `파기가 좌표를 지우고 PURGED 로 남기며 법정 로그 1행을 쓴다`() {
        val account = UUID.randomUUID()
        val trip = newTripWith(account)
        insertSession(trip, "GPS", 35.1, 129.0)
        insertSession(trip, "MANUAL", 35.2, 129.1)
        insertSession(trip, "STAY_ANCHOR", null, null) // 서버 유도분 — 파기 대상 아님

        val purged = sessions.purgeOriginCoordinates(account)

        purged shouldBe 2
        jdbc.queryForObject(
            "SELECT count(*) FROM replan_session WHERE trip_id = ? AND origin_kind = 'PURGED' AND origin_lat IS NULL",
            Int::class.java, trip,
        ) shouldBe 2
        jdbc.queryForObject(
            "SELECT count(*) FROM location_legal_log WHERE account_id = ? AND event_type = 'PURGE' AND detail->>'scope' = 'REPLAN_ORIGIN'",
            Int::class.java, account,
        ) shouldBe 1
        // 멱등 — 두 번째는 0건, 로그도 안 는다(at-least-once 배달 대비).
        sessions.purgeOriginCoordinates(account) shouldBe 0
        jdbc.queryForObject(
            "SELECT count(*) FROM location_legal_log WHERE account_id = ? AND event_type = 'PURGE'",
            Int::class.java, account,
        ) shouldBe 1
    }
}
