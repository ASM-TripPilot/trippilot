package com.trippilot.placedata.adapter.out.external

import com.trippilot.placedata.domain.Area
import com.trippilot.placedata.domain.MapPlacePort
import com.trippilot.placedata.domain.NormalizedPlace
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSource
import org.springframework.stereotype.Component

/**
 * MapPlacePort 스텁(1차) — 실 벤더(카카오 로컬·TourAPI) 연동 전까지 시드 후보 반환.
 * 실 어댑터는 벤더 응답을 각자 [NormalizedPlace]로 정규화하고 캐싱 금지·실시간·출처를 지킨다.
 * 시드엔 일부러 **좌표 미확보 후보**를 섞어 수집 게이트(INV-1) 배제를 실증한다.
 */
@Component
class StubMapPlaceAdapter : MapPlacePort {

    override fun search(area: Area, category: PoiCategory?): List<NormalizedPlace> {
        val all = SEED[area.region].orEmpty()
        return if (category == null) all else all.filter { it.category == category }
    }

    companion object {
        private val SEED: Map<String, List<NormalizedPlace>> = mapOf(
            "부산" to listOf(
                NormalizedPlace("자갈치시장", 35.0965, 129.0306, PoiCategory.맛집, "부산", null, PoiSource.MANUAL),
                NormalizedPlace("해운대해수욕장", 35.1587, 129.1604, PoiCategory.자연, "부산", null, PoiSource.MANUAL),
                NormalizedPlace("감천문화마을", 35.0975, 129.0107, PoiCategory.명소, "부산", null, PoiSource.MANUAL),
                // 좌표 미확보 → 게이트 배제(후보풀 미통과)
                NormalizedPlace("좌표없는후보", null, null, PoiCategory.명소, "부산", null, PoiSource.MANUAL),
            ),
        )
    }
}
