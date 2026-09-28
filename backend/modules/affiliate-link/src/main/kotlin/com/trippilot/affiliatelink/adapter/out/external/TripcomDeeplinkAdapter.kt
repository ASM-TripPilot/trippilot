package com.trippilot.affiliatelink.adapter.out.external

import com.trippilot.affiliatelink.domain.OtaDeeplinkPort
import com.trippilot.affiliatelink.domain.OutboundLink
import com.trippilot.affiliatelink.domain.OutboundQuery
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
) : OtaDeeplinkPort {
    init {
        // tripcom 인데 트래킹 ID 가 비면 기동을 막는다(WEATHER kma 선례) — 조용히 뜨면
        // 모든 이동이 수수료 없는 트립닷컴 직행이 되어, 켠 의도와 정반대로 돈다.
        require(allianceId.isNotBlank() && sid.isNotBlank()) {
            "trippilot.affiliate.mode=tripcom 인데 alliance-id/sid 가 비었습니다 — " +
                "TRIPCOM_ALLIANCE_ID·TRIPCOM_SID 를 넣거나 mode 를 fallback 으로 두세요."
        }
    }

    override fun buildOutbound(stay: OutboundStay, query: OutboundQuery, clickId: UUID): OutboundLink =
        OutboundLink(
            url = "https://kr.trip.com/global-search/searchlist/search/" +
                "?keyword=" + URLEncoder.encode(stay.name, StandardCharsets.UTF_8) +
                "&allianceid=" + allianceId +
                "&sid=" + sid +
                "&trip_sub1=" + clickId,
            vendor = VENDOR,
        )

    companion object {
        const val VENDOR = "TRIPCOM"
    }
}
