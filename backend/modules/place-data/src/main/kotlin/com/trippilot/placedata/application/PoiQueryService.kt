package com.trippilot.placedata.application

import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiRepository
import org.springframework.stereotype.Service

/**
 * POI 조회(C7) — 탐색 랜딩(US-EXPL-01)용. **ACTIVE만**(INV-U1-01) 지역·카테고리 필터.
 * 반경/취향 후보풀(CandidatePoolPort)은 TRIP-213.
 */
@Service
class PoiQueryService(
    private val repo: PoiRepository,
    private val regions: RegionLookupFacade,
) {
    /**
     * @param region 지역 **이름**(표준명·별칭 모두). 화면이 코드를 들고 다니지 않아도 되게 이름을 받고,
     *   코드로의 해석은 여기서 한다 — 숙소 검색(`DbContentAdapter`)과 같은 계약 모양이다.
     */
    fun search(region: String?, category: PoiCategory?): List<Poi> {
        val key = region?.trim().orEmpty()
        if (key.isEmpty()) return repo.findActive(emptyList(), category)

        // 동명이지역이 있다 — '동구'는 대전·대구·광주·부산에 다 있고 '고성'은 경남·강원 둘이다.
        // 하나를 고르면 거짓이므로 전부를 대상으로 삼는다(숙소와 같은 판단).
        val codes = regions.codesOf(key)

        // **모르는 이름은 빈 결과다.** 여기서 지역 조건을 떨어뜨리면 전국이 나가는데, 화면은 그것을
        // "그 지역 장소"로 표시한다 — 조용히 틀린 목록을 보여주느니 없다고 말하는 편이 맞다.
        if (codes.isEmpty()) return emptyList()

        return repo.findActive(codes, category)
    }
}
