package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.placedata.api.PoiSurfaceFacade
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * 일정 슬롯의 표시용 POI 표면 합성(BR-U3-09 · DEC-U3-9).
 * 슬롯은 poiId 만 들고 있어 화면이 장소명·좌표·사진·영업시간을 못 그린다 — 응답에 실어 **추가 왕복 0** 으로 만든다.
 *
 * 확정된 슬롯은 **동결값(INV-U1-03)이 이깁니다** — 원본이 폐업·개명돼도 확정 당시의 장소를 보여야 한다.
 * 다만 동결 범위는 이름·좌표·카테고리뿐이라(poi_snapshot 스키마) 사진·영업시간은 정본에서 best-effort 로 채운다.
 */
@Service
class SlotSurfaceAssembler(private val poiSurfaces: PoiSurfaceFacade) {

    fun assemble(itinerary: Itinerary): Map<UUID, SlotSurface> {
        val slots = itinerary.days.flatMap { it.slots }
        if (slots.isEmpty()) return emptyMap()

        val live = poiSurfaces.findSurfaces(slots.map { it.sourcePoiId })
        val frozen = poiSurfaces.findFrozenSurfaces(slots.mapNotNull { it.poiSnapshotId })
        val frozenByPoi = frozen.values.associateBy { it.sourcePoiId }

        return slots.map { it.sourcePoiId }.distinct().mapNotNull { poiId ->
            val l = live[poiId]
            val f = frozenByPoi[poiId]
            if (l == null && f == null) return@mapNotNull null // 정본도 동결본도 없음 — 표면 없이 poiId 만 나간다
            poiId to SlotSurface(
                nameKo = f?.nameKo ?: l!!.nameKo,
                lat = f?.lat ?: l!!.lat,
                lng = f?.lng ?: l!!.lng,
                category = f?.category ?: l!!.category,
                openingHours = l?.openingHours,   // 동결 대상 아님
                imageUrl = l?.imageUrl,           // 동결 대상 아님. NULL=미확보(지어내지 않는다)
                tags = l?.tags.orEmpty(),
            )
        }.toMap()
    }
}

/**
 * 슬롯에 실리는 POI 표면.
 * [openingHoursKnown] = 영업시간을 확인했는지. 미확인 슬롯은 확정 배치가 아니라 **사용자 확인 후보**로
 * 분리할 수 있어야 한다(US-SCHED-03 예외). 현재 openingHours 는 자유형 원문이라 이 표식은 **유무 판정까지만**
 * 신뢰할 수 있다 — 영업 여부 기계 판정은 structured 스키마(U6) 이후.
 */
data class SlotSurface(
    val nameKo: String,
    val lat: Double,
    val lng: Double,
    val category: String,
    val openingHours: String?,
    val imageUrl: String?,
    val tags: List<String>,
) {
    val openingHoursKnown: Boolean get() = openingHours != null
}
