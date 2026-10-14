package com.trippilot.archive.application

import com.trippilot.archive.domain.IntervalEndReason
import com.trippilot.archive.domain.IntervalKind
import com.trippilot.archive.domain.LocationAutomationInterval
import com.trippilot.archive.domain.LocationAutomationIntervalRepository
import com.trippilot.auth.api.LocationCollectionSource
import com.trippilot.auth.api.LocationConsentFacade
import com.trippilot.auth.api.LocationIntervalPhase
import com.trippilot.auth.api.LocationLegalLogFacade
import com.trippilot.auth.api.LocationUsePurpose
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripOwnerFacade
import org.slf4j.LoggerFactory
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** 기기의 구간 보고(U10 FD §12.4). */
data class IntervalReport(
    val intervalId: UUID,
    val kind: IntervalKind,
    val phase: LocationIntervalPhase,
    val at: Instant,
    val endReason: IntervalEndReason? = null,
    val pointCount: Int? = null,
    val regionCount: Int? = null,
)

/**
 * @property enabled 서버 킬 스위치(REL-U10-06 · tech-stack 델타 4). 끄면 새 구간 START 를 409 로 거절한다 — 기기는 그것을
 *   보고 강등한다. 이미 열린 구간의 END 는 계속 받는다(닫는 것은 언제나 안전하다).
 * @property sweepMs 열린 구간 스위퍼 주기(G-U10-11).
 */
@ConfigurationProperties("trippilot.location-automation")
data class LocationAutomationProperties(
    val enabled: Boolean = true,
    val sweepMs: Long = 3_600_000,
)

/**
 * 자동화 구간 — 지오펜스 무장·경로 기록 구간을 열고 닫고, 구간 단위 위치 법정 로그를 남긴다(BR-U10-47·48 · DEC-U10-10).
 *
 * **법정 로그는 상태가 실제로 바뀐 쪽만 남긴다.** 같은 보고의 재전송(오프라인 큐) · 기기 END 와 철회·스위퍼의 겹침은
 * 조건부 쓰기에서 한쪽만 통과하므로 START·END 가 각각 한 번씩만 기록된다.
 */
