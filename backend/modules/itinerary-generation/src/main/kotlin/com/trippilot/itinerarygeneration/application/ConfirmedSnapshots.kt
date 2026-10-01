package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.VisitSlot
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * CONFIRMED 일정에 **쓰기가 열리면서**(TRIP-999 결정 (a) — 여행 중 편집·재계획 반영 허용) 생긴 자리.
 * 종전에는 CONFIRMED 에 쓰는 경로가 없어 동결(INV-U1-03)이 확정 한 번으로 완비됐지만, 이제 편집과
 * 재계획 반영이 슬롯을 갈아끼우므로 그때마다 동결을 이어 줘야 한다 — 안 그러면 편집 한 번에 전 슬롯의
 * 스냅숏 참조가 조용히 사라지고, 원본 POI 가 폐업하는 순간 확정 일정에서 장소가 증발한다.
 *
 * - 이미 동결된 POI 는 참조를 **그대로 잇는다**(결정 (a): "확정 스냅숏 동결은 유지")
 * - 새로 들어온 POI 는 **지금 동결한다**. 못 얼리면(비-ACTIVE·소실) null 로 두고 경고만 남긴다 —
 *   편집은 비차단(US-SCHED-07)이라 동결 실패가 저장을 막지 않고, null 은 표면 조회가
 *   정본(live) 폴백으로 받친다(SlotSurfaceAssembler).
 */
internal object ConfirmedSnapshots {

    /** [prior] 가 CONFIRMED 가 아니면 그대로 돌려준다 — PLANNED 편집엔 동결 개념이 없다. */
    fun carry(edited: Itinerary, prior: Itinerary, freeze: (UUID) -> UUID?): Itinerary {
        if (prior.status != ItineraryStatus.CONFIRMED) return edited
        val byPoi = prior.days.flatMap { it.slots }
            .mapNotNull { s -> s.poiSnapshotId?.let { s.sourcePoiId to it } }
            .toMap()
        // 같은 POI 가 여러 슬롯에 오면 한 번만 얼린다 — 스냅숏은 POI 단위 값이다.
        val newlyFrozen = mutableMapOf<UUID, UUID?>()
        val days = edited.days.map { d ->
            ItineraryDay.of(
                d.date, d.dayOrder,
                d.slots.map { s ->
                    val snapshot = s.poiSnapshotId
                        ?: byPoi[s.sourcePoiId]
                        ?: newlyFrozen.getOrPut(s.sourcePoiId) {
                            freeze(s.sourcePoiId).also {
                                if (it == null) {
                                    log.warn(
                                        "확정 일정에 새로 들어온 POI 동결 실패 — 표면은 정본 폴백으로 그려진다(INV-U1-03 약화). poiId={}",
                                        s.sourcePoiId,
                                    )
                                }
                            }
                        }
                    if (snapshot == s.poiSnapshotId) {
                        s
                    } else {
                        VisitSlot.of(
                            s.sourcePoiId, snapshot, s.orderIndex, s.startAt, s.endAt, s.isFixed,
                            s.hasViolation, s.endsNextDay, s.distanceRange, s.placementReason,
                            s.violationReason, s.alternatives,
                        )
                    }
                },
            )
        }
        return Itinerary.reconstitute(
            edited.itineraryId, edited.tripId, edited.status, edited.solveMode, edited.generationMode,
            edited.isFallback, edited.generationState, days, edited.createdAt, edited.updatedAt,
            edited.candidatesSummary, edited.unplacedMustVisits,
        )
    }

    private val log = LoggerFactory.getLogger(ConfirmedSnapshots::class.java)
}
