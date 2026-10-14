package com.trippilot.archive.application

import com.trippilot.archive.api.event.ActualRouteStored
import com.trippilot.archive.domain.ActualRouteDay
import com.trippilot.archive.domain.ActualRouteDayRepository
import com.trippilot.archive.domain.Polyline
import com.trippilot.auth.api.LocationCollectionSource
import com.trippilot.auth.api.LocationConsentFacade
import com.trippilot.auth.api.LocationLegalLogFacade
import com.trippilot.auth.api.LocationPurgeScope
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPurgeScopeFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlin.math.ceil
import kotlin.math.roundToInt

/** 기기가 올리는 하루치 경로(U10 FD §12.3). 원시 표본은 없다 — 다운샘플한 인코딩 폴리라인뿐이다. */
data class RouteDayUpload(
    val segments: List<String>,
    val distanceM: Int,
    val rawPointCount: Int,
    /** 기기가 센 저장 점 수 — 서버는 디코드한 수를 쓰고 이 값은 보지 않는다(기기 값이 사실과 다를 수 있다). */
    val storedPointCount: Int?,
    val recordedFrom: Instant? = null,
    val recordedTo: Instant? = null,
)

/**
 * 실제 경로(U10 FD §3·§7·§12.3 · DEC-U10-4·5·7).
 *
 * **법적 무게가 가장 큰 표면이다.** 저장은 L2·L3 동의가 있을 때만(D4 · BR-U10-45) 받고, 저장한 순간 같은 트랜잭션에서
 * `COLLECTION(STORE)` 1건을 남긴다(INV-U10-4). L3 를 철회하면 그 계정의 경로를 전부 즉시 지우고, 지운 것이 있을 때만
 * `PURGE(ACTUAL_ROUTE)` 1건을 남긴다(BR-U10-43 · PBT-U10-1).
 */
