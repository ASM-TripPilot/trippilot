package com.trippilot.trip.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.trip.api.event.TripDeleted
import com.trippilot.trip.api.event.TripPeriodChanged
import org.springframework.transaction.annotation.Transactional
import com.trippilot.placedata.api.DestinationCheck
import com.trippilot.placedata.api.DestinationFacade
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.trip.domain.CompanionType
import com.trippilot.trip.domain.MustVisitRepository
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDayWindow
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripPeriodShiftPort
import com.trippilot.trip.domain.TripRepository
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.UUID

data class CreateTripCommand(
    val title: String?,
    val startDate: LocalDate,
    val endDate: LocalDate,
    val party: Int,
    val companionType: CompanionType?,
    val budgetTotal: Long?,
    val preferenceSnapshot: Map<String, Any?>,
    val destinations: List<TripDestination>,
    /** 일과 창 — 미설정이면 [TripDayWindow.UNSET]. 생성이 하루 창을 정할 때 읽는다. */
    val dayWindow: TripDayWindow = TripDayWindow.UNSET,
)

data class EditTripCommand(
    val title: String?,
    val startDate: LocalDate,
    val endDate: LocalDate,
    val party: Int,
    val companionType: CompanionType?,
    val budgetTotal: Long?,
    val destinations: List<TripDestination>,
    val dayWindow: TripDayWindow = TripDayWindow.UNSET,
    /** 앱 번들 지역 그림 키. 다른 가변 필드처럼 **대체**라 null 이면 지운다(첫 목적지 자동). */
    val coverKey: String? = null,
    /** 기간을 바꾸며 일정을 버린다(일수가 달라도). 저장되는 값이 아니라 이 편집의 지시다. */
    val discardItinerary: Boolean = false,
)

/**
 * 여행(C6). 소유 스코프(타 계정·삭제됨 → 404). 상태 전이(confirm/activate/end)·이벤트는 후속 스프린트.
 */
