package com.trippilot.placedata.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.double
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.orNull
import io.kotest.property.arbitrary.string
import io.kotest.property.checkAll
import java.time.Instant

/**
 * closed-set 수집 게이트 PBT(INV-1) — 임의 후보에 대해:
 * 승격(ACTIVE POI)은 이름·좌표·카테고리 확보와 **정확히 동치**, 미확보는 후보풀 미통과(null).
 * 승격된 POI는 항상 ACTIVE + 좌표 보유(INV-U1-02).
 */
class PoiGatePropertyTest : StringSpec({

    val now = Instant.parse("2026-07-31T00:00:00Z")

    "게이트 통과 ⟺ 이름·좌표·카테고리 확보 · 통과분은 ACTIVE·좌표 보유" {
        checkAll(
            Arb.string(0..8),
            Arb.double(33.0..38.0).orNull(),
            Arb.double(126.0..130.0).orNull(),
            Arb.enum<PoiCategory>().orNull(),
        ) { name, lat, lng, category ->
            val place = NormalizedPlace(name, lat, lng, category, "부산", null, PoiSource.MANUAL)
            val poi = PoiCollectionGate.promote(place, now)

            val qualified = name.isNotBlank() && lat != null && lng != null && category != null
            (poi != null) shouldBe qualified

            if (poi != null) {
                poi.dataStatus shouldBe DataStatus.ACTIVE // 통과분은 반드시 ACTIVE
                poi.lat shouldBe lat                       // 좌표 보존(INV-U1-02)
                poi.lng shouldBe lng
                poi.category shouldBe category
            }
        }
    }
})
