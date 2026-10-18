package com.trippilot.affiliatelink.adapter.out.external

import com.trippilot.affiliatelink.domain.OutboundQuery
import com.trippilot.affiliatelink.domain.OutboundRegion
import com.trippilot.affiliatelink.domain.OutboundStay
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.LocalDate
import java.util.UUID

/**
 * 트립닷컴 키워드 딥링크(칸 3 축소판).
 *
 * URL 을 **리터럴로 완전일치** 잠근다 — 파라미터 이름(allianceid·sid·trip_sub1·trip_sub3)은 트립닷컴이
 * 정한 계약이라 한 글자만 틀려도 수수료 추적이 조용히 끊긴다(실링크 실측 구조, 2026-09-29).
 */
class TripcomDeeplinkAdapterTest : StringSpec({

    val clickId = UUID.fromString("11111111-2222-3333-4444-555555555555")

    "키워드 검색결과 URL — 트래킹 4종이 그대로 박힌다" {
        val link = TripcomDeeplinkAdapter(allianceId = "10768080", sid = "332381302", adId = "D20021458")
            .buildOutbound(OutboundStay("STUB:jeju-001", "제주 오션 리조트"), OutboundQuery(), clickId)

        link.url shouldBe "https://kr.trip.com/global-search/searchlist/search/" +
            "?keyword=%EC%A0%9C%EC%A3%BC+%EC%98%A4%EC%85%98+%EB%A6%AC%EC%A1%B0%ED%8A%B8" +
            "&allianceid=10768080&sid=332381302" +
            "&trip_sub1=11111111-2222-3333-4444-555555555555" +
            "&trip_sub3=D20021458"
        link.vendor shouldBe TripcomDeeplinkAdapter.VENDOR
    }

    "트래킹 ID 가 비면 생성 자체가 실패한다 — 조용히 뜨면 수수료 없는 직행이 된다" {
        shouldThrow<IllegalArgumentException> { TripcomDeeplinkAdapter(allianceId = "", sid = "332381302", adId = "D1") }
        shouldThrow<IllegalArgumentException> { TripcomDeeplinkAdapter(allianceId = "10768080", sid = "", adId = "D1") }
        // ad-id 는 귀속의 열쇠다 — 없이 뜨면 모든 클릭이 미귀속으로 샌다(probe 실측).
        shouldThrow<IllegalArgumentException> { TripcomDeeplinkAdapter(allianceId = "10768080", sid = "332381302", adId = "") }
    }
    val adapter = TripcomDeeplinkAdapter(allianceId = "10768080", sid = "332381302", adId = "D20021458")
    val tracking = "&allianceid=10768080&sid=332381302&trip_sub1=11111111-2222-3333-4444-555555555555&trip_sub3=D20021458"
    val curated = OutboundStay("TRIPCOM:4645968", "호텔 베뉴지")

    "큐레이션 숙소(TRIPCOM:)는 호텔 상세로 직행한다 — 여행 날짜·인원이 실린다" {
        val link = adapter.buildOutbound(
            curated,
            OutboundQuery(LocalDate.parse("2026-11-12"), LocalDate.parse("2026-11-13"), adults = 2),
            clickId,
        )
        link.url shouldBe "https://kr.trip.com/hotels/detail/?hotelId=4645968" +
            "&checkIn=2026-11-12&checkOut=2026-11-13&adult=2" + tracking
        link.vendor shouldBe TripcomDeeplinkAdapter.VENDOR
    }

    "날짜가 없으면 호텔 상세만 — 트래킹은 그대로 붙는다" {
        adapter.buildOutbound(curated, OutboundQuery(), clickId).url shouldBe
            "https://kr.trip.com/hotels/detail/?hotelId=4645968" + tracking
    }

    "날짜가 한쪽만이거나 역전이면 싣지 않는다 — 트립닷컴이 고친 날짜를 사용자가 자기 일정으로 믿는다" {
        val d = LocalDate.parse("2026-11-12")
        adapter.buildOutbound(curated, OutboundQuery(checkIn = d), clickId).url shouldBe
            "https://kr.trip.com/hotels/detail/?hotelId=4645968" + tracking
        adapter.buildOutbound(curated, OutboundQuery(checkIn = d, checkOut = d), clickId).url shouldBe
            "https://kr.trip.com/hotels/detail/?hotelId=4645968" + tracking
        adapter.buildOutbound(curated, OutboundQuery(checkIn = d.plusDays(1), checkOut = d, adults = 0), clickId).url shouldBe
            "https://kr.trip.com/hotels/detail/?hotelId=4645968" + tracking
    }

    "정본 숙소는 여전히 키워드 검색 — 출처 접두사만 같은 다른 문자열에 속지 않는다" {
        adapter.buildOutbound(OutboundStay("TRIPCOMX:1", "가"), OutboundQuery(), clickId).url shouldBe
            "https://kr.trip.com/global-search/searchlist/search/?keyword=%EA%B0%80" + tracking
    }
    val trip = OutboundQuery(LocalDate.parse("2026-11-12"), LocalDate.parse("2026-11-13"), adults = 2)

    "지역 전체 보기 — 매핑된 지역은 트립닷컴 도시 목록, 날짜는 소문자 파라미터로" {
        adapter.buildRegionOutbound(OutboundRegion("47110", "포항"), trip, clickId).url shouldBe
            "https://kr.trip.com/hotels/list?city=3369&checkin=2026-11-12&checkout=2026-11-13&adult=2&crn=1" + tracking
    }

    "구 코드도 시의 도시로 간다 — 앞 4자리를 공유한다" {
        adapter.buildRegionOutbound(OutboundRegion("47113", "포항시 북구"), OutboundQuery(), clickId).url shouldBe
            "https://kr.trip.com/hotels/list?city=3369&crn=1" + tracking
    }

    "가장 긴 접두사가 이긴다 — 서귀포는 제주(도)가 아니라 서귀포로" {
        TripcomDeeplinkAdapter.cityIdOf("50130") shouldBe 35796
        TripcomDeeplinkAdapter.cityIdOf("50") shouldBe 737
        TripcomDeeplinkAdapter.cityIdOf("11680") shouldBe 274
    }

    "매핑 없는 지역·코드 없는 지역은 이름 키워드 검색 — 날짜는 못 싣는다" {
        val keyword = "https://kr.trip.com/global-search/searchlist/search/?keyword=%EC%84%B8%EC%A2%85" + tracking
        adapter.buildRegionOutbound(OutboundRegion("36110", "세종"), trip, clickId).url shouldBe keyword
        adapter.buildRegionOutbound(OutboundRegion(null, "세종"), trip, clickId).url shouldBe keyword
    }
})
