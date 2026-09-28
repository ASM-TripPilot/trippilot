package com.trippilot.itinerarygeneration.adapter.`in`.web

import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.SlotCandidate
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import com.trippilot.placedata.api.PoiSurfaceView
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

    "표면이 있으면 이름·카테고리·태그·사진이 그대로 실린다(TRIP-851 · TRIP-1005)" {
        val o = output(degraded = false)
        val poiId = o.candidates.single().poiId
        val surface = PoiSurfaceView(poiId, "희와제과", 35.1, 129.0, "카페", "CAFE", "부산", "https://img/1.jpg", listOf("빵", "디저트"))
        val c = SlotCandidatesResponse.from(o, mapOf(poiId to surface)).candidates.single()

        c.nameKo shouldBe "희와제과"
        c.category shouldBe "카페"
        c.tags shouldBe listOf("빵", "디저트")
        c.imageUrl shouldBe "https://img/1.jpg"
        // 지도 핀 좌표(TRIP-1063 · QA #044) — 정본 좌표 그대로.
        c.lat shouldBe 35.1
        c.lng shouldBe 129.0
    }

    "표면이 없으면 전부 null·빈 배열 — 이름을 지어내지 않는다" {
        val c = SlotCandidatesResponse.from(output(degraded = false)).candidates.single()

        c.nameKo shouldBe null
        c.category shouldBe null
        c.tags shouldBe emptyList<String>()
        c.imageUrl shouldBe null
        // 좌표도 지어내지 않는다 — 반경 중심 대체 금지(TRIP-1063 금지 AC).
        c.lat shouldBe null
        c.lng shouldBe null
    }
})
