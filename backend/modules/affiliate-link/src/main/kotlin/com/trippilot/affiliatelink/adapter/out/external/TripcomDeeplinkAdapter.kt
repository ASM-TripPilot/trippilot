package com.trippilot.affiliatelink.adapter.out.external

import com.trippilot.accommodationsearch.api.TRIPCOM_STAY_SOURCE
import com.trippilot.affiliatelink.domain.OtaDeeplinkPort
import com.trippilot.affiliatelink.domain.OutboundLink
import com.trippilot.affiliatelink.domain.OutboundQuery
import com.trippilot.affiliatelink.domain.OutboundRegion
import com.trippilot.affiliatelink.domain.OutboundStay
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Primary
import org.springframework.stereotype.Component
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * 트립닷컴 딥링크 — 키워드 검색결과 착지(칸 3 축소판, 2026-09-29 어필리에이트 승인 후).
 *
 * `trippilot.affiliate.mode=tripcom` 으로 켠다(선례: `DbContentAdapter` 가 @Primary 로 이긴다).
 *
 * **숙소 ID 매핑 없이 간다.** 설계가 "숨은 최대 작업"으로 지목한 우리 stay ↔ 트립닷컴 호텔 ID
 * 매핑을 건너뛰고, 이름 키워드 검색결과 페이지(`/global-search/searchlist/search/`)에 착지한다 —
 * 생성기 실링크를 풀어 실측한 구조다(2026-09-29, Allianceid·SID·trip_sub1 이 URL 파라미터로
 * 관통하고 페이지 이동에도 살아남는 것 확인). 호텔 페이지 직행은 매핑이 생기는 칸 3 본편의 몫이다.
 * 예외: 트립닷컴 큐레이션 숙소(`TRIPCOM:{hotelId}`)는 매핑이 이미 있으므로 호텔 상세로 직행한다.
 *
 * [clickId] 는 `trip_sub1` 에 관통한다 — 전환 리포트가 이 값을 되돌려 줘 클릭↔예약을 잇는
 * 자리다(칸 2 포스트백의 전제). 날짜·인원은 이 페이지가 받지 않아 URL 에 싣지 않는다 —
 * 클릭 행에는 남는다.
 */
