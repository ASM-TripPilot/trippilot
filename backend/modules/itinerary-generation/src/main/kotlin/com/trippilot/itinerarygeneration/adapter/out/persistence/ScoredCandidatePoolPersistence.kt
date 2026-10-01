package com.trippilot.itinerarygeneration.adapter.out.persistence

import tools.jackson.databind.ObjectMapper
import com.trippilot.itinerarygeneration.domain.ScoredCandidate
import com.trippilot.itinerarygeneration.domain.ScoredCandidatePool
import com.trippilot.itinerarygeneration.domain.ScoredCandidatePoolStore
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Repository
import java.util.UUID

/**
 * `trip_scored_candidate_pool`(V2.55) — 여행당 1행, 최신 생성이 통째로 갈아끼운다.
 *
 * JdbcTemplate + `ON CONFLICT` 인 이유는 [RejectionStorePersistence] 와 같다 — 갈아끼움을
 * 한 문장으로. jsonb 직렬화는 NotificationPersistence 선례(`?::jsonb` + ObjectMapper).
 *
 * [merge] 만 읽고-쓰기 두 문장이다. 생성 흐름의 단일 쓰기 경로(1차 → 2차 순차)라 경합이 없고,
 * 설사 겹쳐도 잃는 것은 후보 풀 일부 — 즉답이 전개로 한 번 더 갈 뿐 틀린 답이 나가지 않는다.
 */
@Repository
class ScoredCandidatePoolPersistence(
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
) : ScoredCandidatePoolStore {

    override fun replace(tripId: UUID, pool: ScoredCandidatePool) {
        val capped = pool.capped()
        jdbc.update(
            """
            INSERT INTO trip_scored_candidate_pool (trip_id, radius_m, candidates, saved_at)
            VALUES (?, ?, ?::jsonb, now())
            ON CONFLICT (trip_id)
              DO UPDATE SET radius_m = EXCLUDED.radius_m, candidates = EXCLUDED.candidates, saved_at = now()
            """.trimIndent(),
            tripId, capped.radiusM, mapper.writeValueAsString(capped.candidates.map { it.toRow() }),
        )
    }

    override fun merge(tripId: UUID, pool: ScoredCandidatePool) {
        val existing = find(tripId) ?: return replace(tripId, pool)
        // 같은 poiId 는 나중 값(2차) — 같은 생성의 더 최신 판단이다. 반경은 두 호출 중 큰 쪽.
        val combined = (existing.candidates.associateBy { it.poiId } + pool.candidates.associateBy { it.poiId })
            .values.toList()
        replace(tripId, ScoredCandidatePool(maxOf(existing.radiusM, pool.radiusM), combined))
    }

    override fun delete(tripId: UUID) {
        jdbc.update("DELETE FROM trip_scored_candidate_pool WHERE trip_id = ?", tripId)
    }

    override fun find(tripId: UUID): ScoredCandidatePool? =
        jdbc.query(
            "SELECT radius_m, candidates FROM trip_scored_candidate_pool WHERE trip_id = ?",
            { rs, _ ->
                ScoredCandidatePool(
                    radiusM = rs.getInt("radius_m"),
                    candidates = mapper.readValue(rs.getString("candidates"), Array<CandidateRow>::class.java)
                        .map { ScoredCandidate(UUID.fromString(it.poi_id), it.score, it.category) },
                )
            },
            tripId,
        ).firstOrNull()

    private fun ScoredCandidate.toRow() = CandidateRow(poiId.toString(), score, category)

    /** jsonb 행 모양 — 티켓 명세 그대로 `{poi_id, score, category}`. 도메인 이름과 분리해 wire 를 고정한다. */
    private data class CandidateRow(val poi_id: String, val score: Double, val category: String)
}
