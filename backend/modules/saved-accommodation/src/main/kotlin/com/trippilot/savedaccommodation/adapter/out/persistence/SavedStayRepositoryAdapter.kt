package com.trippilot.savedaccommodation.adapter.out.persistence

import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.util.UUID

interface SavedStayJpaRepository : JpaRepository<SavedStayEntity, UUID> {
    fun findByAccountId(accountId: UUID): List<SavedStayEntity>
}

@Component
class SavedStayRepositoryAdapter(
    private val jpa: SavedStayJpaRepository,
) : SavedStayRepository {

    override fun save(stay: SavedStay): SavedStay = jpa.save(stay.toEntity()).toDomain()

    override fun findById(savedStayId: UUID): SavedStay? =
        jpa.findById(savedStayId).orElse(null)?.toDomain()

    override fun findByAccount(accountId: UUID): List<SavedStay> =
        jpa.findByAccountId(accountId).map { it.toDomain() }

    override fun delete(stay: SavedStay) = jpa.deleteById(stay.savedStayId)

    private fun SavedStay.toEntity() = SavedStayEntity(
        savedStayId = savedStayId, accountId = accountId, name = name, lat = lat, lng = lng,
        coordConfirmed = coordConfirmed, checkIn = checkIn, checkOut = checkOut,
        externalSource = externalSource, externalId = externalId, registerRoute = registerRoute.name,
        memo = memo, createdAt = createdAt, updatedAt = updatedAt,
    )

    private fun SavedStayEntity.toDomain() = SavedStay.reconstitute(
        savedStayId = savedStayId, accountId = accountId, name = name, lat = lat, lng = lng,
        coordConfirmed = coordConfirmed, checkIn = checkIn, checkOut = checkOut,
        externalSource = externalSource, externalId = externalId,
        registerRoute = RegisterRoute.valueOf(registerRoute),
        memo = memo, createdAt = createdAt, updatedAt = updatedAt,
    )
}
