package com.trippilot.itinerarygeneration.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import java.util.UUID

/** 점수 후보 풀 상한(TRIP-969) — 티켓 명세 "일정당 상위 200건 ≈ 8KB"의 집행 지점. */
class ScoredCandidatePoolTest : StringSpec({

    "상한을 넘는 풀은 점수 상위 200건만 남는다 — 저장 행이 무한히 크지 않게" {
        val pool = ScoredCandidatePool(3_000, (1..250).map { ScoredCandidate(UUID.randomUUID(), it / 1000.0, "카페") })

        val capped = pool.capped()

        capped.candidates shouldHaveSize 200
        // 잘리는 것은 **점수 낮은 쪽**이다 — 앞에서부터 자르면 고득점 후보가 사라진다.
        capped.candidates.minOf { it.score } shouldBe 0.051
        capped.radiusM shouldBe 3_000
    }

    "상한 이하면 그대로다" {
        val pool = ScoredCandidatePool(3_000, listOf(ScoredCandidate(UUID.randomUUID(), 0.9, "카페")))
        pool.capped().candidates shouldHaveSize 1
    }
})
