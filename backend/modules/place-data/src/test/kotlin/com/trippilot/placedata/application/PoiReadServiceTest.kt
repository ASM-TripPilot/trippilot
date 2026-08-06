package com.trippilot.placedata.application

import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSource
import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

/** 리버스 read — ACTIVE만, 반경 하버사인 컷 + 합성 정렬키(savedCount↓ → FULL>PARTIAL → 거리↑ → poiId↑). */
class PoiReadServiceTest : StringSpec({

    val now = Instant.parse("2026-08-06T00:00:00Z")
    fun poi(
        name: String,
        lat: Double,
        lng: Double,
        savedCount: Long = 0,
        imageUrl: String? = null,
        openingHours: String? = null,
        status: DataStatus = DataStatus.ACTIVE,
    ): Poi = Poi.reconstitute(
        UUID.randomUUID(), name, lat, lng, PoiCategory.맛집, "제주", openingHours, status, PoiSource.MANUAL,
        savedCount, now, now, imageUrl,
    )

    "batchGet — ACTIVE만(미확인·없는 id 제외)" {
        val repo = InMemoryPoiRepository()
        val a = poi("자갈치", 35.096, 129.030)
        val u = poi("미확인", 35.1, 129.0, status = DataStatus.UNVERIFIED)
        repo.saveAll(listOf(a, u))

        PoiReadService(repo).batchGet(listOf(a.poiId, u.poiId, UUID.randomUUID()))
            .map { it.poi.poiId } shouldContainExactlyInAnyOrder listOf(a.poiId)
    }

    "findByRadius — 반경 밖 배제 + distanceM 채움" {
        val repo = InMemoryPoiRepository()
        val near = poi("성산", 33.4587, 126.9427) // 중심
        val far = poi("한라산", 33.3617, 126.5292) // ~40km
        repo.saveAll(listOf(near, far))

        val got = PoiReadService(repo).findByRadius(33.4587, 126.9427, 5.0) // 5km
        got.map { it.poi.nameKo } shouldContainExactly listOf("성산")
        got.single().distanceM shouldBe 0.0
    }

    "findByRadius — 합성 정렬: savedCount↓ → FULL>PARTIAL → 거리↑" {
        val repo = InMemoryPoiRepository()
        // 전부 반경 내(중심 근처). c=최고 savedCount, a=FULL, b=PARTIAL(a와 동 savedCount), d=거리 tiebreak
        val top = poi("top", 33.4590, 126.9430, savedCount = 10)
        val full = poi("full", 33.4592, 126.9432, savedCount = 5, imageUrl = "u", openingHours = "09:00-18:00")
        val partial = poi("partial", 33.4588, 126.9428, savedCount = 5) // 미완비=PARTIAL, top보다 중심 가깝지만 savedCount 낮음
        repo.saveAll(listOf(partial, full, top))

        PoiReadService(repo).findByRadius(33.4587, 126.9427, 5.0).map { it.poi.nameKo } shouldContainExactly
            listOf("top", "full", "partial") // savedCount 10 → (5,FULL) → (5,PARTIAL)
    }

    "findByRadius — 잘못된 좌표·반경은 400(ValidationFailed)" {
        val svc = PoiReadService(InMemoryPoiRepository())
        shouldThrow<ValidationFailed> { svc.findByRadius(200.0, 126.9, 5.0) }   // 위도 범위 밖
        shouldThrow<ValidationFailed> { svc.findByRadius(33.4, 126.9, -5.0) }   // 음수 반경
        shouldThrow<ValidationFailed> { svc.findByRadius(33.4, 126.9, 999.0) }  // 반경 상한 초과
        shouldThrow<ValidationFailed> { svc.findByRadius(33.4, 126.9, Double.NaN) }   // NaN 반경(검증 우회 방지)
        shouldThrow<ValidationFailed> { svc.findByRadius(Double.NaN, 126.9, 5.0) }    // NaN 좌표
    }

    "batchGet — 상한 초과는 400(ValidationFailed)" {
        val svc = PoiReadService(InMemoryPoiRepository())
        shouldThrow<ValidationFailed> { svc.batchGet((1..201).map { UUID.randomUUID() }) }
    }
})
