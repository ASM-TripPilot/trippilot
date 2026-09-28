package com.trippilot.savedaccommodation.adapter.out.persistence

import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.util.UUID

interface SavedStayJpaRepository : JpaRepository<SavedStayEntity, UUID> {
    fun findByAccountId(accountId: UUID): List<SavedStayEntity>
    fun existsByAccountIdAndExternalSourceAndExternalId(accountId: UUID, externalSource: String, externalId: String): Boolean
}

@Component
class SavedStayRepositoryAdapter(
    private val jpa: SavedStayJpaRepository,
) : SavedStayRepository {

    // saveAndFlush — ux_saved_stay_external 위반(동시 등록 경합)을 커밋 전에 표면화해 서비스가
    // 409 로 변환할 수 있게(TRIP-1059 · SavedPlaceRepositoryAdapter 선례). 커밋까지 미루면
    // DataIntegrityViolation 이 @Transactional 경계에서 터져 catch 를 비껴가 500 이 된다.
    override fun save(stay: SavedStay): SavedStay = jpa.saveAndFlush(stay.toEntity()).toDomain()

    override fun findById(savedStayId: UUID): SavedStay? =
        jpa.findById(savedStayId).orElse(null)?.toDomain()

    override fun findByAccount(accountId: UUID): List<SavedStay> =
        jpa.findByAccountId(accountId).map { it.toDomain() }

    override fun delete(stay: SavedStay) = jpa.deleteById(stay.savedStayId)

    override fun existsByAccountAndExternal(accountId: UUID, externalSource: String, externalId: String): Boolean =
        jpa.existsByAccountIdAndExternalSourceAndExternalId(accountId, externalSource, externalId)

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
