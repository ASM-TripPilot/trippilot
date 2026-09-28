package com.trippilot.itinerarygeneration.application

import com.trippilot.changelog.api.DaySnapshotView
import com.trippilot.changelog.api.ItinerarySnapshotView
import com.trippilot.changelog.api.SlotSnapshotView
import com.trippilot.itinerarygeneration.domain.Itinerary

/**
 * 일정 → 변경 이력 스냅숏(시각·순서만, INV-3 소요시간 없음). 재계획 반영(PLAN_B)과
 * 여행 중 수동 편집(MANUAL)이 같은 이력 축(BR-U4-30)을 쓰므로 변환도 하나여야 한다 —
 * 두 벌이면 한쪽만 고쳐 전/후 스냅숏 모양이 갈린다.
 */
internal fun Itinerary.toChangeLogSnapshot() = ItinerarySnapshotView(
    days.map { day ->
        DaySnapshotView(
            day.date,
            day.slots.map { SlotSnapshotView(it.sourcePoiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) },
        )
    },
)
