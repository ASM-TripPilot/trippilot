package com.trippilot.placedata.application

import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.shouldBe
import java.time.Instant

/** RAG 후보풀 — 지역/반경·카테고리 resolve, ground(ACTIVE만). */
class CandidatePoolTest : StringSpec({

    val now = Instant.parse("2026-07-31T00:00:00Z")
    fun poi(name: String, lat: Double, lng: Double, cat: PoiCategory, status: DataStatus = DataStatus.ACTIVE): Poi =
        Poi.reconstitute(java.util.UUID.randomUUID(), name, lat, lng, cat, "부산", null, status, PoiSource.MANUAL, 0, now, now)

    "resolve 지역 — ACTIVE만, 카테고리 무필터" {
        val repo = InMemoryPoiRepository()
        val active = poi("자갈치", 35.096, 129.030, PoiCategory.맛집)
        repo.saveAll(listOf(active, poi("미확인", 35.1, 129.0, PoiCategory.명소, DataStatus.UNVERIFIED)))
        val pool = PlaceDataCandidatePool(repo)

        pool.resolve(Area.Region("부산"), emptySet()).map { it.nameKo } shouldBe listOf("자갈치")
    }

    "resolve 반경 — 반경 밖 배제·distanceM 채움" {
        val repo = InMemoryPoiRepository()
        val near = poi("자갈치", 35.0965, 129.0306, PoiCategory.맛집)     // 중심
        val far = poi("해운대", 35.1587, 129.1604, PoiCategory.자연)      // ~13km
        repo.saveAll(listOf(near, far))
        val pool = PlaceDataCandidatePool(repo)

        val got = pool.resolve(Area.Radius(35.0965, 129.0306, 3000.0), emptySet())
        got.map { it.nameKo } shouldBe listOf("자갈치")
        got.single().distanceM shouldBe 0.0 // 중심점과 동일 좌표
    }

    "resolve 카테고리 필터" {
        val repo = InMemoryPoiRepository()
        repo.saveAll(listOf(poi("자갈치", 35.096, 129.030, PoiCategory.맛집), poi("감천", 35.097, 129.010, PoiCategory.명소)))
        val pool = PlaceDataCandidatePool(repo)

        pool.resolve(Area.Region("부산"), setOf("맛집")).map { it.nameKo } shouldBe listOf("자갈치")
    }

    "ground — ACTIVE만(미확인·없는 id 제외)" {
        val repo = InMemoryPoiRepository()
        val a = poi("자갈치", 35.096, 129.030, PoiCategory.맛집)
        val u = poi("미확인", 35.1, 129.0, PoiCategory.명소, DataStatus.UNVERIFIED)
        repo.saveAll(listOf(a, u))
        val pool = PlaceDataCandidatePool(repo)

        pool.ground(listOf(a.poiId, u.poiId, java.util.UUID.randomUUID())).map { it.poiId } shouldContainExactlyInAnyOrder listOf(a.poiId)
    }
})
