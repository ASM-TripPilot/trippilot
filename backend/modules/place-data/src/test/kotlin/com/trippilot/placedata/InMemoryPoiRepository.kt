package com.trippilot.placedata

import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSource
import java.util.UUID

/** 공유 인메모리 PoiRepository 페이크 — 수집·후보풀 테스트 공용. ACTIVE 필터는 실 쿼리와 동일 규칙. */
class InMemoryPoiRepository : PoiRepository {
    val stored = mutableListOf<Poi>()

    /**
     * 같은 `poiId` 면 **대체**한다 — 실 JPA `saveAll` 이 @Id 존재 시 갱신이기 때문이다.
     * 무조건 append 로 두면 갱신을 신규로 세어 멱등 테스트가 거짓 통과한다.
     */
    override fun saveAll(pois: List<Poi>) = pois.also { batch ->
        batch.forEach { p ->
            stored.removeAll { it.poiId == p.poiId }
            stored += p
        }
    }
    override fun findById(poiId: UUID) = stored.firstOrNull { it.poiId == poiId }

    /**
     * 실 쿼리와 **같은 규칙**이다 — 코드 접두사 매칭 + 이름·id 정렬(TRIP-503).
     * 이름 일치로 두면 대역만 통과하고 실 DB 에서 다른 도시가 섞인다.
     */
    override fun findActive(regionCodes: List<String>, category: PoiCategory?) =
        stored.filter { p ->
            active(p) &&
                (category == null || p.category == category) &&
                (regionCodes.isEmpty() || regionCodes.any { c -> p.regionCode?.startsWith(c) == true })
        }.sortedWith(compareBy({ it.nameKo }, { it.poiId }))

    override fun findActiveInBounds(latMin: Double, latMax: Double, lngMin: Double, lngMax: Double) =
        stored.filter { active(it) && it.lat in latMin..latMax && it.lng in lngMin..lngMax }

    override fun findActiveByIds(poiIds: List<UUID>) =
        stored.filter { active(it) && it.poiId in poiIds }

    override fun findByIds(poiIds: List<UUID>) = stored.filter { it.poiId in poiIds }

    // 상태 무관으로 찾는다 — 실 쿼리(findBySourceAndSourceRefIn)와 같은 규칙. 폐업분도 다시 만들지 않는다.
    override fun findBySourceRefs(source: PoiSource, sourceRefs: Collection<String>) =
        stored.filter { it.source == source && it.sourceRef in sourceRefs }
            .mapNotNull { p -> p.sourceRef?.let { it to p } }
            .toMap()

    private fun active(p: Poi) = p.dataStatus == DataStatus.ACTIVE
}
