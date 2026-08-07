package com.trippilot.placedata.adapter.`in`.web

import com.trippilot.placedata.application.PoiWithDistance
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

/** 경계 매핑 — 한글 카테고리→코드(8종 전수), dataQuality 파생(FULL/PARTIAL/MINIMAL), 거리 전달. */
class PoiReadResponseTest : StringSpec({

    val now = Instant.parse("2026-08-06T00:00:00Z")
    fun poi(cat: PoiCategory, imageUrl: String?, openingHours: String?): Poi =
        Poi.reconstitute(
            UUID.randomUUID(), "장소", 33.4, 126.9, cat, "제주", openingHours, DataStatus.ACTIVE, PoiSource.KAKAO_LOCAL,
            3, now, now, imageUrl,
        )

    "한글 카테고리 → 경계 코드 8종 전수 매핑" {
        val expected = mapOf(
            PoiCategory.명소 to "SIGHT", PoiCategory.맛집 to "FOOD", PoiCategory.카페 to "CAFE",
            PoiCategory.야경 to "NIGHT_VIEW", PoiCategory.자연 to "NATURE", PoiCategory.쇼핑 to "SHOPPING",
            PoiCategory.문화 to "CULTURE", PoiCategory.액티비티 to "ACTIVITY",
        )
        PoiCategory.entries.forEach { cat ->
            PoiReadResponse.from(PoiWithDistance(poi(cat, null, null), null)).category shouldBe expected.getValue(cat)
        }
    }

    "dataQuality 3등급 — 영업시간 없으면 MINIMAL(사진 무관), 있으면 사진 유무로 FULL/PARTIAL" {
        fun q(imageUrl: String?, openingHours: String?) =
            PoiReadResponse.from(PoiWithDistance(poi(PoiCategory.맛집, imageUrl, openingHours), null)).dataQuality
        q("u", "09-18") shouldBe "FULL"
        q(null, "09-18") shouldBe "PARTIAL"
        q("u", null) shouldBe "MINIMAL"  // 사진이 있어도 영업일 판정 불가 → 후보풀 제외 대상
        q(null, null) shouldBe "MINIMAL"
    }

    "source·dataStatus·distance 전달" {
        val r = PoiReadResponse.from(PoiWithDistance(poi(PoiCategory.맛집, "u", "09-18"), 1234.5))
        r.source shouldBe "KAKAO_LOCAL"
        r.dataStatus shouldBe "ACTIVE"
        r.distanceM shouldBe 1234.5
    }
})
