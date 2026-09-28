package com.trippilot.recalculation.adapter.`in`.event

import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.recalculation.application.ReplanSessionService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 위치 법정 동의(L2)가 꺼지면 **이미 저장된 재계획 기준점 좌표를 지운다**(TRIP-992 · INV-L4).
 *
 * 게이팅만으로는 부족하다 — 그건 앞으로 들어올 좌표를 막을 뿐이고, 철회 이전에 저장된 좌표는
 * 그대로 남는다(EXIF 파기 `GpsRecordingOptOutSubscriber` 와 같은 구조·같은 이유).
 *
 * 멱등: 파기된 행은 kind 가 PURGED 라 두 번 배달돼도(at-least-once) 두 번째는 0건 — 기록이 부풀지 않는다.
 */
@Component
class LocationLegalConsentRevokedSubscriber(
    private val sessions: ReplanSessionService,
) : OutboxSubscriber {

    override val eventType: String = "auth.LocationLegalConsentRevoked"

    override fun handle(envelope: EventEnvelope) {
        // 못 읽으면 예외로 올려 릴레이가 재시도한다 — 조용히 건너뛰면 "철회했는데 좌표가 남은"
        // 상태를 아무도 모른다(INV-4).
        val accountId = runCatching { UUID.fromString(envelope.aggregateId) }.getOrNull()
            ?: error("LocationLegalConsentRevoked 의 aggregateId 를 계정으로 읽지 못했습니다. eventId=${envelope.eventId}")

        val purged = sessions.purgeOriginCoordinates(accountId)
        log.info("위치 동의(L2) 철회로 재계획 기준점 좌표를 파기했습니다. accountId={} 건수={}", accountId, purged)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(LocationLegalConsentRevokedSubscriber::class.java)
    }
}
