package com.trippilot.trip.application

import com.trippilot.core.error.ResourceNotFound
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
    private val clock: Clock,
) {
    fun create(accountId: UUID, cmd: CreateTripCommand): Trip =
        repo.save(
            Trip.create(
                accountId, cmd.title, cmd.startDate, cmd.endDate, cmd.party, cmd.companionType,
                cmd.budgetTotal, cmd.preferenceSnapshot, cmd.destinations, clock.instant(),
            ),
        )

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
