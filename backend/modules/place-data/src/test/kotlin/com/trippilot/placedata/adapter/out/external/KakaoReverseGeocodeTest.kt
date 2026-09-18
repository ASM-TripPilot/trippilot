package com.trippilot.placedata.adapter.out.external

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.queryParam
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import org.springframework.web.util.UriComponentsBuilder

/**
 * 카카오 `coord2address` 와이어 매핑 — 외부 호출 0.
 *
 * **여기서만 잡히는 실패는 좌표 순서다.** 카카오는 `x`=경도·`y`=위도인데 우리 시그니처는 `(lat, lng)` 라
 * 뒤집기 쉽다. 뒤집어도 **200 이 오고 주소도 온다** — 엉뚱한 나라의 주소가. 예외가 없으니 조용히 틀린다.
 */
class KakaoReverseGeocodeTest : StringSpec({

    // baseUrl 은 [KakaoLocalClientConfiguration] 이 소유한다 — 어댑터가 더는 직접 걸지 않으므로
    // 테스트도 같은 상수를 쓴다. 여기에 다른 값을 박으면 아래 requestTo 매처가 조용히 안 맞는다.
    fun fixture(): Pair<KakaoPlaceLookupAdapter, MockRestServiceServer> {
        val builder = RestClient.builder().baseUrl(KakaoLocalClientConfiguration.BASE_URL)
        val server = MockRestServiceServer.bindTo(builder).build()
        return KakaoPlaceLookupAdapter("test-key", builder.build()) to server
    }

    fun uri(lat: Double, lng: Double): String =
        UriComponentsBuilder.fromUriString("https://dapi.kakao.com/v2/local/geo/coord2address.json")
            .queryParam("x", lng).queryParam("y", lat).build().toUriString()

    val jeju = 33.4996 to 126.5312

    "경도가 x · 위도가 y 로 나간다 — 뒤집으면 엉뚱한 곳의 주소가 200 으로 온다" {
        val (adapter, server) = fixture()
        server.expect(requestTo(uri(jeju.first, jeju.second)))
            .andExpect(queryParam("x", "126.5312"))   // 경도
            .andExpect(queryParam("y", "33.4996"))    // 위도
            .andRespond(
                withSuccess(
                    """{"documents":[{"road_address":{"address_name":"제주특별자치도 제주시 첨단로 242"}}]}""",
                    MediaType.APPLICATION_JSON,
                ),
            )

        adapter.reverseGeocode(jeju.first, jeju.second)?.address shouldBe "제주특별자치도 제주시 첨단로 242"
        server.verify()
    }

    // 시골 펜션·민박은 도로명이 없고 지번만 있다 — 폴백이 없으면 그런 자리에 핀을 찍었을 때 주소가 사라진다.
    "도로명이 없으면 지번으로 떨어진다" {
        val (adapter, server) = fixture()
        server.expect(requestTo(uri(jeju.first, jeju.second))).andRespond(
            withSuccess(
                """{"documents":[{"road_address":null,"address":{"address_name":"제주특별자치도 제주시 아라동 1"}}]}""",
                MediaType.APPLICATION_JSON,
            ),
        )

        adapter.reverseGeocode(jeju.first, jeju.second)?.address shouldBe "제주특별자치도 제주시 아라동 1"
    }

    "둘 다 있으면 도로명이 이긴다 — 사람이 읽기 쉽다" {
        val (adapter, server) = fixture()
        server.expect(requestTo(uri(jeju.first, jeju.second))).andRespond(
            withSuccess(
                """{"documents":[{"road_address":{"address_name":"첨단로 242"},"address":{"address_name":"아라동 1"}}]}""",
                MediaType.APPLICATION_JSON,
            ),
        )

        adapter.reverseGeocode(jeju.first, jeju.second)?.address shouldBe "첨단로 242"
    }

    // 바다 위 좌표 — 카카오는 200 + 빈 documents 를 준다. 이건 장애가 아니라 사실이다.
    "주소가 없는 좌표는 빈 documents 로 오고 null 이 된다" {
        val (adapter, server) = fixture()
        server.expect(requestTo(uri(33.0, 130.0)))
            .andRespond(withSuccess("""{"documents":[]}""", MediaType.APPLICATION_JSON))

        adapter.reverseGeocode(33.0, 130.0).shouldBeNull()
    }

    // 문서는 왔는데 주소 칸이 빈 경우 — 빈 문자열을 주소로 내보내면 화면에 빈 줄이 그려진다.
    "주소 문자열이 비어 있으면 null 로 본다" {
        val (adapter, server) = fixture()
        server.expect(requestTo(uri(jeju.first, jeju.second))).andRespond(
            withSuccess(
                """{"documents":[{"road_address":{"address_name":"  "},"address":{"address_name":""}}]}""",
                MediaType.APPLICATION_JSON,
            ),
        )

        adapter.reverseGeocode(jeju.first, jeju.second).shouldBeNull()
    }
})
