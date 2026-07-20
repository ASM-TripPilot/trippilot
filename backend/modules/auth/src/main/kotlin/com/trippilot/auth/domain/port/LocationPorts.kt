package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.location.LocationConsent
import com.trippilot.auth.domain.location.LocationLegalEvent

/** 위치 동의 3층 현재 상태 포트(계정당 1행 upsert). */
interface LocationConsentStateRepository {
    fun find(accountId: AccountId): LocationConsent?

    fun save(state: LocationConsent): LocationConsent
}

/** 위치 법정 로그 포트 — **추가 전용**(INV-LL1). */
interface LocationLegalLogRepository {
    fun append(event: LocationLegalEvent)
}
