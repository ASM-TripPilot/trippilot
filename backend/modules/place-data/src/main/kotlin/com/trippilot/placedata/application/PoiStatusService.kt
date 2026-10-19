package com.trippilot.placedata.application

import com.trippilot.placedata.api.PoiLifeStatus
import com.trippilot.placedata.api.PoiStatusFacade
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.PoiRepository
import org.springframework.stereotype.Service
import java.util.UUID

/** POI 생애 상태(BR-SA-17) — 상태 무관 일괄 조회(`findByIds`)를 감지의 세 갈래로 접는다. */
@Service
class PoiStatusService(private val pois: PoiRepository) : PoiStatusFacade {

    override fun statusOf(poiIds: Collection<UUID>): Map<UUID, PoiLifeStatus> {
        if (poiIds.isEmpty()) return emptyMap()
        return pois.findByIds(poiIds.distinct()).associate { it.poiId to lifeOf(it.dataStatus) }
    }

    private fun lifeOf(status: DataStatus): PoiLifeStatus = when (status) {
        DataStatus.ACTIVE -> PoiLifeStatus.ACTIVE
        DataStatus.CLOSED -> PoiLifeStatus.CLOSED
        // 원본 목록에서 빠졌거나(LOST) 확인 전(UNVERIFIED)이다 — 폐업 증거가 아니다.
        DataStatus.LOST, DataStatus.UNVERIFIED -> PoiLifeStatus.OTHER
    }
}
