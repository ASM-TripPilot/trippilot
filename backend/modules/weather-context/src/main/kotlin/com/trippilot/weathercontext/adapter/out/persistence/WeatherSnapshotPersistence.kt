package com.trippilot.weathercontext.adapter.out.persistence

import com.trippilot.weathercontext.domain.WeatherSnapshot
import com.trippilot.weathercontext.domain.WeatherSnapshotRepository
import jakarta.persistence.Column
import jakarta.persistence.Embeddable
import jakarta.persistence.EmbeddedId
import jakarta.persistence.Entity
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.io.Serializable
import java.time.Instant

/** weather_snapshot 매핑(V2.19). PK 가 (격자, 발표시각) 복합키다 — 새 발표가 곧 새 행이다. */
@Embeddable
data class WeatherSnapshotId(
    @Column(name = "grid_key") var gridKey: String = "",
    @Column(name = "base_at") var baseAt: Instant = Instant.EPOCH,
) : Serializable

@Entity
@Table(name = "weather_snapshot")
class WeatherSnapshotEntity(
    @EmbeddedId var id: WeatherSnapshotId,
    @Column(name = "precip_probability") var precipProbability: Int,
    @Column(name = "warning") var warning: String?,
    @Column(name = "fetched_at") var fetchedAt: Instant,
    @Column(name = "expires_at") var expiresAt: Instant,
) {
    protected constructor() : this(WeatherSnapshotId(), 0, null, Instant.EPOCH, Instant.EPOCH)
}

interface WeatherSnapshotJpaRepository : JpaRepository<WeatherSnapshotEntity, WeatherSnapshotId> {
    fun findFirstByIdGridKeyOrderByIdBaseAtDesc(gridKey: String): WeatherSnapshotEntity?
}

@Component
class WeatherSnapshotPersistence(private val jpa: WeatherSnapshotJpaRepository) : WeatherSnapshotRepository {

    override fun save(snapshot: WeatherSnapshot): WeatherSnapshot =
        jpa.saveAndFlush(
            WeatherSnapshotEntity(
                WeatherSnapshotId(snapshot.gridKey, snapshot.baseAt),
                snapshot.precipProbability, snapshot.warning, snapshot.fetchedAt, snapshot.expiresAt,
            ),
        ).toDomain()

    override fun findLatest(gridKey: String): WeatherSnapshot? =
        jpa.findFirstByIdGridKeyOrderByIdBaseAtDesc(gridKey)?.toDomain()

    private fun WeatherSnapshotEntity.toDomain() =
        WeatherSnapshot(id.gridKey, id.baseAt, precipProbability, warning, fetchedAt, expiresAt)
}
