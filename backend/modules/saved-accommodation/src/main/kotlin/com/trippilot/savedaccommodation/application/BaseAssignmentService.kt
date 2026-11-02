package com.trippilot.savedaccommodation.application

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.savedaccommodation.domain.BaseAssignment
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.BaseSpan
import com.trippilot.savedaccommodation.domain.CoverageResolver
import com.trippilot.savedaccommodation.domain.CoverageStatus
import com.trippilot.savedaccommodation.domain.DayCoverage
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import com.trippilot.savedaccommodation.domain.TripBaseDay
import com.trippilot.savedaccommodation.domain.TripBaseDayRepository
import com.trippilot.savedaccommodation.domain.BaseResolution
import com.trippilot.savedaccommodation.api.event.TripBaseResolved
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.savedaccommodation.domain.PlaceSearchPort
import com.trippilot.savedaccommodation.domain.SavedStay
import org.slf4j.LoggerFactory
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.LocalDate
import java.util.UUID

/** 거점 배정 요청 — 등록 숙소를 [dateFrom, dateTo) 구간 거점으로. */
data class AssignBaseCommand(
    val savedStayId: UUID,
    val dateFrom: LocalDate,
    val dateTo: LocalDate,
)

/** 여행 커버리지 상태 — 숙박일별 판정 + 차단 여부(INV-U1-16 게이트). */
data class TripCoverage(val blocked: Boolean, val days: List<DayCoverage>)

/**
 * 구간 거점 배정 + 커버리지(C4). 여행 소유는 [TripFacade](R1, trip.api)로, 숙소 소유는 SavedStayRepository로 판정.
 * 타 계정·없는 여행/숙소는 404(존재 은닉).
 *
 * 커버리지는 **차단형**이다(DEC-8 · INV-U1-16) — 미해결 날짜가 하나라도 있으면 AI 일정 생성에 못 들어간다.
 * 그래서 [resolveDay] 가 없으면 겹치게 등록한 사용자는 **배정을 지우는 것 말고 빠져나올 길이 없다**(TRIP-190).
 */
