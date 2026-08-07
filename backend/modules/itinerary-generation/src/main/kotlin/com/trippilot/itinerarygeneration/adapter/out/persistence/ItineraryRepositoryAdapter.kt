package com.trippilot.itinerarygeneration.adapter.out.persistence

import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

/**
 * 일정 애그리거트 영속 — itinerary/day/slot 3테이블에 명시 매핑(플랫 엔티티 + 어댑터 조립, 코드베이스 관례).
 * 저장은 자식(day·slot) 전체 교체(생성·편집 공통) — bulk delete 후 재삽입.
 */
@Component
class ItineraryRepositoryAdapter(
    private val itineraries: ItineraryJpaRepository,
    private val days: ItineraryDayJpaRepository,
    private val slots: VisitSlotJpaRepository,
) : ItineraryRepository {

    @Transactional
    override fun save(itinerary: Itinerary): Itinerary {
        // 기존 자식 제거(있으면) — slot 먼저(FK), 그다음 day. bulk delete로 즉시 실행.
        val existingDayIds = days.findByItineraryIdOrderByDayOrderAsc(itinerary.itineraryId).map { it.itineraryDayId }
        if (existingDayIds.isNotEmpty()) {
            slots.deleteByItineraryDayIdIn(existingDayIds)
            days.deleteByItineraryId(itinerary.itineraryId)
        }
        itineraries.save(itinerary.toEntity())
        itinerary.days.forEach { day ->
            val dayId = UUID.randomUUID()
            days.save(ItineraryDayEntity(dayId, itinerary.itineraryId, day.date, day.dayOrder))
            day.slots.forEach { s ->
                slots.save(
                    VisitSlotEntity(
                        UUID.randomUUID(), dayId, s.sourcePoiId, s.poiSnapshotId,
                        s.orderIndex, s.startAt, s.endAt, s.isFixed, s.hasViolation, s.endsNextDay, s.distanceRange,
                    ),
                )
            }
        }
        return itinerary
    }

    @Transactional
    override fun replaceForTrip(tripId: UUID, itinerary: Itinerary): Itinerary {
        itineraries.deleteByTripId(tripId) // 기존 일정 제거(day/slot은 DB FK cascade) — 여행당 1개
        return save(itinerary)
    }

    @Transactional
    override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary): Boolean {
        // 삭제가 한 행도 못 지웠다 = 그 사이 재생성·전이가 일어났다 → 아무것도 쓰지 않는다.
        if (itineraries.deleteIfCurrent(tripId, expectedItineraryId, GenerationState.PARTIAL.name) == 0) return false
        save(itinerary)
        return true
    }

    override fun findStalePartial(updatedBefore: Instant): List<Itinerary> =
        itineraries.findByGenerationStateAndUpdatedAtBefore(GenerationState.PARTIAL.name, updatedBefore)
            .map { it.toDomain() }

    override fun findById(itineraryId: UUID): Itinerary? =
        itineraries.findById(itineraryId).orElse(null)?.toDomain()

    override fun findByTrip(tripId: UUID): List<Itinerary> =
        itineraries.findByTripId(tripId).map { it.toDomain() }

    private fun ItineraryEntity.toDomain(): Itinerary {
        val dayEntities = days.findByItineraryIdOrderByDayOrderAsc(itineraryId)
        val slotsByDay = if (dayEntities.isEmpty()) {
            emptyMap()
        } else {
            slots.findByItineraryDayIdInOrderByOrderIndexAsc(dayEntities.map { it.itineraryDayId })
                .groupBy { it.itineraryDayId }
        }
        val domainDays = dayEntities.map { d ->
            ItineraryDay.of(
                d.dayDate, d.dayOrder,
                (slotsByDay[d.itineraryDayId] ?: emptyList()).map { s ->
                    VisitSlot.of(
                        s.sourcePoiId, s.poiSnapshotId, s.orderIndex, s.startAt, s.endAt, s.isFixed, s.hasViolation,
                        s.endsNextDay, s.distanceRange,
                    )
                },
            )
        }
        return Itinerary.reconstitute(
            itineraryId, tripId, ItineraryStatus.valueOf(status), SolveMode.valueOf(solveMode),
            isFallback, GenerationState.valueOf(generationState), domainDays, createdAt, updatedAt,
        )
    }

    private fun Itinerary.toEntity() =
        ItineraryEntity(itineraryId, tripId, status.name, solveMode.name, isFallback, generationState.name, createdAt, updatedAt)
}
