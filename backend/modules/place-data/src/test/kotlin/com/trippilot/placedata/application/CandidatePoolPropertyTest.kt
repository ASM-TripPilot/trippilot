package com.trippilot.placedata.application

import com.trippilot.placedata.FakeRegionCatalog
import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Haversine
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.bind
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.numericDouble
import io.kotest.property.arbitrary.pair
import io.kotest.property.checkAll
import java.time.Instant
import java.util.UUID

/**
 * 후보풀 반경 검색 PBT(INV-1 closed-set + bbox 정확성).
 * 임의 POI·중심·반경에 대해 resolve(Radius) == {하버사인 거리 ≤ 반경인 ACTIVE}.
 * → bounding-box 프리필터가 반경 내 POI를 절대 빠뜨리지 않고, 반경 밖은 전부 배제.
 */
class CandidatePoolPropertyTest : StringSpec({

    val now = Instant.parse("2026-07-31T00:00:00Z")

    "반경 resolve = 하버사인 반경 내 ACTIVE (미포함·미배제 0)" {
        checkAll(
            Arb.list(Arb.pair(Arb.numericDouble(33.0, 38.0), Arb.numericDouble(126.0, 130.0)), 0..12),
            Arb.bind(
                Arb.numericDouble(33.0, 38.0),
                Arb.numericDouble(126.0, 130.0),
                Arb.numericDouble(100.0, 30_000.0),
            ) { lat, lng, r -> Triple(lat, lng, r) },
        ) { coords, center ->
            val (cLat, cLng, radius) = center
            val repo = InMemoryPoiRepository()
            val pois = coords.mapIndexed { i, (lat, lng) ->
                Poi.reconstitute(UUID.randomUUID(), "p$i", lat, lng, PoiCategory.명소, "x", null, DataStatus.ACTIVE, PoiSource.MANUAL, 0, now, now)
            }
            repo.saveAll(pois)
            val pool = PlaceDataCandidatePool(repo, PoiQueryService(repo, RegionLookupService(FakeRegionCatalog)))

            val got = pool.resolve(Area.Radius(cLat, cLng, radius), emptySet())
            val expected = pois.filter { Haversine.meters(cLat, cLng, it.lat, it.lng) <= radius }

            got.map { it.poiId }.toSet() shouldBe expected.map { it.poiId }.toSet() // bbox가 in-radius 안 빠뜨림
            got.all { it.distanceM!! <= radius } shouldBe true                       // 반경 밖 배제
        }
    }
})
