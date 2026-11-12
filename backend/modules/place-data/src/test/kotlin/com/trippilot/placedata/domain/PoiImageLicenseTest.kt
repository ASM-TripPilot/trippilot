package com.trippilot.placedata.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

/**
 * 사진의 공공누리 유형(V2.88) — 원문 매핑과, 재수집에서 사진과 **한 쌍으로** 살고 죽는 규칙.
 * 사진이 바뀌었는데 옛 유형이 남으면 3유형 사진이 잘려 나가거나(옛 값 TYPE1) 1유형 사진이 쓸데없이 작아진다.
 */
class PoiImageLicenseTest : StringSpec({

    "원문 Type1·Type3 은 대소문자와 무관하게 유형이 되고, 그 밖·없음은 null 이다" {
        ImageLicense.fromCpyrhtDivCd("Type1") shouldBe ImageLicense.TYPE1
        ImageLicense.fromCpyrhtDivCd("Type3") shouldBe ImageLicense.TYPE3
        ImageLicense.fromCpyrhtDivCd("type3") shouldBe ImageLicense.TYPE3
        ImageLicense.fromCpyrhtDivCd("TYPE1") shouldBe ImageLicense.TYPE1
        ImageLicense.fromCpyrhtDivCd("Type2") shouldBe null
        ImageLicense.fromCpyrhtDivCd("") shouldBe null
        ImageLicense.fromCpyrhtDivCd(null) shouldBe null
    }

    val t0 = Instant.parse("2026-11-01T00:00:00Z")
    val a = "https://tong.visitkorea.or.kr/a.jpg"
    val b = "https://tong.visitkorea.or.kr/b.jpg"

    fun poi(image: String?, license: ImageLicense?) = Poi.reconstitute(
        poiId = UUID.randomUUID(), nameKo = "경복궁", lat = 37.58, lng = 126.97, category = PoiCategory.명소,
        region = "종로구", openingHours = null, dataStatus = DataStatus.ACTIVE, source = PoiSource.TOURAPI, savedCount = 0,
        createdAt = t0, updatedAt = t0, imageUrl = image, sourceRef = "R-1", imageLicense = license,
    )

    fun refresh(existing: Poi, image: String?, license: ImageLicense?) = Poi.refreshed(
        existing = existing, nameKo = "경복궁", lat = 37.58, lng = 126.97, category = PoiCategory.명소,
        region = "종로구", openingHours = null, now = t0, imageUrl = image, imageLicense = license,
    )

    "같은 사진에 유형이 처음 오면 채운다 — #1716 이전에 적재된 행이 여기서 채워진다" {
        refresh(poi(a, null), a, ImageLicense.TYPE3).imageLicense shouldBe ImageLicense.TYPE3
    }

    "같은 사진인데 이번에 유형이 안 오면 기존 값을 지킨다" {
        refresh(poi(a, ImageLicense.TYPE3), a, null).imageLicense shouldBe ImageLicense.TYPE3
    }

    "사진을 안 주면(null) 사진도 유형도 지킨다" {
        val r = refresh(poi(a, ImageLicense.TYPE3), null, null)
        r.imageUrl shouldBe a
        r.imageLicense shouldBe ImageLicense.TYPE3
    }

    "사진이 바뀌면 유형도 새 사진의 값으로 바뀐다" {
        refresh(poi(a, ImageLicense.TYPE3), b, ImageLicense.TYPE1).imageLicense shouldBe ImageLicense.TYPE1
    }

    "사진이 바뀌었는데 유형이 안 오면 모름(null)이다 — 옛 사진의 유형을 새 사진에 붙이지 않는다" {
        refresh(poi(a, ImageLicense.TYPE1), b, null).imageLicense shouldBe null
    }

    "새로 수집되는 장소는 받은 유형을 그대로 싣는다" {
        val place = NormalizedPlace(
            nameKo = "경복궁", lat = 37.58, lng = 126.97, category = PoiCategory.명소, region = "종로구",
            openingHours = null, source = PoiSource.TOURAPI, sourceRef = "R-1", imageUrl = a, imageLicense = ImageLicense.TYPE3,
        )
        PoiCollectionGate.promote(place, t0)!!.imageLicense shouldBe ImageLicense.TYPE3
    }
})
