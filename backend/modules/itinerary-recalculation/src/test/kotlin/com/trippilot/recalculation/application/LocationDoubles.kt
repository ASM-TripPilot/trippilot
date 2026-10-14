package com.trippilot.recalculation.application

import com.trippilot.auth.api.LocationCollectionSource
import com.trippilot.auth.api.LocationConsentFacade
import com.trippilot.auth.api.LocationLegalLogFacade
import com.trippilot.auth.api.LocationPurgeScope
import com.trippilot.trip.api.TripPurgeScopeFacade
import java.util.UUID

/** 위치 동의 대역(TRIP-992) — 기본 동의 ON. 게이트 스펙만 끈다. */
internal class FakeLocationConsents(var legalConsent: Boolean = true) : LocationConsentFacade {
    override fun hasGpsRecordingOptIn(accountId: UUID) = false
    override fun hasLocationLegalConsent(accountId: UUID) = legalConsent
}

/** 법정 로그 대역 — 수집·파기 호출을 관찰한다(append-only 실체는 IT 몫). */
internal class CapturingLegalLogs : LocationLegalLogFacade {
    val collections = mutableListOf<Pair<LocationCollectionSource, UUID>>()
    val purges = mutableListOf<Pair<LocationPurgeScope, Int>>()
    override fun recordCollection(accountId: UUID, source: LocationCollectionSource, subjectId: UUID, pointCount: Int?) {
        collections += source to subjectId
    }
    override fun recordPurge(accountId: UUID, scope: LocationPurgeScope, purgedCount: Int) {
        purges += scope to purgedCount
    }

    override fun recordUseInterval(
        accountId: UUID, purpose: com.trippilot.auth.api.LocationUsePurpose, intervalId: UUID, tripId: UUID,
        phase: com.trippilot.auth.api.LocationIntervalPhase, at: java.time.Instant, endReason: String?, regionCount: Int?,
    ) = error("이 스펙은 구간 로그를 쓰지 않는다")

    override fun recordCollectionInterval(
        accountId: UUID, source: LocationCollectionSource, intervalId: UUID, tripId: UUID,
        phase: com.trippilot.auth.api.LocationIntervalPhase, at: java.time.Instant, endReason: String?, pointCount: Int?,
    ) = error("이 스펙은 구간 로그를 쓰지 않는다")
}

internal class FakeTripPurgeScope(private val tripIds: List<UUID> = emptyList()) : TripPurgeScopeFacade {
    override fun findAllTripIdsOf(accountId: UUID) = tripIds
}
