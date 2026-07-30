package com.trippilot.placedata.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.time.Instant

/** 수집 게이트(INV-1) 구체 케이스 — 실재 확인된 것만 ACTIVE 승격, 미확보는 배제. */
class PoiCollectionGateTest : StringSpec({

    val now = Instant.parse("2026-07-31T00:00:00Z")
    fun place(name: String = "자갈치시장", lat: Double? = 35.1, lng: Double? = 129.0, cat: PoiCategory? = PoiCategory.맛집) =
        NormalizedPlace(name, lat, lng, cat, "부산", null, PoiSource.MANUAL)

    "이름·좌표·카테고리 확보면 ACTIVE로 승격" {
        val poi = PoiCollectionGate.promote(place(), now)
        poi.shouldNotBeNull()
        poi.dataStatus shouldBe DataStatus.ACTIVE
        poi.lat shouldBe 35.1
        poi.category shouldBe PoiCategory.맛집
    }

    "좌표 미확보는 배제(null)" {
        PoiCollectionGate.promote(place(lat = null, lng = null), now).shouldBeNull()
    }

    "카테고리 미확보는 배제" {
        PoiCollectionGate.promote(place(cat = null), now).shouldBeNull()
    }

    "이름 공백은 배제" {
        PoiCollectionGate.promote(place(name = "  "), now).shouldBeNull()
    }
})
