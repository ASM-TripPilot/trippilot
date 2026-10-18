package com.trippilot.affiliatelink.application

import com.trippilot.accommodationsearch.api.StayLookupFacade
import com.trippilot.affiliatelink.domain.OtaDeeplinkPort
import com.trippilot.affiliatelink.domain.OutboundClick
import com.trippilot.affiliatelink.domain.OutboundClickPort
import com.trippilot.affiliatelink.domain.OutboundLink
import com.trippilot.affiliatelink.domain.OutboundQuery
import com.trippilot.affiliatelink.domain.OutboundRegion
import com.trippilot.affiliatelink.domain.OutboundStay
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.placedata.api.RegionLookupFacade
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
    private val regions: RegionLookupFacade,
    private val clock: Clock,
) {
    fun outbound(accountId: UUID?, stayId: String, query: OutboundQuery): OutboundLink {
        val name = stays.findName(stayId) ?: throw ResourceNotFound()
        val clickId = UUID.randomUUID()
        val link = deeplink.buildOutbound(OutboundStay(stayId, name), query, clickId)
        record(clickId, accountId, stayId, link, query)
        return link
    }

    /**
     * 지역 숙소 전체 보기 — OTA 의 지역 목록으로 보낸다(앱은 숙소 목록을 갖지 않는다).
     * 클릭의 stay_id 자리에는 `"REGION:{코드 또는 이름}"` 을 남긴다 — 숙소 클릭과 한 표에서 갈린다.
     */
    fun regionOutbound(accountId: UUID?, regionCode: String?, regionName: String, query: OutboundQuery): OutboundLink {
        val name = regionName.trim()
        val code = regionCode?.trim()?.takeIf { it.isNotEmpty() }
        // 지역 카탈로그에 있는 것만 받는다 — 익명·무제한 경로라 자유 문자열을 그대로 받으면 클릭 지표가 오염된다.
        // 코드가 오면 코드로(동명이지역이 없다), 없으면 이름이 카탈로그에 있어야 한다.
        val known = if (code != null) {
            CODE.matches(code) && regions.isSelectableCode(code)
        } else {
            name.length <= MAX_REGION_NAME && regions.codesOf(name).isNotEmpty()
        }
        if (name.isEmpty() || name.length > MAX_REGION_NAME || !known) {
            throw ValidationFailed(listOf(FieldError("region", "지역 카탈로그에 있는 지역 이름·코드로 요청하세요.")))
        }
        val clickId = UUID.randomUUID()
        val link = deeplink.buildRegionOutbound(OutboundRegion(code, name), query, clickId)
        record(clickId, accountId, "$REGION_PREFIX${code ?: name}", link, query)
        return link
    }

    private fun record(clickId: UUID, accountId: UUID?, stayId: String, link: OutboundLink, query: OutboundQuery) {
        // 기록 실패가 이동을 막지 않는다 — 막으면 사용자에겐 "예약 버튼이 안 눌리는" 장애다.
        // 침묵도 아니다(INV-4): 에러 로그가 남고, 클릭 한 건 유실은 이동 실패보다 싸다.
        runCatching {
            clicks.record(OutboundClick(clickId, accountId, stayId, link.vendor, query, clock.instant()))
        }.onFailure { log.error("아웃바운드 클릭 기록 실패 — 이동은 계속한다. stayId={}", stayId, it) }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(OutboundService::class.java)
        private const val REGION_PREFIX = "REGION:"
        private const val MAX_REGION_NAME = 40 // affiliate_click.stay_id(120) 안에 접두사와 함께 들어간다
        private val CODE = Regex("^[0-9]{2,10}$")
    }
}
