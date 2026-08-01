package com.trippilot.savedaccommodation.adapter.out.external

import com.trippilot.savedaccommodation.domain.GeocodeCandidate
import com.trippilot.savedaccommodation.domain.PlaceSearchPort
import org.springframework.stereotype.Component

/**
 * 1차 스텁 지오코딩 어댑터. 질의당 제주 후보 2건(multi-candidate 흐름 검증용).
 * 실 카카오 로컬 어댑터로 교체 예정(키 서버 프록시·실패 시 핀 폴백).
 */
@Component
class StubPlaceSearchAdapter : PlaceSearchPort {
    override fun geocode(query: String): List<GeocodeCandidate> = listOf(
        GeocodeCandidate("$query", "제주특별자치도 제주시", 33.4996, 126.5312),
        GeocodeCandidate("$query 인근", "제주특별자치도 서귀포시", 33.2541, 126.5601),
    )
}
