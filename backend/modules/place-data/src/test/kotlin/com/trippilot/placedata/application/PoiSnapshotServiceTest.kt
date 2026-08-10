package com.trippilot.placedata.application

import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSnapshot
import com.trippilot.placedata.domain.PoiSnapshotRepository
import com.trippilot.placedata.domain.PoiSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

private class FakeSnapshots : PoiSnapshotRepository {
    val stored = mutableListOf<PoiSnapshot>()
    override fun save(snapshot: PoiSnapshot) = snapshot.also { stored.add(it) }
    override fun findById(poiSnapshotId: UUID) = stored.firstOrNull { it.poiSnapshotId == poiSnapshotId }
    override fun findByIds(poiSnapshotIds: Collection<UUID>): List<PoiSnapshot> =
        stored.filter { it.poiSnapshotId in poiSnapshotIds }

}

class PoiSnapshotServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-31T00:00:00Z"), ZoneOffset.UTC)
    fun poi(status: DataStatus = DataStatus.ACTIVE) =
        Poi.reconstitute(UUID.randomUUID(), "자갈치시장", 35.096, 129.030, PoiCategory.맛집, "부산", null, status, PoiSource.MANUAL, 0, clock.instant(), clock.instant())

    "freeze — ACTIVE POI 값을 스냅숏으로 복사" {
        val pois = InMemoryPoiRepository()
        val p = poi()
        pois.stored.add(p)
        val svc = PoiSnapshotService(pois, FakeSnapshots(), clock)

        val ref = svc.freeze(p.poiId)
        ref.shouldNotBeNull()
        ref.sourcePoiId shouldBe p.poiId
        ref.nameKo shouldBe "자갈치시장"
        ref.lat shouldBe 35.096
        ref.category shouldBe "맛집"
    }

    "freeze — 없거나 비-ACTIVE면 null" {
        val pois = InMemoryPoiRepository()
        pois.stored.add(poi(status = DataStatus.CLOSED))
        val svc = PoiSnapshotService(pois, FakeSnapshots(), clock)

        svc.freeze(UUID.randomUUID()).shouldBeNull()      // 없음
        svc.freeze(pois.stored.first().poiId).shouldBeNull() // 비-ACTIVE
    }
})
