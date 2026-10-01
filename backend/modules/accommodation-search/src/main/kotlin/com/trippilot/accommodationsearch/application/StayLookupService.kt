package com.trippilot.accommodationsearch.application

import com.trippilot.accommodationsearch.api.StayLookupFacade
import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.StayKey
import org.springframework.stereotype.Service

/** [StayLookupFacade] 구현 — 상세와 같은 콘텐츠 포트를 읽는다(별도 저장소를 만들지 않는다). */
@Service
class StayLookupService(
    private val content: AccommodationContentPort,
) : StayLookupFacade {
    override fun findName(stayId: String): String? = content.findOne(StayKey.parse(stayId))?.name
}
