package com.trippilot.affiliatelink.adapter.out.external

import com.trippilot.affiliatelink.domain.OtaDeeplinkPort
import com.trippilot.affiliatelink.domain.OutboundLink
import com.trippilot.affiliatelink.domain.OutboundQuery
import com.trippilot.affiliatelink.domain.OutboundStay
import jakarta.annotation.PostConstruct
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * 웹검색 폴백 — FE `stayOutbound.ts` 의 `"{숙소명} 예약"` 검색 URL 생성을 서버로 이식(칸 1).
 * BR-U1-31 이 "장소 검색 우회"를 명시 허용한다. 날짜·인원·clickId 는 여기서 쓸 곳이 없다 —
 * 검색엔진에 실을 자리가 없고, 전환 추적도 계약 후 벤더 어댑터(칸 3)의 일이다.
 */
@Component
class WebSearchFallbackAdapter : OtaDeeplinkPort {
    override fun buildOutbound(stay: OutboundStay, query: OutboundQuery, clickId: UUID): OutboundLink =
        OutboundLink(
            url = "https://www.google.com/search?q=" +
                URLEncoder.encode("${stay.name} 예약", StandardCharsets.UTF_8),
            vendor = VENDOR,
        )

    companion object {
        const val VENDOR = "WEBSEARCH"
    }
}

/**
 * 어떤 제휴 경로로 떴는지 기동 로그에 남긴다(선례: StayContentModeAnnouncer).
 * 폴백으로 떠 있으면 "수수료 없는 이동"이라는 것을 말하는 것이 이 줄의 값이다 —
 * tripcom 을 켤 수 있게 된 뒤에도 폴백이면 수수료가 조용히 새는 상태다.
 */
@Component
class AffiliateModeAnnouncer(
    private val port: OtaDeeplinkPort,
    @param:Value("\${trippilot.affiliate.mode:fallback}") private val mode: String,
) {
    @PostConstruct
    fun announce() {
        if (port is TripcomDeeplinkAdapter) {
            log.info("제휴 아웃바운드 = 트립닷컴 딥링크 · 구현={} — 수수료 추적(trip_sub1) 이 붙는다", port.javaClass.simpleName)
        } else {
            log.info("제휴 아웃바운드 = 웹검색 폴백 · 구현={} — 수수료 없는 이동이다", port.javaClass.simpleName)
        }
        // 아는 값이 아니면 조건부 빈이 안 걸려 폴백으로 남는다 — 설정 의도와 결과가 다르다는 뜻이다.
        if (!mode.equals("fallback", ignoreCase = true) && !mode.equals("tripcom", ignoreCase = true)) {
            log.warn("trippilot.affiliate.mode='{}' 는 아는 값이 아닙니다(fallback|tripcom) — 폴백으로 동작합니다.", mode)
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(AffiliateModeAnnouncer::class.java)
    }
}
