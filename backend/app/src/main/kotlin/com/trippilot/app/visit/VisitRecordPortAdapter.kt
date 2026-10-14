package com.trippilot.app.visit

import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.itinerarygeneration.domain.VisitRecordPort
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 일정 생성의 [VisitRecordPort] ↔ 방문 실적(archive) 연결 — `archive → itinerary-generation` 순환을 피해
 * app 이 조립한다(`PersonalizationPortAdapter` 와 같은 꼴). 판정은 하지 않고 타입만 옮긴다.
 */
@Component
class VisitRecordPortAdapter(private val records: ArchiveRecordFacade) : VisitRecordPort {

    override fun hasAny(tripId: UUID): Boolean = records.findDailyVisits(tripId).isNotEmpty()
}
