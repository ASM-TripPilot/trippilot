package com.trippilot.placedata.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

/** CDN 썸네일(V2.87)이 재수집에서 어떻게 살고 죽는가 — 원본이 그대로일 때만 산다. */
class PoiImageThumbTest : StringSpec({

    val t0 = Instant.parse("2026-10-01T00:00:00Z")
    val orig = "https://tong.visitkorea.or.kr/a.jpg"
    val thumb = "https://img.example.net/abc.webp"

    fun poi(image: String?, thumbUrl: String?) = Poi.reconstitute(
        poiId = UUID.randomUUID(), nameKo = "광안리", lat = 35.15, lng = 129.12, category = PoiCategory.명소,
        region = "수영구", openingHours = null, dataStatus = DataStatus.ACTIVE, source = PoiSource.TOURAPI, savedCount = 0,
        createdAt = t0, updatedAt = t0, imageUrl = image, sourceRef = "R-1", imageThumbUrl = thumbUrl,
    )

    fun refresh(existing: Poi, newImage: String?) = Poi.refreshed(
        existing = existing, nameKo = "광안리", lat = 35.15, lng = 129.12, category = PoiCategory.명소,
        region = "수영구", openingHours = null, now = t0, imageUrl = newImage,
    )

    "썸네일이 있으면 화면에는 썸네일, 없으면 원본을 준다" {
        poi(orig, thumb).displayImageUrl shouldBe thumb
        poi(orig, null).displayImageUrl shouldBe orig
        poi(null, null).displayImageUrl shouldBe null
    }

    "재수집이 같은 원본을 주면 썸네일을 지킨다" {
        refresh(poi(orig, thumb), orig).imageThumbUrl shouldBe thumb
    }

    "재수집이 이미지를 안 주면(null) 원본도 썸네일도 지킨다" {
        val r = refresh(poi(orig, thumb), null)
        r.imageUrl shouldBe orig
        r.imageThumbUrl shouldBe thumb
    }

    "원본이 바뀌면 옛 썸네일을 비운다 — 다른 사진이 나가지 않게" {
        val r = refresh(poi(orig, thumb), "https://tong.visitkorea.or.kr/b.jpg")
        r.imageThumbUrl shouldBe null
        r.displayImageUrl shouldBe "https://tong.visitkorea.or.kr/b.jpg"
    }
})
