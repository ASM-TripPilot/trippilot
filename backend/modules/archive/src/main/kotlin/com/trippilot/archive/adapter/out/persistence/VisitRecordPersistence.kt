package com.trippilot.archive.adapter.out.persistence

import com.trippilot.archive.domain.VisitMemo
import com.trippilot.archive.domain.VisitMemoRepository
import com.trippilot.archive.domain.VisitPhotoMeta
import com.trippilot.archive.domain.VisitPhotoMetaRepository
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/** visit_photo_meta 매핑(V2.33). **바이너리·storage_key 컬럼은 없다**(INV-U5-03). */
@Entity
@Table(name = "visit_photo_meta")
class VisitPhotoMetaEntity(
    @Id @Column(name = "visit_photo_meta_id") var visitPhotoMetaId: UUID,
    @Column(name = "visit_check_id") var visitCheckId: UUID,
    @Column(name = "local_asset_id") var localAssetId: String,
    @Column(name = "device_id") var deviceId: String,
    @Column(name = "taken_at") var takenAt: Instant?,
    @Column(name = "exif_lat") var exifLat: Double?,
    @Column(name = "exif_lng") var exifLng: Double?,
    @Column(name = "sort_order") var sortOrder: Int,
)

interface VisitPhotoMetaJpaRepository : JpaRepository<VisitPhotoMetaEntity, UUID> {
    // sort_order 동률은 id 로 갈라 순서를 결정론적으로 — 같은 순서로 두 장이 붙을 수 있다.
    fun findByVisitCheckIdOrderBySortOrderAscVisitPhotoMetaIdAsc(visitCheckId: UUID): List<VisitPhotoMetaEntity>
}

/** visit_memo 매핑(V2.34). PK 가 `visit_check_id` 라 한 방문에 한 개가 물리적으로 보장된다. */
@Entity
@Table(name = "visit_memo")
class VisitMemoEntity(
    @Id @Column(name = "visit_check_id") var visitCheckId: UUID,
    @Column(name = "text") var text: String,
    @Column(name = "updated_at") var updatedAt: Instant,
)

@Component
class VisitPhotoMetaRepositoryAdapter(
    private val jpa: VisitPhotoMetaJpaRepository,
    private val jdbc: JdbcTemplate,
) : VisitPhotoMetaRepository {

    override fun save(photo: VisitPhotoMeta): VisitPhotoMeta = jpa.save(photo.toEntity()).toDomain()

    override fun findByVisit(visitCheckId: UUID): List<VisitPhotoMeta> =
        jpa.findByVisitCheckIdOrderBySortOrderAscVisitPhotoMetaIdAsc(visitCheckId).map { it.toDomain() }

    override fun findById(visitPhotoMetaId: UUID): VisitPhotoMeta? =
        jpa.findById(visitPhotoMetaId).orElse(null)?.toDomain()

    override fun delete(visitPhotoMetaId: UUID): Boolean =
        jdbc.update("DELETE FROM visit_photo_meta WHERE visit_photo_meta_id = ?", visitPhotoMetaId) == 1

    /**
     * 개수만 센다 — 목록을 읽어 세면 방문 수 × 사진 수만큼 행이 오간다. 화면과 AI 컨텍스트 둘 다
     * 개수만 쓰므로 그 이상 가져올 이유가 없다.
     */
    override fun countByVisits(visitCheckIds: Collection<UUID>): Map<UUID, Int> {
        if (visitCheckIds.isEmpty()) return emptyMap()
        val rows = jdbc.queryForList(
            "SELECT visit_check_id, count(*) AS n FROM visit_photo_meta WHERE visit_check_id = ANY (?) GROUP BY visit_check_id",
            visitCheckIds.toTypedArray(),
        )
        return rows.associate { it["visit_check_id"] as UUID to (it["n"] as Number).toInt() }
    }

    private fun VisitPhotoMeta.toEntity() = VisitPhotoMetaEntity(
        visitPhotoMetaId = visitPhotoMetaId,
        visitCheckId = visitCheckId,
        localAssetId = localAssetId,
        deviceId = deviceId,
        takenAt = takenAt,
        exifLat = exifLat,
        exifLng = exifLng,
        sortOrder = sortOrder,
    )

    private fun VisitPhotoMetaEntity.toDomain() = VisitPhotoMeta(
        visitPhotoMetaId = visitPhotoMetaId,
        visitCheckId = visitCheckId,
        localAssetId = localAssetId,
        deviceId = deviceId,
        takenAt = takenAt,
        exifLat = exifLat,
        exifLng = exifLng,
        sortOrder = sortOrder,
    )
}

@Component
class VisitMemoRepositoryAdapter(
    private val jdbc: JdbcTemplate,
) : VisitMemoRepository {

    /**
     * JPA `save` 대신 네이티브 upsert 를 쓰는 이유는 [created_at] 때문이다 — JPA 로 하면 기존 행을
     * 통째로 덮어써 "언제 처음 썼나"가 갱신 시각으로 밀린다. `ON CONFLICT` 는 그 칸을 건드리지 않는다.
     */
    override fun upsert(memo: VisitMemo): VisitMemo {
        jdbc.update(
            """
            INSERT INTO visit_memo (visit_check_id, text, updated_at) VALUES (?, ?, ?)
            ON CONFLICT (visit_check_id) DO UPDATE SET text = EXCLUDED.text, updated_at = EXCLUDED.updated_at
            """.trimIndent(),
            memo.visitCheckId, memo.text, java.sql.Timestamp.from(memo.updatedAt),
        )
        return memo
    }

    override fun find(visitCheckId: UUID): VisitMemo? = jdbc.query(
        "SELECT visit_check_id, text, updated_at FROM visit_memo WHERE visit_check_id = ?",
        { rs, _ ->
            VisitMemo(
                visitCheckId = rs.getObject("visit_check_id", UUID::class.java),
                text = rs.getString("text"),
                updatedAt = rs.getTimestamp("updated_at").toInstant(),
            )
        },
        visitCheckId,
    ).firstOrNull()

    override fun delete(visitCheckId: UUID): Boolean =
        jdbc.update("DELETE FROM visit_memo WHERE visit_check_id = ?", visitCheckId) == 1
}
