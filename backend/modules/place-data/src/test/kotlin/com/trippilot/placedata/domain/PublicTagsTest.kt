package com.trippilot.placedata.domain

import com.trippilot.placedata.adapter.`in`.web.PlaceResponse
import com.trippilot.placedata.application.PoiSurfaceService
import com.trippilot.placedata.InMemoryPoiRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

/** 지도 앱 평판 파생 태그는 공개 면(앱 API·일정 표면)에 안 나간다 — 나머지 태그와 순서는 그대로(TRIP-1537). */
class PublicTagsTest : StringSpec({

    val now = Instant.parse("2026-10-21T00:00:00Z")
    fun poi(tags: List<String>): Poi = Poi.reconstitute(
        UUID.randomUUID(), "장소", 37.5, 127.0, PoiCategory.맛집, "성동구", null, DataStatus.ACTIVE, PoiSource.LOCALDATA,
        0, now, now, tags = tags,
    )

    "인기1~5 와 평점높음 만 빠지고 나머지는 순서 그대로" {
        PublicTags.of(listOf("한식", "곱창,막창,양", "혼밥", "뷰", "인기4", "평점높음")) shouldBe listOf("한식", "곱창,막창,양", "혼밥", "뷰")
        PublicTags.of(listOf("인기1", "인기2", "인기3", "인기4", "인기5")) shouldBe emptyList()
    }

    "비슷하지만 다른 태그는 남긴다" {
        PublicTags.of(listOf("인기", "인기6", "인기0", "요즘 인기", "인기 맛집", "평점")) shouldBe
            listOf("인기", "인기6", "인기0", "요즘 인기", "인기 맛집", "평점")
    }

    "앱 API 응답(PlaceResponse)에서 빠진다" {
        PlaceResponse.from(poi(listOf("한식", "인기5", "평점높음", "혼밥"))).tags shouldBe listOf("한식", "혼밥")
    }

    "일정 표면(findSurfaces)에서 빠진다" {
        val repo = InMemoryPoiRepository()
        val p = poi(listOf("카페", "인기3", "작업"))
        repo.saveAll(listOf(p))
        val surfaces = PoiSurfaceService(repo, SurfaceNoSnapshots()).findSurfaces(listOf(p.poiId))
        surfaces.getValue(p.poiId).tags shouldBe listOf("카페", "작업")
    }
})

private class SurfaceNoSnapshots : PoiSnapshotRepository {
    override fun save(snapshot: PoiSnapshot) = snapshot
    override fun findById(poiSnapshotId: UUID): PoiSnapshot? = null
    override fun findByIds(poiSnapshotIds: Collection<UUID>): List<PoiSnapshot> = emptyList()
}
