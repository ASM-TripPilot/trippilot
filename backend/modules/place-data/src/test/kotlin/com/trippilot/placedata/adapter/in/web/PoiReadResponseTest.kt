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

/** 경계 매핑 — 한글 카테고리→코드(8종 전수), dataQuality 파생(FULL/PARTIAL), 거리 전달. */
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

    "dataQuality — 사진·영업시간 완비=FULL, 하나라도 없으면 PARTIAL" {
        fun q(imageUrl: String?, openingHours: String?) =
            PoiReadResponse.from(PoiWithDistance(poi(PoiCategory.맛집, imageUrl, openingHours), null)).dataQuality
        q("u", "09-18") shouldBe "FULL"
        q("u", null) shouldBe "PARTIAL"
        q(null, "09-18") shouldBe "PARTIAL"
        q(null, null) shouldBe "PARTIAL"
    }

    "source·dataStatus·distance 전달" {
        val r = PoiReadResponse.from(PoiWithDistance(poi(PoiCategory.맛집, "u", "09-18"), 1234.5))
        r.source shouldBe "KAKAO_LOCAL"
        r.dataStatus shouldBe "ACTIVE"
        r.distanceM shouldBe 1234.5
    }

    /**
     * tags·sourceRef 전달(TRIP-870).
     *
     * 값은 이미 DB·도메인·공개 API 에 있었고 **이 경계에만 안 실려 있었다.** 없으면 상대는 카테고리
     * 8종만 보게 되는데, `SIGHT` 하나에 야외 유적지와 실내 전시관이 섞여 있어 비 오는 날 실내 대안을
     * 고를 근거가 없다. 그 상태의 증상은 예외가 아니라 **지어낸 근거 문구**라 아무도 못 알아챈다.
     */
    "tags·sourceRef 를 도메인 값 그대로 싣는다" {
        val p = Poi.reconstitute(
            UUID.randomUUID(), "수원화성", 37.28, 127.01, PoiCategory.명소, "수원", null,
            DataStatus.ACTIVE, PoiSource.TOURAPI, 3, now, now,
            tags = listOf("역사관광지", "유적지/사적지"), sourceRef = "126508",
        )

        val r = PoiReadResponse.from(PoiWithDistance(p, null))

        r.tags shouldBe listOf("역사관광지", "유적지/사적지")
        r.sourceRef shouldBe "126508"
    }

    /**
     * **미확보를 빈 값으로 보존한다 — 지어내지도, 필드를 빼지도 않는다.** 수동 등록분은 `sourceRef` 가
     * 없고(그때는 멱등 판정 대상이 아니다) 태그를 못 얻은 수집분은 빈 배열이다. 여기서 기본값을 채우면
     * 상대가 "출처를 아는 POI"로 착각해 조인을 시도하고, 0건 매칭이 조용한 실패로 남는다.
     */
    "미확보는 빈 배열·null 그대로 간다" {
        val r = PoiReadResponse.from(PoiWithDistance(poi(PoiCategory.맛집, null, null), null))

        r.tags shouldBe emptyList()
        r.sourceRef shouldBe null
    }
})
