package com.trippilot.auth.domain.location

import com.trippilot.auth.domain.AccountId
import java.time.Instant

/** 위치 법정 로그 이벤트 유형(V1.3 location_legal_log.event_type). */
enum class LocationLegalEventType { CONSENT_GRANTED, CONSENT_REVOKED, COLLECTION, USE, PROVISION, PURGE }

/**
 * 위치 법정 로그 이벤트 — **append-only · 값 보존**(V1.3, INV-LL1). 계정 파기 후에도 잔존(INV-LL2, FK 미강제).
 * detail 에는 **원시 좌표를 담지 않는다**(사실 확인자료). 직렬화(jsonb)는 어댑터가 수행 — 도메인은 맵으로 보유.
 */
class LocationLegalEvent private constructor(
    val accountId: AccountId,
    val eventType: LocationLegalEventType,
    val detail: Map<String, String>,
    val occurredAt: Instant,
) {
    companion object {
        fun of(
            accountId: AccountId,
            eventType: LocationLegalEventType,
            detail: Map<String, String>,
            occurredAt: Instant,
        ): LocationLegalEvent = LocationLegalEvent(accountId, eventType, detail, occurredAt)
    }
}
