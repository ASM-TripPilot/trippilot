package com.trippilot.savedaccommodation.adapter.out.persistence

import com.trippilot.savedaccommodation.domain.BaseResolution
import com.trippilot.savedaccommodation.domain.TripBaseDay
import com.trippilot.savedaccommodation.domain.TripBaseDayRepository
import jakarta.persistence.Column
import jakarta.persistence.Embeddable
import jakarta.persistence.EmbeddedId
import jakarta.persistence.Entity
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.io.Serializable
import java.time.LocalDate
import java.util.UUID

/**
 * trip_base_day(V2.4) 매핑 — 하루 1행(복합 PK). 새 마이그레이션이 없다:
 * 테이블은 V2.4 에 이미 있었고 **쓰는 코드만 없었다**(TRIP-190).
 *
 * `resolution` 은 DB CHECK 가 소문자 어휘(`auto`·`user_pick`…)를 강제하므로 enum 이름을 그대로 쓰지 않고 내린다.
 */
@Embeddable
data class TripBaseDayId(
    @Column(name = "trip_id") var tripId: UUID = UUID(0, 0),
    @Column(name = "day_date") var dayDate: LocalDate = LocalDate.EPOCH,
) : Serializable

@Entity
@Table(name = "trip_base_day")
class TripBaseDayEntity(
    @EmbeddedId var id: TripBaseDayId,
    @Column(name = "saved_stay_id") var savedStayId: UUID?,
    @Column(name = "resolution") var resolution: String,
) {
    protected constructor() : this(TripBaseDayId(), null, "")
}

interface TripBaseDayJpaRepository : JpaRepository<TripBaseDayEntity, TripBaseDayId> {
    fun findByIdTripId(tripId: UUID): List<TripBaseDayEntity>
}

@Component
class TripBaseDayRepositoryAdapter(
    private val jpa: TripBaseDayJpaRepository,
) : TripBaseDayRepository {

    override fun findByTrip(tripId: UUID): List<TripBaseDay> =
        jpa.findByIdTripId(tripId).map { it.toDomain() }

    override fun save(day: TripBaseDay): TripBaseDay = jpa.save(
        TripBaseDayEntity(TripBaseDayId(day.tripId, day.dayDate), day.savedStayId, day.resolution.wire()),
    ).toDomain()

    private fun TripBaseDayEntity.toDomain() = TripBaseDay(
        id.tripId, id.dayDate, savedStayId, BaseResolution.valueOf(resolution.uppercase()),
    )

    /** DB CHECK 어휘(소문자 스네이크)로 내린다 — 값 집합은 enum 과 같아야 한다. */
    private fun BaseResolution.wire(): String = name.lowercase()
}
