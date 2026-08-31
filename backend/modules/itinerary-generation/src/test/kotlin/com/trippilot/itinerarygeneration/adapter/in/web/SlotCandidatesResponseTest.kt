package com.trippilot.itinerarygeneration.adapter.`in`.web

import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.SlotCandidate
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

/**
 * 강등 사실이 **응답까지** 나가는지.
 *
 * 도메인이 `degraded` 를 들고 있어도 DTO 가 버리면 화면은 알 길이 없다 — 사용자는 취향이 반영된
 * 줄 알고, 우리는 이 폴백이 임시라는 사실을 잊는다(INV-4 · TRIP-408 이 본선).
 */
class SlotCandidatesResponseTest : StringSpec({

    fun output(degraded: Boolean) = SlotCandidatesOutput(
        candidates = listOf(SlotCandidate(UUID.randomUUID(), "약 0.3km", "주변 카페")),
        radiusMUsed = 3_000,
        freshness = FreshnessMeta(Instant.parse("2026-08-20T03:00:00Z"), degraded = degraded),
        emptyReason = null, // 후보가 있다 — 0건 사유는 없는 것이 맞다
    )

    "강등이면 응답에 그대로 실린다" {
        SlotCandidatesResponse.from(output(degraded = true)).degraded shouldBe true
    }

    "강등이 아니면 false 로 나간다 — 늘 true 를 박아 두면 경고가 의미를 잃는다" {
        SlotCandidatesResponse.from(output(degraded = false)).degraded shouldBe false
    }

    "후보 내용은 그대로 옮긴다 — 거리만, 소요시간 없음(INV-3)" {
        val o = output(degraded = true)
        val r = SlotCandidatesResponse.from(o)

        r.radiusMUsed shouldBe 3_000
        r.candidates.single().distanceRange shouldBe "약 0.3km"
        r.candidates.single().poiId shouldBe o.candidates.single().poiId
    }
})
