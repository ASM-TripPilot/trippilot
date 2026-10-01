package com.trippilot.affiliatelink.adapter.out.external

import com.trippilot.affiliatelink.domain.OutboundQuery
import com.trippilot.affiliatelink.domain.OutboundStay
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
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
})
