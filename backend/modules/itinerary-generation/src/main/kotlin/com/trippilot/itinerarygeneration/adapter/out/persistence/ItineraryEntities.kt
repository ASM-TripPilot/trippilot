package com.trippilot.itinerarygeneration.adapter.out.persistence

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** itinerary(V2.7). 일정 애그리거트 루트. status·solve_mode 문자열. */
@Entity
@Table(name = "itinerary")
class ItineraryEntity(
    @Id @Column(name = "itinerary_id") var itineraryId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "status") var status: String,
    @Column(name = "solve_mode") var solveMode: String,
    @Column(name = "generation_mode") var generationMode: String,
    @Column(name = "is_fallback") var isFallback: Boolean,
    @Column(name = "generation_state") var generationState: String,
    @Column(name = "created_at") var createdAt: Instant,
    @Column(name = "updated_at") var updatedAt: Instant,
    // 후보 충분성(BR-U2-05) — AI 판정값 그대로. Map 으로 jsonb 매핑(문자열 선직렬화 시 이중 인코딩).
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "candidates_summary") var candidatesSummary: Map<String, Any>?,
    // 미배치 필수 방문지 보고(계약 M2). 빈 배열 = 전부 배치됨.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "unplaced_must_visits") var unplacedMustVisits: List<Map<String, Any>>,
)

/** itinerary_day(V2.7). 일자별. */
@Entity
@Table(name = "itinerary_day")
class ItineraryDayEntity(
    @Id @Column(name = "itinerary_day_id") var itineraryDayId: UUID,
    @Column(name = "itinerary_id") var itineraryId: UUID,
    @Column(name = "day_date") var dayDate: LocalDate,
    @Column(name = "day_order") var dayOrder: Int,
)

/** visit_slot(V2.7). 소요시간(duration) 컬럼 없음(INV-3). poi_snapshot_id는 확정 시 동결(그전 null). */
@Entity
@Table(name = "visit_slot")
class VisitSlotEntity(
    @Id @Column(name = "visit_slot_id") var visitSlotId: UUID,
    @Column(name = "itinerary_day_id") var itineraryDayId: UUID,
    @Column(name = "source_poi_id") var sourcePoiId: UUID,
    @Column(name = "poi_snapshot_id") var poiSnapshotId: UUID?,
    @Column(name = "order_index") var orderIndex: Int,
    @Column(name = "start_at") var startAt: LocalTime,
    @Column(name = "end_at") var endAt: LocalTime,
    @Column(name = "is_fixed") var isFixed: Boolean,
    @Column(name = "has_violation") var hasViolation: Boolean,
    @Column(name = "ends_next_day") var endsNextDay: Boolean,
    @Column(name = "distance_range") var distanceRange: String?,
    @Column(name = "placement_reason") var placementReason: String?,
    @Column(name = "violation_reason") var violationReason: String?,
)

interface ItineraryJpaRepository : JpaRepository<ItineraryEntity, UUID> {
    fun findByTripId(tripId: UUID): List<ItineraryEntity>

    // 여행 일정 교체용 — itinerary 삭제 시 day/slot은 DB FK ON DELETE CASCADE로 함께 제거.
    @Modifying(clearAutomatically = true)
    @Query("delete from ItineraryEntity i where i.tripId = :tripId")
    fun deleteByTripId(@Param("tripId") tripId: UUID)

    // 조건부 교체용 — 지울 대상을 id·생성상태로 못박아 "읽고-쓰는 사이 재생성" 창을 없앤다.
    @Modifying(clearAutomatically = true)
    @Query(
        "delete from ItineraryEntity i " +
            "where i.tripId = :tripId and i.itineraryId = :itineraryId and i.generationState = :state",
    )
    fun deleteIfCurrent(
        @Param("tripId") tripId: UUID,
        @Param("itineraryId") itineraryId: UUID,
        @Param("state") state: String,
    ): Int

    fun findByGenerationStateAndUpdatedAtBefore(generationState: String, updatedAt: Instant): List<ItineraryEntity>
}

interface ItineraryDayJpaRepository : JpaRepository<ItineraryDayEntity, UUID> {
    fun findByItineraryIdOrderByDayOrderAsc(itineraryId: UUID): List<ItineraryDayEntity>

    // 자식 교체 시 bulk delete(즉시 실행)로 INSERT-before-DELETE 순서 문제 회피(anti-patterns.md).
    // clearAutomatically: bulk delete가 L1 컨텍스트를 비워, 삭제된 옛 엔티티가 같은 tx에 잔존하지 않게(재저장 스테일 방지).
    @Modifying(clearAutomatically = true)
    @Query("delete from ItineraryDayEntity d where d.itineraryId = :itineraryId")
    fun deleteByItineraryId(@Param("itineraryId") itineraryId: UUID)
}

interface VisitSlotJpaRepository : JpaRepository<VisitSlotEntity, UUID> {
    fun findByItineraryDayIdInOrderByOrderIndexAsc(dayIds: Collection<UUID>): List<VisitSlotEntity>

    @Modifying(clearAutomatically = true)
    @Query("delete from VisitSlotEntity s where s.itineraryDayId in :dayIds")
    fun deleteByItineraryDayIdIn(@Param("dayIds") dayIds: Collection<UUID>)
}