@Service
class BaseAssignmentService(
    private val bases: BaseAssignmentRepository,
    private val stays: SavedStayRepository,
    private val trips: TripFacade,
    private val baseDays: TripBaseDayRepository,
    private val events: DomainEventPublisher,
    private val clock: Clock,
    private val placeSearch: PlaceSearchPort,
    private val regions: RegionLookupFacade,
) {
    fun assign(accountId: UUID, tripId: UUID, cmd: AssignBaseCommand): BaseAssignment {
        val period = ownedTripPeriod(accountId, tripId)
        // 거점 숙소도 소유자 것이어야(타 계정 숙소로 거점 불가).
        val stay = stays.findById(cmd.savedStayId)?.takeIf { it.accountId == accountId } ?: throw ResourceNotFound()
        // INV-U1-08: 좌표 미확정 숙소는 거점 배정 불가(일정 생성이 거점 좌표를 요구).
        if (!stay.coordConfirmed) {
            throw ValidationFailed(listOf(FieldError("savedStayId", "좌표가 확정되지 않은 숙소는 거점으로 배정할 수 없습니다(INV-U1-08).")))
        }
        requireInTripRegion(accountId, tripId, stay)
        return bases.save(
            BaseAssignment.assign(
                tripId, stay.savedStayId, cmd.dateFrom, cmd.dateTo,
                period.startDate, period.endDate, clock.instant(),
            ),
        )
    }

    fun list(accountId: UUID, tripId: UUID): List<BaseAssignment> {
        ownedTripPeriod(accountId, tripId)
        return bases.findByTrip(tripId)
    }

    fun coverage(accountId: UUID, tripId: UUID): TripCoverage {
        val period = ownedTripPeriod(accountId, tripId)
        return coverageOf(tripId, period.startDate, period.endDate)
    }

    /**
     * `h?` 해소 시트 — 그 날 거점으로 쓸 숙소를 고른다(BR-U1-45 · `resolution=user_pick`).
     *
     * **자동 확정된 날은 고칠 수 없다**(409). 후보가 하나뿐이라 고를 것이 없고, 바꾸고 싶다면 배정 자체를
     * 바꾸는 것이 맞다 — 여기서 덮어쓰게 하면 배정과 확정이 서로 다른 말을 하게 된다.
     *
     * 전 숙박일이 확정되면 [TripBaseResolved] 로 게이트를 연다(BR-U1-46).
     */
    @Transactional
    fun resolveDay(accountId: UUID, tripId: UUID, dayDate: LocalDate, savedStayId: UUID): TripCoverage {
        val period = ownedTripPeriod(accountId, tripId)
        val before = coverageOf(tripId, period.startDate, period.endDate)
        val day = before.days.firstOrNull { it.date == dayDate }
            ?: throw ValidationFailed(listOf(FieldError("dayDate", "여행 숙박일이 아닙니다(마지막 날은 체크아웃이라 거점이 없습니다).")))
        if (day.status == CoverageStatus.AUTO) {
            throw ConflictDetected(message = "자동으로 확정된 날짜입니다. 거점을 바꾸려면 배정을 수정하세요.")
        }
        // 겹침일은 그 날 후보 중에서, 공백일은 이 여행에 배정된 숙소 중에서만 고를 수 있다.
        // 여기서 막지 않으면 그 여행과 무관한 숙소가 거점이 되어 일정이 엉뚱한 곳에서 시작한다.
        val allowed = day.candidates.ifEmpty { bases.findByTrip(tripId).map { it.savedStayId }.distinct() }
        if (savedStayId !in allowed) {
            throw ValidationFailed(listOf(FieldError("savedStayId", "그 날 거점으로 고를 수 있는 숙소가 아닙니다.")))
        }

        baseDays.save(TripBaseDay(tripId, dayDate, savedStayId, BaseResolution.USER_PICK))
        val after = coverageOf(tripId, period.startDate, period.endDate)
        // 방금 마지막 미해결이 풀렸을 때만 알린다 — 이미 열려 있던 게이트를 다시 알리지 않는다.
        if (before.blocked && !after.blocked) {
            events.publish(TripBaseResolved(tripId.toString()))
        }
        return after
    }

    private fun coverageOf(tripId: UUID, startDate: LocalDate, endDate: LocalDate): TripCoverage {
        val spans = bases.findByTrip(tripId).map { BaseSpan(it.savedStayId, it.dateFrom, it.dateTo) }
        val picks = baseDays.findByTrip(tripId).mapNotNull { d -> d.savedStayId?.let { d.dayDate to it } }.toMap()
        val days = CoverageResolver.resolve(startDate, endDate, spans, picks)
        return TripCoverage(CoverageResolver.blocked(days), days)
    }

    fun remove(accountId: UUID, tripId: UUID, baseAssignmentId: UUID) {
        ownedTripPeriod(accountId, tripId)
        val base = bases.findById(baseAssignmentId)?.takeIf { it.tripId == tripId } ?: throw ResourceNotFound()
        bases.delete(base)
    }

    /**
     * 여행 지역 밖 숙소는 거점이 될 수 없다(TRIP-1703, 2026-11-02 사용자 결정 — FE TRIP-1011 "다른 지역도 보여 준다"를 뒤집는다).
     * 서울 여행에 부산 숙소가 거점이 되면 일정이 부산에서 돌고 하루 이동이 수백 km 가 된다.
     *
     * 판정은 담은 장소와 같은 **코드 양방향 접두사**(INV-U1-21)다 — 숙소 좌표를 주소로 바꿔 POI 와 같은 규칙으로 코드를 붙인다.
     * **판정할 수 없으면 막지 않는다**(fail-open): 목적지 코드가 하나라도 없음 · 주소 없는 좌표 · 코드 미해결 · 벤더 장애.
     * 벤더 장애로 막으면 지역 안 숙소까지 배정이 전부 멈춘다 — 그 경우만 로그로 남긴다.
     * 409 인 이유: 400 은 이미 "기간 밖 → 늘릴까요?"(dateFrom·dateTo)로 앱이 읽는다. 다른 코드여야 엉뚱한 확인창이 안 뜬다.
     */
    private fun requireInTripRegion(accountId: UUID, tripId: UUID, stay: SavedStay) {
        val codes = trips.findGenerationContext(accountId, tripId)?.destinationRefs?.map { it.regionCode } ?: return
        if (codes.isEmpty() || codes.any { it == null }) return
        val lat = stay.lat ?: return
        val lng = stay.lng ?: return
        val address = try {
            placeSearch.reverseGeocode(lat, lng)
        } catch (e: UpstreamUnavailable) {
            log.warn("거점 지역 판정 생략 — 주소 조회 실패(fail-open) trip={} stay={}", tripId, stay.savedStayId, e)
            return
        } ?: return
        val stayCode = regions.codeOfAddress(address) ?: return
        if (codes.filterNotNull().none { stayCode.startsWith(it) || it.startsWith(stayCode) }) {
            throw ConflictDetected(
                message = "이 여행 지역 밖 숙소는 거점으로 고를 수 없어요.",
                errorCode = ErrorCode.STAY_OUTSIDE_TRIP_REGION,
            )
        }
    }

    /** 여행이 없거나 삭제됐거나 타 계정이면 404(존재 은닉). */
    private fun ownedTripPeriod(accountId: UUID, tripId: UUID) =
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()

    private companion object {
        private val log = LoggerFactory.getLogger(BaseAssignmentService::class.java)
    }
}
