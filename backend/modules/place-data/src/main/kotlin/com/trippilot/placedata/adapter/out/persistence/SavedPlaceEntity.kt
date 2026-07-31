package com.trippilot.placedata.adapter.out.persistence

import com.trippilot.placedata.domain.SavedPlace
import com.trippilot.placedata.domain.SavedPlaceRepository
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/** saved_place(V2.0) 매핑. (account_id, poi_id) 유일(ux_saved_place). */
@Entity
@Table(name = "saved_place")
class SavedPlaceEntity(
    @Id @Column(name = "saved_place_id") var savedPlaceId: UUID,
    @Column(name = "account_id") var accountId: UUID,
    @Column(name = "poi_id") var poiId: UUID,
    @Column(name = "saved_at") var savedAt: Instant,
)

interface SavedPlaceJpaRepository : JpaRepository<SavedPlaceEntity, UUID> {
    fun findByAccountId(accountId: UUID): List<SavedPlaceEntity>
    fun existsByAccountIdAndPoiId(accountId: UUID, poiId: UUID): Boolean
}

@Component
class SavedPlaceRepositoryAdapter(
    private val jpa: SavedPlaceJpaRepository,
) : SavedPlaceRepository {

    // saveAndFlush — (account, poi) 유니크 위반(경합)을 커밋 전에 표면화해 서비스가 409 로 변환할 수 있게.
    override fun save(savedPlace: SavedPlace): SavedPlace = jpa.saveAndFlush(savedPlace.toEntity()).let { savedPlace }
    override fun findByAccount(accountId: UUID) = jpa.findByAccountId(accountId).map { it.toDomain() }
    override fun findById(savedPlaceId: UUID) = jpa.findById(savedPlaceId).orElse(null)?.toDomain()
    override fun existsByAccountAndPoi(accountId: UUID, poiId: UUID) = jpa.existsByAccountIdAndPoiId(accountId, poiId)
    override fun delete(savedPlace: SavedPlace) = jpa.deleteById(savedPlace.savedPlaceId)

    private fun SavedPlace.toEntity() = SavedPlaceEntity(savedPlaceId, accountId, poiId, savedAt)
    private fun SavedPlaceEntity.toDomain() = SavedPlace.reconstitute(savedPlaceId, accountId, poiId, savedAt)
}
