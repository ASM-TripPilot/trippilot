package com.trippilot.placedata.application

import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.placedata.domain.PlaceLocation
import com.trippilot.placedata.domain.PlaceLookupPort
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldHaveSize
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
    ) : PlaceLookupPort {
        var calls = 0
        override fun search(query: String): List<PlaceLocation> {
            calls++
            if (fail) throw IllegalStateException("vendor down")
            return result
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
})