@Service
class ActualRouteService(
    private val trips: TripFacade,
    private val purgeScope: TripPurgeScopeFacade,
    private val routes: ActualRouteDayRepository,
    private val consents: LocationConsentFacade,
    private val legalLog: LocationLegalLogFacade,
    private val events: DomainEventPublisher,
    private val clock: Clock,
) {
    /** 하루치 경로를 통째로 바꾼다(재업로드 = 전체 교체, 멱등). */
    @Transactional
    fun store(accountId: UUID, tripId: UUID, date: LocalDate, upload: RouteDayUpload): ActualRouteDay {
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        if (!consents.hasLocationLegalConsent(accountId) || !consents.hasGpsRecordingOptIn(accountId)) {
            // INV-U10-1 — L3 가 거짓인 계정에는 경로 행이 생기지 않는다. 기기는 이 코드를 보고 원시 표본을 지우고 강등한다.
            throw ConflictDetected(message = "위치 동의가 없어 경로를 저장할 수 없습니다.", errorCode = ErrorCode.LOCATION_CONSENT_REQUIRED)
        }
        if (date < period.startDate || date > period.endDate) {
            throw ValidationFailed(listOf(FieldError("date", "여행 기간 밖의 날짜입니다.")))
        }
        val points = decode(upload)
        val stored = points.sumOf { it.size }
        if (upload.rawPointCount < stored) {
            throw ValidationFailed(listOf(FieldError("rawPointCount", "원시 점 수가 저장 점 수보다 적을 수 없습니다.")))
        }
        val window = window(upload)
        val (distance, clamped) = clamp(upload.distanceM, points, window)
        val now = clock.instant()
        val saved = routes.upsert(
            ActualRouteDay(
                // 같은 날이 있으면 저장소가 처음 id 를 지킨다(법정 로그의 subjectId 가 재업로드로 바뀌지 않게).
                routeDayId = UUID.randomUUID(),
                tripId = tripId, localDate = date, segments = upload.segments,
                distanceM = distance, distanceClamped = clamped, rawPointCount = upload.rawPointCount, storedPointCount = stored,
                recordedFrom = upload.recordedFrom, recordedTo = upload.recordedTo, createdAt = now, updatedAt = now,
            ),
        )
        legalLog.recordCollection(accountId, LocationCollectionSource.ROUTE_TRACE, saved.routeDayId, pointCount = stored)
        events.publish(ActualRouteStored(saved.routeDayId.toString(), tripId.toString(), accountId.toString(), date.toString(), saved.distanceM))
        return saved
    }

    @Transactional(readOnly = true)
    fun list(accountId: UUID, tripId: UUID): List<ActualRouteDay> {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        return routes.findByTrip(tripId)
    }

    /**
     * GPS 기록 동의(L3) 철회·계정 삭제 — 그 계정의 실제 경로를 **전부** 지운다(DEC-U10-7). 지운 것이 있을 때만 파기 로그
     * 1건(BR-U10-43). 멱등: 두 번째 배달은 지울 것이 없어 로그도 없다. 지워진 여행까지 훑는다(`findAllTripIdsOf` 는 거르지 않는다).
     */
    @Transactional
    fun purge(accountId: UUID): Int {
        val purged = routes.deleteByTrips(purgeScope.findAllTripIdsOf(accountId))
        if (purged > 0) legalLog.recordPurge(accountId, LocationPurgeScope.ACTUAL_ROUTE, purged)
        return purged
    }

    /** 세그먼트를 푼다 — 상한을 넘으면 푸는 도중에 멈춘다(SEC-U10-07). */
    private fun decode(upload: RouteDayUpload): List<List<Polyline.Point>> {
        if (upload.segments.size > MAX_SEGMENTS) {
            throw ValidationFailed(listOf(FieldError("segments", "세그먼트는 ${MAX_SEGMENTS}개까지입니다.")))
        }
        if (upload.segments.sumOf { it.length } > MAX_ENCODED_CHARS) {
            throw ValidationFailed(listOf(FieldError("segments", "경로가 너무 큽니다.")))
        }
        var decoded = 0
        return upload.segments.map { segment ->
            val points = try {
                Polyline.decode(segment, MAX_POINTS, already = decoded)
            } catch (_: Polyline.TooManyPoints) {
                throw ValidationFailed(listOf(FieldError("segments", "점은 하루 ${MAX_POINTS}개까지입니다.")))
            } catch (_: Polyline.Malformed) {
                throw ValidationFailed(listOf(FieldError("segments", "인코딩 폴리라인 형식이 아닙니다.")))
            }
            decoded += points.size
            points
        }
    }

    /** 기록 구간. 기기가 안 보내면 하루 전체로 본다(상한이 하루 길이로 넓어질 뿐 하한은 그대로다). */
    private fun window(upload: RouteDayUpload): Duration {
        val from = upload.recordedFrom
        val to = upload.recordedTo
        if (from == null || to == null) return Duration.ofDays(1)
        if (to < from) throw ValidationFailed(listOf(FieldError("recordedTo", "기록 끝이 시작보다 앞섭니다.")))
        return Duration.between(from, to).coerceAtMost(Duration.ofDays(1))
    }

    /**
     * 거리 클램프(BR-U10-38 · PBT-U10-6). 하한 = 저장된 폴리라인 길이(다운샘플은 경로를 짧게만 만든다 — 기기 거리는 그 이상이다),
     * 상한 = 기록 구간 × 물리 상한 속도. 바꿨으면 `clamped`.
     */
    private fun clamp(reported: Int, segments: List<List<Polyline.Point>>, window: Duration): Pair<Int, Boolean> {
        val floor = ceil(segments.sumOf { Polyline.lengthM(it) }).toInt()
        val ceiling = (window.seconds * MAX_SPEED_MPS).roundToInt()
        val bounded = reported.coerceAtLeast(floor).coerceAtMost(maxOf(ceiling, floor))
        return bounded to (bounded != reported)
    }

    companion object {
        /** SEC-U10-07 — 세그먼트 수 · 디코드 후 총 점 수(여유 없음). */
        const val MAX_SEGMENTS = 200
        const val MAX_POINTS = 2_000

        /** 인코딩 문자열 총 길이 — 2,000점 × 점당 최대 약 12자 + 여유. 본문 256KB(PERF-U10-05)보다 작다. */
        const val MAX_ENCODED_CHARS = 64_000

        /**
         * 물리 상한 속도 — **시속 300km(KTX)**. 정본은 "도보·차량 혼재 상식선 — NFR 값"이라고만 두고 숫자를 정하지 않았다
         * (2026-10-14 확인). 여행 중 고속철을 타는 날이 있으므로 그보다 낮게 잡으면 정상 기록이 깎인다. 목적은 기기 결함으로
         * 터무니없이 큰 값이 고착되는 것을 막는 것이다.
         */
        const val MAX_SPEED_MPS = 300_000.0 / 3600
    }
}
