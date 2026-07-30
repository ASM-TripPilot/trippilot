package com.trippilot.placedata.application

import com.trippilot.placedata.domain.Area
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.MapPlacePort
import com.trippilot.placedata.domain.NormalizedPlace
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

private class FakeRepo : PoiRepository {
    val stored = mutableListOf<Poi>()
    override fun saveAll(pois: List<Poi>) = pois.also { stored.addAll(it) }
    override fun findById(poiId: UUID) = stored.firstOrNull { it.poiId == poiId }
    override fun findActive(region: String?, category: PoiCategory?) =
        stored.filter { it.dataStatus == DataStatus.ACTIVE && (region == null || it.region == region) && (category == null || it.category == category) }
}

private class FakeMap(private val places: List<NormalizedPlace>) : MapPlacePort {
    override fun search(area: Area, category: PoiCategory?) =
        if (category == null) places else places.filter { it.category == category }
}

class PoiCollectionServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-31T00:00:00Z"), ZoneOffset.UTC)

    "수집은 게이트 통과분만 저장 — 좌표 미확보 후보는 배제" {
        val repo = FakeRepo()
        val map = FakeMap(
            listOf(
                NormalizedPlace("자갈치시장", 35.1, 129.0, PoiCategory.맛집, "부산", null, PoiSource.MANUAL),
                NormalizedPlace("해운대", 35.16, 129.16, PoiCategory.자연, "부산", null, PoiSource.MANUAL),
                NormalizedPlace("좌표없음", null, null, PoiCategory.명소, "부산", null, PoiSource.MANUAL), // 배제
            ),
        )
        val svc = PoiCollectionService(repo, map, clock)

        val count = svc.collect(Area("부산"))

        count shouldBe 2
        repo.stored.size shouldBe 2
        repo.stored.all { it.dataStatus == DataStatus.ACTIVE } shouldBe true
        repo.stored.none { it.nameKo == "좌표없음" } shouldBe true
    }
})
