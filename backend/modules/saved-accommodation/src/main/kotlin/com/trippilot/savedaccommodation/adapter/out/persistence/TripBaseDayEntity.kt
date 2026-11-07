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
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
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

    // flush 먼저 — 같은 트랜잭션의 앞선 쓰기(일정 이동)가 clear 에 버려지면 안 된다.
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from TripBaseDayEntity d where d.id.tripId = :tripId")
    fun deleteByTripId(@Param("tripId") tripId: UUID)

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from TripBaseDayEntity d where d.id.tripId = :tripId and (d.id.dayDate < :start or d.id.dayDate > :end)")
    fun deleteOutside(@Param("tripId") tripId: UUID, @Param("start") start: LocalDate, @Param("end") end: LocalDate)
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

    /**
     * 지우고 다시 넣는다 — 날짜가 PK 라 `UPDATE day_date + k` 는 겹치는 칸수에서 아직 안 옮긴 행과 부딪힌다(PK 는 행마다 즉시 검사).
     * 행을 먼저 복사해 둔다 — [TripBaseDayJpaRepository.deleteByTripId] 의 clear 뒤엔 엔티티가 준영속이다.
     */
    @Transactional
    override fun shiftDates(tripId: UUID, days: Long) {
        val moved = jpa.findByIdTripId(tripId).map {
            TripBaseDayEntity(TripBaseDayId(tripId, it.id.dayDate.plusDays(days)), it.savedStayId, it.resolution)
        }
        if (moved.isEmpty()) return
        jpa.deleteByTripId(tripId)
        jpa.saveAllAndFlush(moved)
    }

    @Transactional
    override fun deleteOutside(tripId: UUID, start: LocalDate, end: LocalDate) = jpa.deleteOutside(tripId, start, end)

    private fun TripBaseDayEntity.toDomain() = TripBaseDay(
        id.tripId, id.dayDate, savedStayId, BaseResolution.valueOf(resolution.uppercase()),
    )

    /** DB CHECK 어휘(소문자 스네이크)로 내린다 — 값 집합은 enum 과 같아야 한다. */
    private fun BaseResolution.wire(): String = name.lowercase()
}
