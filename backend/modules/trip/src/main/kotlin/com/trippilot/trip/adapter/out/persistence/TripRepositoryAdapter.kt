package com.trippilot.trip.adapter.out.persistence

import com.trippilot.trip.domain.CompanionType
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import com.trippilot.trip.domain.TripStatus
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

interface TripJpaRepository : JpaRepository<TripEntity, UUID> {
    fun findByAccountId(accountId: UUID): List<TripEntity>
}

interface TripDestinationJpaRepository : JpaRepository<TripDestinationEntity, UUID> {
    fun findByTripIdOrderBySeqAsc(tripId: UUID): List<TripDestinationEntity>

    // 즉시 실행 bulk delete — 파생 deleteBy(em.remove 큐잉)는 flush에서 INSERT 뒤로 밀려
    // 재삽입 시 ux_trip_destination_seq 중복키가 난다(anti-patterns.md).
    @Modifying
    @Query("delete from TripDestinationEntity d where d.tripId = :tripId")
    fun deleteByTripId(@Param("tripId") tripId: UUID)
}

@Component
class TripRepositoryAdapter(
    private val trips: TripJpaRepository,
    private val destinations: TripDestinationJpaRepository,
) : TripRepository {

    @Transactional
    override fun save(trip: Trip): Trip {
        trips.save(trip.toEntity())
        destinations.deleteByTripId(trip.tripId)          // 목적지 전체 교체(생성·편집 공통)
        trip.destinations.forEach {
            destinations.save(
                TripDestinationEntity(UUID.randomUUID(), trip.tripId, it.seq, it.region, it.nights, it.regionCode),
            )
        }
        return trip
    }

    @Transactional(readOnly = true)
    override fun findById(tripId: UUID): Trip? = trips.findById(tripId).orElse(null)?.toDomain()

    @Transactional(readOnly = true)
    override fun findByAccount(accountId: UUID): List<Trip> = trips.findByAccountId(accountId).map { it.toDomain() }

    private fun Trip.toEntity() = TripEntity(
        tripId = tripId, accountId = accountId, title = title, startDate = startDate, endDate = endDate,
        party = party, companionType = companionType?.name, budgetTotal = budgetTotal,
        preferenceSnapshot = preferenceSnapshot.toMutableMap(), status = status.name,
        deletedAt = deletedAt, createdAt = createdAt, updatedAt = updatedAt, endedAt = endedAt,
    )

    private fun TripEntity.toDomain(): Trip {
        val dests = destinations.findByTripIdOrderBySeqAsc(tripId).map { TripDestination(it.seq, it.region, it.nights, it.regionCode) }
        return Trip.reconstitute(
            tripId = tripId, accountId = accountId, title = title, startDate = startDate, endDate = endDate,
            party = party, companionType = companionType?.let { CompanionType.valueOf(it) }, budgetTotal = budgetTotal,
            preferenceSnapshot = preferenceSnapshot, destinations = dests, status = TripStatus.valueOf(status),
            deletedAt = deletedAt, createdAt = createdAt, updatedAt = updatedAt, endedAt = endedAt,
        )
    }
}