@Service
class TripService(
    private val repo: TripRepository,
    private val destinations: DestinationFacade,
    private val regions: RegionLookupFacade,
    private val events: DomainEventPublisher,
    private val clock: Clock,
    private val periodShift: TripPeriodShiftPort,
    private val mustVisits: MustVisitRepository,
) {
    fun create(accountId: UUID, cmd: CreateTripCommand): Trip {
        requireSupportedDestinations(cmd.destinations)
        return repo.save(
            Trip.create(
                accountId, cmd.title, cmd.startDate, cmd.endDate, cmd.party, cmd.companionType,
                cmd.budgetTotal, cmd.preferenceSnapshot, withRegionCodes(cmd.destinations), clock.instant(),
                cmd.dayWindow,
            ),
        )
    }

    /**
     * 목적지 수용 판정(INV-U1-12 · BR-U1-35) — 카탈로그가 기준이다(TRIP-360).
     *
     * **왜 문구를 나누나.** 예전에는 무엇이 문제든 "지금은 국내 여행만 지원해요" 한 줄이었다.
     * `홍천읍` 을 넣은 국내 사용자에게 그렇게 답하면 거짓이고, 무엇을 고쳐야 하는지도 알려주지 못한다.
     * 판정은 C7 이 하고 여기서는 **말로 옮기기만** 한다 — 규칙이 두 모듈에 흩어지지 않도록.
     */
    private fun requireSupportedDestinations(destinations: List<TripDestination>) {
        val rejected = destinations.mapNotNull { d ->
            when (this.destinations.check(d.region)) {
                DestinationCheck.SUPPORTED -> null
                DestinationCheck.OUTSIDE ->
                    FieldError("destinations", "지금은 국내 여행만 지원해요: ${d.region}")
                DestinationCheck.DOMESTIC_UNSUPPORTED ->
                    FieldError("destinations", "아직 지원하지 않는 지역이에요: ${d.region}. 시·군·구 단위로 골라주세요.")
                DestinationCheck.UNVERIFIED ->
                    FieldError("destinations", "지역을 확인하지 못했어요: ${d.region}. 목록에서 골라주세요.")
            }
        }
        if (rejected.isNotEmpty()) throw ValidationFailed(rejected)
    }

    /**
     * 목적지에 행정구역 표준코드를 채운다(TRIP-361). 생성·편집 **양쪽**이 이 하나를 지난다 —
     * 한쪽만 채우면 여행을 편집하는 순간 코드가 조용히 사라진다.
     *
     * **`singleOrNull` 이 이 함수의 전부다.** [RegionLookupFacade.codesOf] 는 동명이지역 때문에
     * 여러 개를 돌려준다(중구 5곳 등). `firstOrNull` 로 하나를 집으면 부산 중구를 고른 사용자에게
     * 서울 중구가 박히고, 아무도 그것을 알아채지 못한다 — 확정되지 않으면 비워 둔다.
     *
     * 클라이언트는 이름만 보내므로 이름이 애매하면 여기서 풀 방법이 없다. 그 구멍은 계약이
     * 코드를 받게 될 때 닫힌다.
     */
    private fun withRegionCodes(destinations: List<TripDestination>): List<TripDestination> =
        destinations.map { dest ->
            val given = dest.regionCode?.trim()?.takeIf { it.isNotEmpty() }
            if (given == null) {
                dest.copy(regionCode = regions.codesOf(dest.region).singleOrNull())
            } else {
                // 클라이언트가 **명시한** 값이다. 실재하지 않으면 조용히 무시하지 않고 거절한다 —
                // 무시하면 사용자가 고른 지역과 다른(또는 없는) 지역으로 여행이 만들어지고,
                // 그 사실이 아무 데도 드러나지 않는다.
                if (!regions.isSelectableCode(given)) {
                    throw ValidationFailed(
                        listOf(FieldError("destinations[${dest.seq}].regionCode", "목적지로 선택할 수 없는 지역 코드입니다.")),
                    )
                }
                dest.copy(regionCode = given)
            }
        }

    fun list(accountId: UUID): List<Trip> = repo.findByAccount(accountId).filter { it.deletedAt == null }

    fun get(accountId: UUID, tripId: UUID): Trip = ownedOrNotFound(accountId, tripId)

    /**
     * 편집. **기간이 바뀐 편집만** [TripPeriodChanged] 를 낸다(TRIP-1758) — 알림 예약 같은 파생물이 새 기간으로 다시 서게.
     * 발행은 저장과 같은 트랜잭션(아웃박스)이다 — 밖에서 내면 롤백된 편집의 사건이 나간다([delete] 와 같다).
     */
    @Transactional
    fun edit(accountId: UUID, tripId: UUID, cmd: EditTripCommand): Trip {
        val before = ownedOrNotFound(accountId, tripId)
        val edited = before.edit(
            cmd.title, cmd.startDate, cmd.endDate, cmd.party, cmd.companionType,
            cmd.budgetTotal, withRegionCodes(cmd.destinations), clock.instant(), cmd.dayWindow, cmd.coverKey,
        )
        val periodChanged = edited.startDate != before.startDate || edited.endDate != before.endDate
        if (periodChanged) movePlanWithPeriod(accountId, before, edited, cmd.discardItinerary)
        val saved = repo.save(edited)
        if (periodChanged) {
            events.publish(TripPeriodChanged(tripId.toString(), tripId.toString(), saved.startDate.toString(), saved.endDate.toString()))
        }
        return saved
    }

    /**
     * 기간 변경 = 일정째 날짜만 이동(TRIP-1789, 사용자 결정 2026-11-04). 일정은 날짜로 찾으므로 기간만 바꾸면 옛 날짜에 남는다.
     * 같은 트랜잭션이라 여기서 던지면 아무 날짜도 안 바뀐다.
     *
     * **일정이 없으면 시작 뒤·일수 변경도 막지 않는다** — 지킬 일정이 없고, 막으면 오늘 출발로 만든 여행을 위저드에서
     * 되돌아가 고칠 때 409 가 된다. 일수가 바뀌면 거점·꼭 갈 곳은 옮길 칸수가 정해지지 않아 그대로 둔다(종전 동작).
     * 방문 기록이 있으면 시작된 것으로 본다 — 기록은 옛 날짜 슬롯 키로 남아 옮기면 고아가 된다.
     *
     * [discard] = 일수 변경은 같은 여행에서 일정만 다시 짠다(사용자 결정 2026-11-06). 여기는 버리기만 하고 재생성·AI 호출은 없다 —
     * 앱이 이어서 일정 짜는 방법 화면으로 간다. 일정이 없어도 시작 뒤면 409 다(그 경로의 앱은 일정 없이 이 값을 보내지 않는다).
     */
    private fun movePlanWithPeriod(accountId: UUID, before: Trip, edited: Trip, discard: Boolean) {
        val plan = periodShift.lockPlan(accountId, before.tripId)
        if (plan.generating) {
            throw ConflictDetected(message = "일정을 만드는 중이라 날짜를 옮길 수 없어요. 끝난 뒤 다시 시도해 주세요.", errorCode = ErrorCode.TRIP_PERIOD_GENERATING)
        }
        if (discard) {
            if (before.hasStarted(clock.instant()) || plan.hasVisits) {
                throw ConflictDetected(message = "이미 시작한 여행은 일정을 버리고 기간을 바꿀 수 없어요.", errorCode = ErrorCode.TRIP_PERIOD_STARTED)
            }
            periodShift.discardPlan(before.tripId, edited.startDate, edited.endDate)
            // 꼭 갈 곳은 사용자가 고른 장소라 남긴다 — 새 기간 밖 날짜만 비운다(새 기간 안이면 그 날 고정을 지킨다).
            mustVisits.findByTrip(before.tripId)
                .filter { it.fixedDate != null && it.fixedDate !in edited.startDate..edited.endDate }
                .forEach { mustVisits.save(it.unfixed()) }
            return
        }
        val nights = ChronoUnit.DAYS.between(before.startDate, before.endDate)
        val sameLength = ChronoUnit.DAYS.between(edited.startDate, edited.endDate) == nights
        if (plan.hasItinerary) {
            if (before.hasStarted(clock.instant()) || plan.hasVisits) {
                throw ConflictDetected(message = "이미 시작한 여행은 날짜를 옮길 수 없어요.", errorCode = ErrorCode.TRIP_PERIOD_STARTED)
            }
            if (!sameLength) {
                throw ConflictDetected(message = "일정이 있는 여행은 일수를 바꿀 수 없어요. 날짜만 옮길 수 있어요.", errorCode = ErrorCode.TRIP_PERIOD_LENGTH_CHANGED)
            }
        }
        if (!sameLength) return
        val days = ChronoUnit.DAYS.between(before.startDate, edited.startDate)
        periodShift.shiftDates(before.tripId, days)
        mustVisits.findByTrip(before.tripId).filter { it.fixedDate != null }.forEach { mustVisits.save(it.shiftedBy(days)) }
    }

    /**
     * 소프트 삭제 + 사건 발행(TRIP-1061). 소프트 삭제는 행이 남아 FK CASCADE 가 닿지 않는다 —
     * 알림 예약 같은 파생물은 [TripDeleted] 를 구독해 스스로 정리한다(안 하면 삭제한 여행의
     * 알림이 계속 울린다, QA #024 계열). 발행은 **저장과 같은 트랜잭션**(아웃박스) — 밖에서 내면
     * 롤백된 삭제의 정리가 나간다.
     */
    @Transactional
    fun delete(accountId: UUID, tripId: UUID) {
        val now = clock.instant()
        repo.save(ownedOrNotFound(accountId, tripId).softDelete(now))
        events.publish(TripDeleted(tripId.toString(), tripId.toString(), now.toString()))
    }

    /** 없거나 삭제됐거나 타 계정 소유면 404(존재 은닉). */
    private fun ownedOrNotFound(accountId: UUID, tripId: UUID): Trip {
        val trip = repo.findById(tripId)?.takeIf { it.deletedAt == null } ?: throw ResourceNotFound()
        if (trip.accountId != accountId) throw ResourceNotFound()
        return trip
    }
}