@Service
class LocationAutomationService(
    private val trips: TripFacade,
    private val owners: TripOwnerFacade,
    private val intervals: LocationAutomationIntervalRepository,
    private val consents: LocationConsentFacade,
    private val legalLog: LocationLegalLogFacade,
    private val properties: LocationAutomationProperties,
    private val clock: Clock,
) {
    /**
     * 구간 보고. 멱등(구간 id + 단계) — 이미 반영된 보고는 아무것도 하지 않고 성공한다.
     *
     * START 는 **동의가 있을 때만** 연다 — 무장은 위치 이용 동의(L2), 경로 기록은 그에 더해 GPS 기록 동의(L3)가 필요하다
     * (D4 · BR-U10-45). 없는데 열면 법정 로그에 동의 없는 이용·수집이 남는다. END 는 언제나 받는다.
     */
    @Transactional
    fun report(accountId: UUID, tripId: UUID, report: IntervalReport) {
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        if (report.at > clock.instant() + CLOCK_SKEW) {
            throw ValidationFailed(listOf(FieldError("at", "보고 시각이 서버 시각보다 앞서 있습니다.")))
        }
        // 여행 구간(± 하루) 밖의 START 는 받지 않는다 — 옛 시각의 START 하나가 무장 판정을 여행 전체로 늘린다(SEC-U10-07 정신).
        // END 는 거르지 않는다: 닫는 것은 언제나 안전하고, 막으면 그 구간은 스위퍼가 마감할 때까지 열린 채 남는다.
        val day = LocalDate.ofInstant(report.at, TRAVEL_ZONE)
        if (report.phase == LocationIntervalPhase.START && (day < period.startDate.minusDays(1) || day > period.endDate.plusDays(1))) {
            throw ValidationFailed(listOf(FieldError("at", "보고 시각이 여행 기간 밖입니다.")))
        }
        val existing = intervals.find(report.intervalId)
        if (existing != null && (existing.tripId != tripId || existing.kind != report.kind)) {
            // 다른 여행·종류의 구간 id 를 재사용했다 — 기기의 결함이다. 덮지 않는다.
            throw ConflictDetected(message = "그 구간 id 는 다른 구간에 쓰였습니다.")
        }
        when (report.phase) {
            LocationIntervalPhase.START -> start(accountId, tripId, report, existing)
            LocationIntervalPhase.END -> end(report, existing ?: throw ConflictDetected(message = "시작 보고가 없는 구간입니다."))
        }
    }

    private fun start(accountId: UUID, tripId: UUID, report: IntervalReport, existing: LocationAutomationInterval?) {
        if (existing != null) return // 재전송
        // 409 를 코드로 가른다 — 기기는 둘 다 강등하지만, 원인이 다르고(서버가 껐다 / 사용자가 동의를 안 했다) 다른 409(구간 id
        // 재사용 등)와 섞이면 기기가 강등해야 할 때를 모른다. 강등하지 않으면 서버엔 구간도 법정 로그도 없는데 기기는 무장한 채다.
        if (!properties.enabled) throw ConflictDetected(message = "자동 기록이 지금 꺼져 있습니다.", errorCode = ErrorCode.AUTOMATION_DISABLED)
        val consented = consents.hasLocationLegalConsent(accountId) &&
            (report.kind == IntervalKind.GEOFENCE_ARMED || consents.hasGpsRecordingOptIn(accountId))
        if (!consented) {
            throw ConflictDetected(message = "위치 동의가 없어 시작할 수 없습니다.", errorCode = ErrorCode.LOCATION_CONSENT_REQUIRED)
        }
        val opened = LocationAutomationInterval(report.intervalId, tripId, accountId, report.kind, report.at)
        // 같은 START 가 동시에 둘 오면 하나만 들어간다 — 들어간 쪽만 로그를 남긴다(500 도 중복 로그도 없다).
        if (intervals.insertIfAbsent(opened)) log(opened, LocationIntervalPhase.START, report.at)
    }

    private fun end(report: IntervalReport, existing: LocationAutomationInterval) {
        val reason = report.endReason ?: throw ValidationFailed(listOf(FieldError("endReason", "끝 보고에는 사유가 필요합니다.")))
        if (reason == IntervalEndReason.SERVER_TIMEOUT) {
            throw ValidationFailed(listOf(FieldError("endReason", "SERVER_TIMEOUT 은 서버만 쓴다.")))
        }
        close(existing, report.at, reason, report.pointCount, report.regionCount) // 이미 닫혔으면 조용히 끝난다(재전송)
    }

    /**
     * 위치 동의 철회 — 열린 구간을 닫는다. L2 철회는 둘 다(둘 다 L2 위에 선다), L3 철회는 경로 기록만.
     * 기기도 철회 즉시 멈추고 END 를 보내지만(BR-U10-46), 철회 뒤에는 아무것도 올리지 않으므로 그 END 가 안 올 수 있다.
     */
    @Transactional
    fun closeOnConsentRevoked(accountId: UUID, routeOnly: Boolean, revokedAt: Instant): Int =
        intervals.findOpenByAccount(accountId)
            .filter { !routeOnly || it.kind == IntervalKind.ROUTE_RECORDING }
            // 끝 시각은 **철회 시각**이다 — 처리 시각으로 닫으면 릴레이 지연(재시도 백오프면 십여 분)만큼 법정 로그가 철회 뒤에도
            // 이용이 이어진 것으로 적는다.
            .count { close(it, revokedAt, IntervalEndReason.CONSENT_REVOKED, null, null) }

    /**
     * END 가 오지 않은 구간을 **여행 종료 + 1일**에 닫는다(BR-U10-48 · G-U10-11) — 앱이 강제 종료·삭제되면 END 가 영영 안 온다.
     * 그대로 두면 무장 상태가 남아 이동 지연 판정이 끝난 여행을 계속 본다.
     *
     * ShedLock 을 쓰지 않는다 — 닫기가 조건부 쓰기라 여러 인스턴스가 겹쳐도 한 번만 닫히고 로그도 한 번만 남는다.
     */
    @Scheduled(
        fixedDelayString = "\${trippilot.location-automation.sweep-ms:3600000}",
        initialDelayString = "\${trippilot.location-automation.sweep-initial-delay-ms:60000}",
    )
    @Transactional
    fun sweep(): Int {
        val now = clock.instant()
        return intervals.findOpen().count { open ->
            val period = owners.findOwnedPeriod(open.tripId)
                // 여행이 지워졌다 — **소프트 삭제**라 행과 구간이 남고(CASCADE 가 닿지 않는다) 기기의 END 는 404 로 막힌다.
                // 지금 닫지 않으면 영영 안 닫혀 법정 로그에 시작만 남는다. 끝 시각은 훑은 시각이다 — 삭제 시각을 이 모듈이 모르고,
                // 그 차이는 스위퍼 주기(기본 1시간) 이내다.
                ?: return@count close(open, now, IntervalEndReason.SERVER_TIMEOUT, null, null)
            // 끝 시각은 그 하루의 끝(종료 + 2일 00:00)이다 — 훑은 시각으로 닫으면 스위퍼 주기만큼 이용이 늘어난 것으로 적힌다.
            val deadline = period.endDate.plusDays(2).atStartOfDay(TRAVEL_ZONE).toInstant()
            now >= deadline && close(open, deadline, IntervalEndReason.SERVER_TIMEOUT, null, null)
        }.also { if (it > 0) log.info("u10.interval_sweep closed={}", it) }
    }

    /** 열려 있을 때만 닫고, 닫았으면 END 법정 로그를 남긴다. */
    private fun close(open: LocationAutomationInterval, at: Instant, reason: IntervalEndReason, points: Int?, regions: Int?): Boolean {
        val closed = open.close(at, reason, points, regions)
        if (!intervals.closeIfOpen(closed)) return false
        log(closed, LocationIntervalPhase.END, closed.endedAt!!)
        return true
    }

    private fun log(interval: LocationAutomationInterval, phase: LocationIntervalPhase, at: Instant) {
        val reason = interval.endReason?.name.takeIf { phase == LocationIntervalPhase.END }
        when (interval.kind) {
            IntervalKind.GEOFENCE_ARMED -> legalLog.recordUseInterval(
                interval.accountId, LocationUsePurpose.GEOFENCE_AUTO_VISIT, interval.intervalId, interval.tripId, phase, at,
                reason, interval.regionCount.takeIf { phase == LocationIntervalPhase.END },
            )
            IntervalKind.ROUTE_RECORDING -> legalLog.recordCollectionInterval(
                interval.accountId, LocationCollectionSource.ROUTE_TRACE, interval.intervalId, interval.tripId, phase, at,
                reason, interval.pointCount.takeIf { phase == LocationIntervalPhase.END },
            )
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(LocationAutomationService::class.java)
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

        /** 기기 시계가 서버보다 이만큼 앞서는 것은 받는다(NFR — "서버 시각 + 5분" 경계). 그 너머는 기기 결함이다. */
        private val CLOCK_SKEW: Duration = Duration.ofMinutes(5)
    }
}
