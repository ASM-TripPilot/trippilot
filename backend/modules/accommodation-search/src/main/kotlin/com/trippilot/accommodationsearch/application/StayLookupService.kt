package com.trippilot.accommodationsearch.application

import com.trippilot.accommodationsearch.api.StayLookupFacade
import com.trippilot.accommodationsearch.api.TRIPCOM_STAY_SOURCE
import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.CuratedStayPort
import com.trippilot.accommodationsearch.domain.StayKey
import org.springframework.stereotype.Service

/**
 * [StayLookupFacade] 구현 — 상세와 같은 콘텐츠 포트를 읽는다(별도 저장소를 만들지 않는다).
 * 트립닷컴 큐레이션 출처(`TRIPCOM:`)는 정본에 없으므로 큐레이션 테이블에서 찾는다.
 */
@Service
class StayLookupService(
    private val content: AccommodationContentPort,
    private val curated: CuratedStayPort,
) : StayLookupFacade {
    override fun findName(stayId: String): String? {
        val key = StayKey.parse(stayId)
        if (key.externalSource == TRIPCOM_STAY_SOURCE) return curated.findByHotelId(key.externalId)?.name
        return content.findOne(key)?.name
    }
}
