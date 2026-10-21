package com.trippilot.archive.domain

import java.time.Instant
import java.util.UUID

/**
 * 자동화 구간(U10 FD domain-entities §4 · DEC-U10-10) — 지오펜스 무장·경로 기록이 **언제 돌았나**.
 *
 * 좌표가 없다. 업무 데이터(무장 여부 판정 · 관측)이고 법적 사실은 위치 법정 로그에 따로 남는다(P-DATA-U4-1).
 * [intervalId] 는 기기가 짓는다 — START·END 보고의 멱등 키다.
 */
data class LocationAutomationInterval(
    val intervalId: UUID,
    val tripId: UUID,
    val accountId: UUID,
    val kind: IntervalKind,
    val startedAt: Instant,
    val endedAt: Instant? = null,
    val endReason: IntervalEndReason? = null,
    val pointCount: Int? = null,
    val regionCount: Int? = null,
) {
    val isOpen: Boolean get() = endedAt == null

    /** [at] 을 포함하는가 — 닫힌 구간은 끝 시각까지, 열린 구간은 시작 이후 전부. */
    fun covers(at: Instant): Boolean = startedAt <= at && (endedAt == null || at <= endedAt)

    /** 닫는다. 시작보다 앞선 끝은 시작 시각으로 붙인다 — 기기 시계가 어긋나 보고가 뒤집혀도 구간이 음수가 되지 않게. */
    fun close(at: Instant, reason: IntervalEndReason, pointCount: Int?, regionCount: Int?) =
        copy(endedAt = maxOf(at, startedAt), endReason = reason, pointCount = pointCount, regionCount = regionCount)
}

/** 구간 종류. 무장은 위치 **이용**(USE), 경로 기록은 기기 안 **수집**(COLLECTION)이다. */
enum class IntervalKind { GEOFENCE_ARMED, ROUTE_RECORDING }

/** 닫힌 이유. 앞의 다섯은 기기가 보내고, [SERVER_TIMEOUT] 은 END 가 오지 않은 구간을 서버가 닫을 때만 쓴다(G-U10-11). */
enum class IntervalEndReason { CLIENT_STOP, PERMISSION_DOWNGRADE, ACCURACY_REDUCED, CONSENT_REVOKED, TRIP_ENDED, SERVER_TIMEOUT }

interface LocationAutomationIntervalRepository {
    fun find(intervalId: UUID): LocationAutomationInterval?

    /** 없을 때만 넣는다. 넣었으면 true — 같은 START 가 동시에 둘 와도 하나만 들어가고 그쪽만 로그를 남긴다. */
    fun insertIfAbsent(interval: LocationAutomationInterval): Boolean

    /**
     * **열려 있을 때만** 닫는다(조건부 쓰기). 닫았으면 true — 기기 END·철회·스위퍼가 겹쳐도 한 번만 닫히고,
     * 닫은 쪽만 법정 로그를 남긴다.
     */
    fun closeIfOpen(closed: LocationAutomationInterval): Boolean

    /** 그 여행의 그 종류 구간들. */
    fun findByTrip(tripId: UUID, kind: IntervalKind): List<LocationAutomationInterval>

    /** 그 계정의 열린 구간들(철회 시 닫기). */
    fun findOpenByAccount(accountId: UUID): List<LocationAutomationInterval>

    /** 열린 구간 전부(스위퍼). 기기가 END 를 보내므로 평소에는 몇 건 안 된다. */
    fun findOpen(): List<LocationAutomationInterval>
}
