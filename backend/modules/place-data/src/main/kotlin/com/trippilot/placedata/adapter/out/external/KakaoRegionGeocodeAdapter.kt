package com.trippilot.placedata.adapter.out.external

import com.trippilot.placedata.domain.GeoPoint
import com.trippilot.placedata.domain.RegionGeocodePort
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Primary
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient

/**
 * 카카오 로컬 지오코딩 어댑터 — **kakao 모드에서만 활성**(기본은 스텁).
 *
 * 인증은 REST API 키다: `Authorization: KakaoAK {키}`. 카카오 로그인의 `client_id` 와 **같은 키**이며,
 * 콘솔에서 카카오맵(OPEN_MAP_AND_LOCAL) 서비스가 켜져 있어야 한다 — 꺼져 있으면 403 이다(실측).
 *
 * 실패를 삼키지 않고 예외로 올린다. 호출측이 "확인하지 못함"으로 다루고, 그 사실이 화면까지 간다(INV-4).
 */
@Component
@Primary
@ConditionalOnProperty(name = ["trippilot.place.geocode.mode"], havingValue = "kakao")
class KakaoRegionGeocodeAdapter(
    @Value("\${trippilot.social.kakao.client-id:}") private val restApiKey: String,
    @param:Qualifier(KakaoLocalClientConfiguration.BEAN_NAME) private val client: RestClient,
) : RegionGeocodePort {

    override fun searchAddress(query: String) = search("/v2/local/search/address.json", query)

    private fun search(path: String, query: String): List<GeoPoint> {
        val body = client.get()
            .uri { it.path(path).queryParam("query", query).queryParam("size", PAGE_SIZE).build() }
            .header("Authorization", "KakaoAK $restApiKey")
            .retrieve()
            .body(KakaoLocalResponse::class.java)
        // 좌표가 없는 문서는 판정에 쓸 수 없다 — 있는 것만 남긴다.
        return body?.documents.orEmpty().mapNotNull { doc ->
            val lng = doc.x?.toDoubleOrNull()
            val lat = doc.y?.toDoubleOrNull()
            if (lat == null || lng == null) null else GeoPoint(lat, lng)
        }
    }

    private companion object {
        /** 판정에는 첫 결과면 충분하다 — 응답을 키우지 않는다. */
        private const val PAGE_SIZE = 1
    }
}

/** 카카오 로컬 응답 — 판정에 쓰는 좌표만 받는다(`x`=경도, `y`=위도). */
internal data class KakaoLocalResponse(val documents: List<KakaoLocalDocument> = emptyList())

internal data class KakaoLocalDocument(val x: String? = null, val y: String? = null)
