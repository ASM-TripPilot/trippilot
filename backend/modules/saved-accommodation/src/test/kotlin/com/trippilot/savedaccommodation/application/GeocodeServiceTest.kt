package com.trippilot.savedaccommodation.application

import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.savedaccommodation.domain.GeocodeCandidate
import com.trippilot.savedaccommodation.domain.PlaceSearchPort
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain

/**
 * 등록용 지오코딩(e05).
 *
 * 실패가 여기까지 올라오는 이유는 화면이 **핀 직접 지정 폴백**을 띄워야 하기 때문이다(BR-U1-23).
 * 빈 목록으로 접으면 그 폴백이 뜨지 않는다 — 사용자는 "그런 숙소가 없나 보다" 하고 계속 다시 친다.
 */
class GeocodeServiceTest : StringSpec({

    class Search(
        private val result: List<GeocodeCandidate> = emptyList(),
        private val failure: UpstreamUnavailable? = null,
        private val address: String? = null,
    ) : PlaceSearchPort {
        var calls = 0
        override fun geocode(query: String): List<GeocodeCandidate> {
            calls++
            failure?.let { throw it }
            return result
        }

        override fun reverseGeocode(lat: Double, lng: Double): String? {
            calls++
            failure?.let { throw it }
            return address
        }
    }

    val candidate = GeocodeCandidate("제주신라호텔", "서귀포시 중문관광로", 33.2496, 126.4108)

    "찾은 후보를 그대로 돌려준다" {
        GeocodeService(Search(listOf(candidate))).geocode("제주신라호텔") shouldHaveSize 1
    }

    "빈 질의는 검색하지 않는다" {
        val search = Search(listOf(candidate))
        GeocodeService(search).geocode("") shouldHaveSize 0
        search.calls shouldBe 0
    }

    "벤더 장애는 삼키지 않고 핀 지정 안내와 함께 올린다" {
        val upstream = UpstreamUnavailable(source = "kakao-local", fallbackApplied = false)
        val e = shouldThrow<UpstreamUnavailable> {
            GeocodeService(Search(failure = upstream)).geocode("제주신라호텔")
        }
        // 사용자가 다음에 무엇을 할 수 있는지가 문구에 있어야 한다 — 그게 폴백의 실체다.
        e.message.orEmpty() shouldContain "직접 지정"
        e.source shouldBe "kakao-local"
        // 좌표를 지어내 등록시키면 일정 전체가 어긋난 좌표 위에서 만들어진다.
        e.fallbackApplied shouldBe false
    }

    // 핀 지정 탭 — 좌표는 사용자가 이미 정했고 여기서는 주소만 붙인다.
    "역지오코딩은 주소를 그대로 돌려준다" {
        GeocodeService(Search(address = "제주특별자치도 제주시 첨단로 242"))
            .reverseGeocode(33.4996, 126.5312) shouldBe "제주특별자치도 제주시 첨단로 242"
    }

    // 바다 위 등 — 조회는 됐고 주소가 없는 것이다. 예외로 만들면 화면이 장애로 오해한다.
    "주소가 없는 좌표는 null" {
        GeocodeService(Search(address = null)).reverseGeocode(33.0, 130.0).shouldBeNull()
    }

    /**
     * 여기 문구가 지도검색과 다른 이유: 핀 지정은 **이미 폴백 경로**라 "핀을 찍어 보세요"가 말이 안 된다.
     * 사용자가 실제로 할 수 있는 다음 행동은 이름을 직접 입력하고 등록을 계속하는 것이다 —
     * 등록에 필요한 좌표는 이미 손에 있다(BR-U1-22).
     */
    "역지오코딩 장애는 이름 직접 입력 안내와 함께 올린다" {
        val upstream = UpstreamUnavailable(source = "kakao-local", fallbackApplied = false)
        val e = shouldThrow<UpstreamUnavailable> {
            GeocodeService(Search(failure = upstream)).reverseGeocode(33.4996, 126.5312)
        }
        e.message.orEmpty() shouldContain "직접 입력"
        e.fallbackApplied shouldBe false
    }
})
