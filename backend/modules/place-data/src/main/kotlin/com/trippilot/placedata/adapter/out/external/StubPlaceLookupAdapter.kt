package com.trippilot.placedata.adapter.out.external

import com.trippilot.placedata.domain.PlaceLocation
import com.trippilot.placedata.domain.PlaceLookupPort
import org.springframework.stereotype.Component

/**
 * 장소 검색 스텁(기본 모드) — 실 벤더 없이도 등록 흐름이 돌아야 로컬·CI 가 외부에 묶이지 않는다.
 * CI 게이트 정책이 "외부 API 호출 0회"이므로 여기가 기본이다.
 *
 * 질의와 무관하게 제주 후보 2건을 준다. **후보가 여럿인 흐름(multi-candidate, e05)을 재현하는 것**이
 * 이 스텁의 목적이지 실제 좌표를 맞히는 것이 아니다 — 이 값으로 등록하면 좌표는 틀린다.
 * `saved-accommodation` 이 옮겨 오기 전부터 쓰던 값 그대로다(기존 API IT 가 이 좌표를 고정한다).
 */
@Component
class StubPlaceLookupAdapter : PlaceLookupPort {

    override fun search(query: String): List<PlaceLocation> = listOf(
        PlaceLocation(query, "제주특별자치도 제주시", 33.4996, 126.5312),
        PlaceLocation("$query 인근", "제주특별자치도 서귀포시", 33.2541, 126.5601),
    )
}
