package com.trippilot.trip.application

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.placedata.api.DomesticCheck
import com.trippilot.placedata.api.DomesticRegionFacade
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
    private val domesticRegions: DomesticRegionFacade,
    private val clock: Clock,
) {
    fun create(accountId: UUID, cmd: CreateTripCommand): Trip {
        requireDomestic(cmd.destinations)
        return repo.save(
            Trip.create(
                accountId, cmd.title, cmd.startDate, cmd.endDate, cmd.party, cmd.companionType,
                cmd.budgetTotal, cmd.preferenceSnapshot, cmd.destinations, clock.instant(),
            ),
        )
    }

    /**
     * 국내강제(INV-U1-12 · BR-U1-35) — 목적지가 하나라도 대한민국 밖이면 생성하지 않는다.
     *
     * **확인하지 못한 것은 막지 않는다.** 벤더 장애·쿼터 소진이 곧 "여행을 못 만든다"가 되면 안 된다 —
     * 국내강제는 품질 가드지 보안 경계가 아니다. 대신 확인하지 못했다는 사실을 로그로 남긴다(INV-4).
     * (화면 표면화는 후속 — 지금은 생성이 막히지 않는 것이 우선이다.)
     */
    private fun requireDomestic(destinations: List<TripDestination>) {
        val outside = destinations.filter { domesticRegions.check(it.region) == DomesticCheck.OUTSIDE }
        if (outside.isNotEmpty()) {
            throw ValidationFailed(
                outside.map { FieldError("destinations", "지금은 국내 여행만 지원해요: ${it.region}") },
            )
        }
    }

    fun list(accountId: UUID): List<Trip> = repo.findByAccount(accountId).filter { it.deletedAt == null }

    fun get(accountId: UUID, tripId: UUID): Trip = ownedOrNotFound(accountId, tripId)

    fun edit(accountId: UUID, tripId: UUID, cmd: EditTripCommand): Trip {
        val trip = ownedOrNotFound(accountId, tripId)
        return repo.save(
            trip.edit(
                cmd.title, cmd.startDate, cmd.endDate, cmd.party, cmd.companionType,
                cmd.budgetTotal, cmd.destinations, clock.instant(),
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
