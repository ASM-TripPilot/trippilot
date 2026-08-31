package com.trippilot.trip.application

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.placedata.api.DestinationCheck
import com.trippilot.placedata.api.DestinationFacade
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.trip.domain.CompanionType
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
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
)

data class EditTripCommand(
    val title: String?,
    val startDate: LocalDate,
    val endDate: LocalDate,
    val party: Int,
    val companionType: CompanionType?,
    val budgetTotal: Long?,
    val destinations: List<TripDestination>,
)

/**
 * 여행(C6). 소유 스코프(타 계정·삭제됨 → 404). 상태 전이(confirm/activate/end)·이벤트는 후속 스프린트.
 */
@Service
class TripService(
    private val repo: TripRepository,
    private val destinations: DestinationFacade,
    private val regions: RegionLookupFacade,
    private val clock: Clock,
) {
    fun create(accountId: UUID, cmd: CreateTripCommand): Trip {
        requireSupportedDestinations(cmd.destinations)
        return repo.save(
            Trip.create(
                accountId, cmd.title, cmd.startDate, cmd.endDate, cmd.party, cmd.companionType,
                cmd.budgetTotal, cmd.preferenceSnapshot, withRegionCodes(cmd.destinations), clock.instant(),
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
        destinations.map { it.copy(regionCode = regions.codesOf(it.region).singleOrNull()) }

    fun list(accountId: UUID): List<Trip> = repo.findByAccount(accountId).filter { it.deletedAt == null }

    fun get(accountId: UUID, tripId: UUID): Trip = ownedOrNotFound(accountId, tripId)

    fun edit(accountId: UUID, tripId: UUID, cmd: EditTripCommand): Trip {
        val trip = ownedOrNotFound(accountId, tripId)
        return repo.save(
            trip.edit(
                cmd.title, cmd.startDate, cmd.endDate, cmd.party, cmd.companionType,
                cmd.budgetTotal, withRegionCodes(cmd.destinations), clock.instant(),
            ),
        )
    }

    fun delete(accountId: UUID, tripId: UUID) {
        repo.save(ownedOrNotFound(accountId, tripId).softDelete(clock.instant()))
    }

    /** 없거나 삭제됐거나 타 계정 소유면 404(존재 은닉). */
    private fun ownedOrNotFound(accountId: UUID, tripId: UUID): Trip {
        val trip = repo.findById(tripId)?.takeIf { it.deletedAt == null } ?: throw ResourceNotFound()
        if (trip.accountId != accountId) throw ResourceNotFound()
        return trip
    }
}
