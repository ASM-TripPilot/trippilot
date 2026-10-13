package com.trippilot.placedata.api

import com.trippilot.placedata.domain.PoiCategory

/**
 * 한글 정본 카테고리(`맛집`) → AI 경계 코드(`FOOD`). **모르는 값은 null** — 지어내지 않는다.
 *
 * 변환은 [PoiCategory.boundaryCode] 가 소유한다. 다른 모듈은 domain 을 못 보므로(R1) 여기로 연다 —
 * 호출측이 표를 다시 만들면 값이 늘 때 한쪽만 고쳐진다([PoiSurfaceView.categoryCode] 와 같은 이유).
 */
fun categoryBoundaryCodeOf(category: String): String? =
    PoiCategory.entries.firstOrNull { it.name == category }?.boundaryCode
