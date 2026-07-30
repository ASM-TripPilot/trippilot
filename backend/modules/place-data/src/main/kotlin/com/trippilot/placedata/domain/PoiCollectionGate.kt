package com.trippilot.placedata.domain

import java.time.Instant

/**
 * 수집 게이트 — **INV-1 소유자**. 정규화 후보를 POI 후보풀에 승격/배제.
 * 실재 확인(이름·좌표·카테고리)된 것만 ACTIVE로 진입. 미확보(환각·불완전)는 배제 → 후보풀 미통과 0.
 * 순수 함수(프레임워크 0). closed-set 게이트 PBT(TRIP-212)의 대상.
 */
object PoiCollectionGate {

    /** 승격 자격 — 이름·좌표(INV-U1-02)·카테고리 모두 확보. */
    fun qualifies(place: NormalizedPlace): Boolean =
        place.nameKo.isNotBlank() && place.lat != null && place.lng != null && place.category != null

    /** 자격 있으면 ACTIVE POI, 없으면 null(후보풀 배제). */
    fun promote(place: NormalizedPlace, now: Instant): Poi? {
        if (!qualifies(place)) return null
        return Poi.collect(
            nameKo = place.nameKo,
            lat = place.lat!!,
            lng = place.lng!!,
            category = place.category!!,
            region = place.region,
            openingHours = place.openingHours,
            source = place.source,
            dataStatus = DataStatus.ACTIVE,
            now = now,
        )
    }
}
