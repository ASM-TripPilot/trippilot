package com.trippilot.affiliatelink.application

import com.trippilot.accommodationsearch.api.StayLookupFacade
import com.trippilot.affiliatelink.domain.OtaDeeplinkPort
import com.trippilot.affiliatelink.domain.OutboundClick
import com.trippilot.affiliatelink.domain.OutboundClickPort
import com.trippilot.affiliatelink.domain.OutboundLink
import com.trippilot.affiliatelink.domain.OutboundQuery
import com.trippilot.affiliatelink.domain.OutboundStay
import com.trippilot.core.error.ResourceNotFound
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.Clock
import java.util.UUID

/**
 * 아웃바운드 302 (칸 1) — 클릭을 적고 목적지 링크를 돌려준다.
 *
 * 형식 오류 stayId 는 400(StayKey.parse, 퍼사드 안), 없는 숙소는 404 — 이름 없이는
 * 어떤 목적지도 만들 수 없어 폴백조차 성립하지 않는다.
 */
@Service
class OutboundService(
    private val stays: StayLookupFacade,
    private val deeplink: OtaDeeplinkPort,
    private val clicks: OutboundClickPort,
    private val clock: Clock,
) {
    fun outbound(accountId: UUID, stayId: String, query: OutboundQuery): OutboundLink {
        val name = stays.findName(stayId) ?: throw ResourceNotFound()
        val clickId = UUID.randomUUID()
        val link = deeplink.buildOutbound(OutboundStay(stayId, name), query, clickId)
        // 기록 실패가 이동을 막지 않는다 — 막으면 사용자에겐 "예약 버튼이 안 눌리는" 장애다.
        // 침묵도 아니다(INV-4): 에러 로그가 남고, 클릭 한 건 유실은 이동 실패보다 싸다.
        runCatching {
            clicks.record(OutboundClick(clickId, accountId, stayId, link.vendor, query, clock.instant()))
        }.onFailure { log.error("아웃바운드 클릭 기록 실패 — 이동은 계속한다. stayId={}", stayId, it) }
        return link
    }

    private companion object {
        private val log = LoggerFactory.getLogger(OutboundService::class.java)
    }
}
