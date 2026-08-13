package com.trippilot.savedaccommodation.application

import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.savedaccommodation.domain.GeocodeCandidate
import com.trippilot.savedaccommodation.domain.PlaceSearchPort
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldHaveSize
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
    ) : PlaceSearchPort {
        var calls = 0
        override fun geocode(query: String): List<GeocodeCandidate> {
            calls++
            failure?.let { throw it }
            return result
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
})
