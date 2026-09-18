package com.trippilot.placedata.application

import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.placedata.domain.PlaceAddress
import com.trippilot.placedata.domain.PlaceLocation
import com.trippilot.placedata.domain.PlaceLookupPort
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe

/**
 * 장소 검색(e05 지도검색 탭).
 *
 * 여기서 지키는 것은 하나다 — **"못 찾음"과 "못 물어봄"을 같은 값으로 만들지 않는 것**(BR-U1-23).
 * 둘이 같아지면 화면이 "결과 없음"을 그리고, 사용자는 철자를 고쳐 가며 몇 번을 다시 친다.
 */
class PlaceLookupServiceTest : StringSpec({

    class Vendor(
        private val result: List<PlaceLocation> = emptyList(),
        private val fail: Boolean = false,
        private val address: PlaceAddress? = null,
    ) : PlaceLookupPort {
        var calls = 0
        override fun search(query: String): List<PlaceLocation> {
            calls++
            if (fail) throw IllegalStateException("vendor down")
            return result
        }

        override fun reverseGeocode(lat: Double, lng: Double): PlaceAddress? {
            calls++
            if (fail) throw IllegalStateException("vendor down")
            return address
        }
    }

    val shilla = PlaceLocation("제주신라호텔", "제주특별자치도 서귀포시 중문관광로72번길 75", 33.2496, 126.4108)

    "찾은 결과를 계약 타입으로 돌려준다" {
        val found = PlaceLookupService(Vendor(listOf(shilla))).search("제주신라호텔")

        found shouldHaveSize 1
        found[0].name shouldBe "제주신라호텔"
        found[0].lat shouldBe 33.2496
    }

    "못 찾으면 빈 목록 — 예외가 아니다" {
        PlaceLookupService(Vendor(emptyList())).search("없는숙소이름") shouldHaveSize 0
    }

    // 여기가 이 클래스의 핵심이다. 빈 목록으로 접으면 화면이 "결과 없음"을 그린다.
    "벤더 호출 실패는 빈 목록이 아니라 503 으로 올라간다" {
        val e = shouldThrow<UpstreamUnavailable> {
            PlaceLookupService(Vendor(fail = true)).search("제주신라호텔")
        }
        e.source shouldBe "kakao-local"
        e.fallbackApplied shouldBe false
    }

    "빈 질의는 벤더를 부르지 않는다" {
        val vendor = Vendor(listOf(shilla))
        PlaceLookupService(vendor).search("   ") shouldHaveSize 0
        vendor.calls shouldBe 0
    }
    // 역방향도 같은 태도다 — "주소가 없다"(null)와 "못 물어봤다"(예외)를 섞지 않는다.
    "역지오코딩은 주소를 그대로 돌려준다" {
        val addr = PlaceLookupService(Vendor(address = PlaceAddress("제주특별자치도 제주시 첨단로 242")))
            .reverseGeocode(33.4996, 126.5312)

        addr shouldBe "제주특별자치도 제주시 첨단로 242"
    }

    // 바다 위 좌표 등 — 정상 응답이라 null 이다. 이걸 예외로 만들면 화면이 장애로 오해한다.
    "주소가 없는 좌표는 null — 예외가 아니다" {
        PlaceLookupService(Vendor(address = null)).reverseGeocode(33.0, 130.0).shouldBeNull()
    }

    "역지오코딩 실패도 null 이 아니라 503 으로 올라간다" {
        val e = shouldThrow<UpstreamUnavailable> {
            PlaceLookupService(Vendor(fail = true)).reverseGeocode(33.4996, 126.5312)
        }
        e.source shouldBe "kakao-local"
        e.fallbackApplied shouldBe false
    }
})
