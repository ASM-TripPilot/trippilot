package com.trippilot.archive.adapter.`in`.event

import com.trippilot.archive.application.ActualRouteService
import com.trippilot.archive.application.LocationAutomationService
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 위치 이용 동의(L2)가 꺼지면 **열린 자동화 구간을 모두 닫고 실제 경로를 전부 지운다** — 무장도 경로 기록도 L2 위에 선다(D4).
 * 기기도 철회 즉시 멈추지만 철회 뒤에는 아무것도 올리지 않으므로(BR-U10-42) END 가 안 올 수 있다.
 *
 * 멱등: 열린 구간만 닫는다 — 두 번 배달돼도 두 번째는 닫을 것이 없고 법정 로그도 남지 않는다.
 * (같은 이벤트를 재계획 모듈도 구독한다 — 릴레이는 구독자마다 배달한다.)
 */
@Component("archiveLocationLegalConsentRevokedSubscriber")
class LocationLegalConsentRevokedSubscriber(
    private val automation: LocationAutomationService,
    private val routes: ActualRouteService,
) : OutboxSubscriber {

    override val eventType: String = "auth.LocationLegalConsentRevoked"

    override fun handle(envelope: EventEnvelope) {
        val accountId = runCatching { UUID.fromString(envelope.aggregateId) }.getOrNull()
            ?: error("LocationLegalConsentRevoked 의 aggregateId 를 계정으로 읽지 못했습니다. eventId=${envelope.eventId}")
        val closed = automation.closeOnConsentRevoked(accountId, routeOnly = false, revokedAt = envelope.occurredAt)
        if (closed > 0) log.info("u10.interval_closed reason=CONSENT_REVOKED scope=L2 count={}", closed)
        // 실제 경로도 지운다 — 경로는 L2 ∧ L3 위에서만 생긴다(D4). L2 만 거둬도 L3 는 남으므로(auth 는 L2 철회에 L3 를 건드리지
        // 않는다) 여기서 안 지우면 위치 동의를 거둔 계정에 위치 데이터가 남는다(NFR logical-components — L2 구독자가 파기).
        val purged = routes.purge(accountId)
        if (purged > 0) log.info("u10.route_purge scope=L2 count={}", purged)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(LocationLegalConsentRevokedSubscriber::class.java)
    }
}
