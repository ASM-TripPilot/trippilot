package com.trippilot.placedata.adapter.out.external

import com.fasterxml.jackson.annotation.JsonProperty
import com.trippilot.placedata.domain.PlaceAddress
import com.trippilot.placedata.domain.PlaceLocation
import com.trippilot.placedata.domain.PlaceLookupPort
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Primary
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient

/**
 * 카카오 로컬 장소 검색 어댑터 — **kakao 모드에서만 활성**(기본은 스텁).
 * 스위치는 [KakaoRegionGeocodeAdapter] 와 같은 `trippilot.place.geocode.mode` 다 —
 * 같은 벤더·같은 키라 노브를 나누면 "지역은 실물, 장소는 스텁" 같은 상태가 생긴다.
 *
 * **키워드 검색이 1차다.** 사용자는 `제주신라호텔` 처럼 상호를 치는데 주소검색으로는 0건이다.
 *
 * **주소 폴백을 지우지 마라 — 도로명만 보면 필요 없어 보인다.** 도로명 주소(`제주시 첨단로 242`)는
 * 근처 상호가 잡혀 키워드로도 나온다. 하지만 **지번 주소는 키워드가 0건**이고 주소검색만 구한다
 * (실측: `서귀포시 성산읍 고성리 300`·`통영시 산양읍 연화리 470`·`강릉시 사천면 사천진리 100-3`).
 * 시골 펜션·민박은 상호가 벤더에 없고 지번만 있어, 이 경로가 없으면 그런 숙소를 등록할 수 없다.
 *
 * 두 경로가 겹치는 질의는 키워드 결과가 이긴다 — 이름이 있는 편이 후보 목록에서 고르기 쉽다.
 *
 * 실패를 삼키지 않고 예외로 올린다. 빈 목록은 "못 찾음"이지 "못 물어봄"이 아니다(BR-U1-23).
 */
@Component
@Primary
@ConditionalOnProperty(name = ["trippilot.place.geocode.mode"], havingValue = "kakao")
class KakaoPlaceLookupAdapter(
    @Value("\${trippilot.social.kakao.client-id:}") private val restApiKey: String,
    restClientBuilder: RestClient.Builder,
) : PlaceLookupPort {

    private val client = restClientBuilder.baseUrl(BASE_URL).build()

    override fun search(query: String): List<PlaceLocation> =
        byKeyword(query).ifEmpty { byAddress(query) }

    private fun byKeyword(query: String): List<PlaceLocation> =
        get("/v2/local/search/keyword.json", query).mapNotNull { doc ->
            doc.point()?.let { (lat, lng) ->
                PlaceLocation(
                    name = doc.placeName ?: return@let null,
                    // 지번만 있는 장소도 있어 도로명이 없으면 지번으로 떨어진다.
                    address = doc.roadAddressName.orEmpty().ifBlank { doc.addressName.orEmpty() },
                    lat = lat,
                    lng = lng,
                )
            }
        }

    /**
     * 좌표 → 주소. 카카오 `coord2address` 는 **행정구역 주소만** 돌려준다(상호 없음).
     *
     * `x`=경도·`y`=위도 순서다 — 뒤집으면 엉뚱한 나라가 나오는데 200 이라 조용히 틀린다.
     * 주소가 없는 좌표(바다·산)는 `documents` 가 빈 배열이고, 이는 정상 응답이라 null 로 옮긴다.
     */
    override fun reverseGeocode(lat: Double, lng: Double): PlaceAddress? {
        val doc = client.get()
            .uri {
                it.path("/v2/local/geo/coord2address.json")
                    .queryParam("x", lng)
                    .queryParam("y", lat)
                    .build()
            }
            .header("Authorization", "KakaoAK $restApiKey")
            .retrieve()
            .body(KakaoCoord2AddressResponse::class.java)
            ?.documents
            ?.firstOrNull()
            ?: return null
        // 도로명이 있으면 그쪽이 사람이 읽기 쉽다. 시골은 지번만 있는 경우가 많아 폴백이 필요하다.
        val address = doc.roadAddress?.addressName?.takeIf { it.isNotBlank() }
            ?: doc.address?.addressName?.takeIf { it.isNotBlank() }
            ?: return null
        return PlaceAddress(address)
    }

    /** 주소검색에는 상호가 없다 — 이름 자리에 주소가 그대로 간다. 지어내지 않는다. */
    private fun byAddress(query: String): List<PlaceLocation> =
        get("/v2/local/search/address.json", query).mapNotNull { doc ->
            val name = doc.addressName ?: return@mapNotNull null
            doc.point()?.let { (lat, lng) -> PlaceLocation(name, name, lat, lng) }
        }

    private fun get(path: String, query: String): List<KakaoPlaceDocument> =
        client.get()
            .uri { it.path(path).queryParam("query", query).queryParam("size", PAGE_SIZE).build() }
            .header("Authorization", "KakaoAK $restApiKey")
            .retrieve()
            .body(KakaoPlaceResponse::class.java)
            ?.documents
            .orEmpty()

    private companion object {
        private const val BASE_URL = "https://dapi.kakao.com"
        /** 후보 선택 UI 가 감당할 만큼만. 전부 받아도 사용자는 위에서 고른다. */
        private const val PAGE_SIZE = 5
    }
}

internal data class KakaoPlaceResponse(val documents: List<KakaoPlaceDocument> = emptyList())

/** `coord2address` 응답 — 문서 한 건에 도로명·지번이 각각(둘 중 하나는 null 일 수 있다). */
internal data class KakaoCoord2AddressResponse(val documents: List<KakaoCoord2AddressDocument> = emptyList())

internal data class KakaoCoord2AddressDocument(
    @param:JsonProperty("road_address") val roadAddress: KakaoAddressName? = null,
    val address: KakaoAddressName? = null,
)

internal data class KakaoAddressName(
    @param:JsonProperty("address_name") val addressName: String? = null,
)

/**
 * 카카오 로컬 문서 — 키워드·주소 응답을 한 타입으로 받는다(주소 응답엔 `place_name` 이 없어 null).
 * `x`=경도, `y`=위도. 좌표가 없는 문서는 후보로 쓸 수 없다.
 */
internal data class KakaoPlaceDocument(
    @param:JsonProperty("place_name") val placeName: String? = null,
    @param:JsonProperty("address_name") val addressName: String? = null,
    @param:JsonProperty("road_address_name") val roadAddressName: String? = null,
    val x: String? = null,
    val y: String? = null,
) {
    fun point(): Pair<Double, Double>? {
        val lat = y?.toDoubleOrNull() ?: return null
        val lng = x?.toDoubleOrNull() ?: return null
        return lat to lng
    }
}
