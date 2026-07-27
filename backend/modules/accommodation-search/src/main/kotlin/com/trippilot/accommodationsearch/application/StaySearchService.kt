package com.trippilot.accommodationsearch.application

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.Stay
import com.trippilot.accommodationsearch.domain.StayPriceQueryPort
import com.trippilot.accommodationsearch.domain.StayResult
import com.trippilot.accommodationsearch.domain.StaySearch
import com.trippilot.accommodationsearch.domain.StaySearchQuery
import org.springframework.stereotype.Service

/**
 * 숙소 탐색(C3). 콘텐츠 포트 조회 → 필터(AND) → 최저가 스냅숏 결합 → 최저가순 정렬.
 * 규칙: BR-U1-10(날짜·인원 없이) · BR-U1-15(최저가순) · BR-U1-16(filter-zero 원인) · BR-U1-17(부분 실패).
 * INV-U1-05: 목록 가격은 최저가 스냅숏뿐(정확 1박가는 상세·딥링크 시점 별도).
 */
@Service
class StaySearchService(
    private val content: AccommodationContentPort,
    private val prices: StayPriceQueryPort,
) {
    fun search(query: StaySearchQuery): StaySearch {
        val fetched = content.search(query.region)
        val filtered = fetched.stays.filter { matches(it, query) }

        // filter-zero(BR-U1-16): 필터가 있고, 필터 전엔 있었는데 필터 후 0건 → 원인 필터 표기.
        val zeroReasons =
            if (query.hasFilter && filtered.isEmpty() && fetched.stays.isNotEmpty()) {
                filterZeroReasons(fetched.stays, query)
            } else {
                emptyList()
            }

        val priceMap = prices.lowestPrices(filtered.map { it.key() })
        val items = filtered
            .map { StayResult(it, priceMap[it.key()]) }
            .sortedWith(compareBy(nullsLast<Long>()) { it.lowestPrice?.amount })  // 최저가순, 미확인은 뒤

        return StaySearch(items, degraded = fetched.degraded, filterZeroReasons = zeroReasons)
    }

    private fun matches(stay: Stay, q: StaySearchQuery): Boolean =
        (q.amenities.isEmpty() || q.amenities.all { it in stay.amenities }) &&
            (q.stayTypes.isEmpty() || stay.stayType in q.stayTypes)

    /**
     * filter-zero 원인. 단독으로도 0건인 필터가 있으면 그게 확정 원인.
     * 없으면(각 필터는 개별 매칭되나 조합 AND로 0건) 활성 필터 전부를 완화 후보로 반환 —
     * 조합 케이스에서도 "완화 제안"이 비지 않도록(BR-U1-16).
     */
    private fun filterZeroReasons(all: List<Stay>, q: StaySearchQuery): List<String> {
        val individual = mutableListOf<String>()
        if (q.stayTypes.isNotEmpty() && all.none { it.stayType in q.stayTypes }) individual += "stayType"
        q.amenities.forEach { a -> if (all.none { a in it.amenities }) individual += "amenity:$a" }
        if (individual.isNotEmpty()) return individual

        val combo = mutableListOf<String>()
        if (q.stayTypes.isNotEmpty()) combo += "stayType"
        q.amenities.forEach { combo += "amenity:$it" }
        return combo
    }
}