@Component
@Primary
@ConditionalOnProperty(name = ["trippilot.affiliate.mode"], havingValue = "tripcom")
class TripcomDeeplinkAdapter(
    @param:Value("\${trippilot.affiliate.tripcom.alliance-id:}") private val allianceId: String,
    @param:Value("\${trippilot.affiliate.tripcom.sid:}") private val sid: String,
    /**
     * 생성기에 등록된 링크의 Ad ID(trip_sub3 자리) — **이것이 귀속의 열쇠다**(2026-10-01 실측).
     * alliance·sid·sub1 만 실은 조립 URL 의 probe 클릭은 전부 미귀속이었고, 같은 URL 에
     * 이 값이 실린 클릭(probe4gen)만 대시보드에 잡혔다. 비면 수수료가 조용히 새므로 함께 필수다.
     */
    @param:Value("\${trippilot.affiliate.tripcom.ad-id:}") private val adId: String,
) : OtaDeeplinkPort {
    init {
        // tripcom 인데 트래킹 ID 가 비면 기동을 막는다(WEATHER kma 선례) — 조용히 뜨면
        // 모든 이동이 수수료 없는 트립닷컴 직행이 되어, 켠 의도와 정반대로 돈다.
        require(allianceId.isNotBlank() && sid.isNotBlank() && adId.isNotBlank()) {
            "trippilot.affiliate.mode=tripcom 인데 alliance-id/sid/ad-id 가 비었습니다 — " +
                "TRIPCOM_ALLIANCE_ID·TRIPCOM_SID·TRIPCOM_AD_ID 를 넣거나 mode 를 fallback 으로 두세요."
        }
    }

    override fun buildOutbound(stay: OutboundStay, query: OutboundQuery, clickId: UUID): OutboundLink {
        val hotelId = stay.stayId.removePrefix("$TRIPCOM_STAY_SOURCE:").takeIf { it != stay.stayId }
        val url = if (hotelId != null) {
            // 큐레이션 숙소 — 식별자가 곧 트립닷컴 hotelId 라 호텔 상세로 직행한다. 이 페이지는 날짜·인원을
            // 받는다(2026-10-16 실측: 리다이렉트 없이 반영, 제휴 파라미터 유지).
            "https://kr.trip.com/hotels/detail/?hotelId=" + URLEncoder.encode(hotelId, StandardCharsets.UTF_8) +
                stayParams(query, checkIn = "checkIn", checkOut = "checkOut") + tracking(clickId)
        } else {
            keywordSearch(stay.name, clickId)
        }
        return OutboundLink(url = url, vendor = VENDOR)
    }

    override fun buildRegionOutbound(region: OutboundRegion, query: OutboundQuery, clickId: UUID): OutboundLink {
        val cityId = region.regionCode?.let { cityIdOf(it) }
        val url = if (cityId != null) {
            // 도시 목록 — 날짜·인원이 채워진 트립닷컴 숙소 목록(2026-10-16 실측: 서울·강릉·제주시·광주
            // 리다이렉트 없이 날짜 반영). 이 페이지의 날짜 파라미터는 소문자다(상세와 다르다).
            "https://kr.trip.com/hotels/list?city=$cityId" +
                stayParams(query, checkIn = "checkin", checkOut = "checkout") + "&crn=1" + tracking(clickId)
        } else {
            // 매핑 없는 지역은 이름 키워드 — 날짜는 못 싣지만 그 지역 숙소로는 간다.
            keywordSearch(region.name, clickId)
        }
        return OutboundLink(url = url, vendor = VENDOR)
    }

    private fun keywordSearch(keyword: String, clickId: UUID) =
        "https://kr.trip.com/global-search/searchlist/search/" +
            "?keyword=" + URLEncoder.encode(keyword, StandardCharsets.UTF_8) + tracking(clickId)

    private fun tracking(clickId: UUID) =
        "&allianceid=" + allianceId + "&sid=" + sid + "&trip_sub1=" + clickId + "&trip_sub3=" + adId

    /**
     * 날짜는 둘 다 있고 순서가 맞을 때만, 인원은 양수일 때만 싣는다 — 한쪽만·역전이면 트립닷컴이 임의로
     * 고친 날짜를 사용자가 자기 일정으로 믿는다.
     */
    private fun stayParams(query: OutboundQuery, checkIn: String, checkOut: String): String =
        (if (query.checkIn != null && query.checkOut != null && query.checkOut > query.checkIn) "&$checkIn=${query.checkIn}&$checkOut=${query.checkOut}" else "") +
            (query.adults?.takeIf { it > 0 }?.let { "&adult=$it" } ?: "")

    companion object {
        const val VENDOR = "TRIPCOM"

        /**
         * 지역 카탈로그 코드 접두사 → 트립닷컴 city ID. **가장 긴 접두사가 이긴다**(제주 `50` < 서귀포 `5013`).
         *
         * 시군구는 앞 4자리로 잡는다 — 구가 있는 시는 구 코드가 시 코드와 앞 4자리를 공유한다
         * (포항 47110 · 남구 47111 · 북구 47113). ID 는 `kr.trip.com/hotels/cheap/city/kr/{slug}.html` 의
         * cityId 실측(2026-10-16). 여기 없는 지역은 키워드 검색으로 간다 — 세종·남해·가평·파주·태안·단양은
         * 도시 페이지를 못 찾았다.
         */
        val CITY_IDS: Map<String, Int> = mapOf(
            "11" to 274,      // 서울
            "26" to 253,      // 부산
            "27" to 1287,     // 대구
            "28" to 410,      // 인천
            "30" to 61292,    // 대전
            "31" to 3368,     // 울산
            "50" to 737,      // 제주(도 단위 → 제주시)
            "5011" to 737,    // 제주시
            "5013" to 35796,  // 서귀포시
            "1221" to 738, "1224" to 738, "1227" to 738, "1230" to 738, "1233" to 738, // 광주 5개 구
            "1211" to 3986,   // 목포
            "1213" to 4016,   // 여수
            "1215" to 61663,  // 순천
            "4111" to 5980,   // 수원
            "4415" to 88099,  // 공주
            "4418" to 61232,  // 보령
            "4711" to 3369,   // 포항
            "4713" to 3675,   // 경주
            "4717" to 61163,  // 안동
            "4812" to 35787,  // 창원
            "4822" to 72366,  // 통영
            "4831" to 61331,  // 거제
            "5111" to 35788,  // 춘천
            "5113" to 72358,  // 원주
            "5115" to 61325,  // 강릉
            "5121" to 35793,  // 속초
            "5176" to 35792,  // 평창
            "5183" to 6430,   // 양양
            "5211" to 61380,  // 전주
            "5213" to 7254,   // 군산
        )

        fun cityIdOf(regionCode: String): Int? =
            CITY_IDS.entries.filter { regionCode.startsWith(it.key) }.maxByOrNull { it.key.length }?.value
    }
}
