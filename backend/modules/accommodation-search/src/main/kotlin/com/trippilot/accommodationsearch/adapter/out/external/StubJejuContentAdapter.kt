package com.trippilot.accommodationsearch.adapter.out.external

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.ContentResult
import com.trippilot.accommodationsearch.domain.Stay
import org.springframework.stereotype.Component

/**
 * 1차 스텁 콘텐츠 어댑터(DEC-3). 제주 고정 숙소 5곳.
 * 실 벤더(OTA/TourAPI) 어댑터로 교체 예정 — 그때 Resilience4j 서킷·타임아웃·Redis 캐시가 이 자리를 감싼다.
 */
@Component
class StubJejuContentAdapter : AccommodationContentPort {

    private val stays = listOf(
        Stay("STUB", "jeju-001", "제주 오션 리조트", 33.2460, 126.5620, "제주", setOf("주차", "조식", "와이파이", "오션뷰"), "리조트"),
        Stay("STUB", "jeju-002", "성산 게스트하우스", 33.4580, 126.9420, "제주", setOf("와이파이", "공용주방"), "게스트하우스"),
        Stay("STUB", "jeju-003", "중문 비치 호텔", 33.2440, 126.4120, "제주", setOf("주차", "조식", "수영장", "오션뷰"), "호텔"),
        Stay("STUB", "jeju-004", "애월 감성 펜션", 33.4630, 126.3100, "제주", setOf("주차", "바비큐"), "펜션"),
        Stay("STUB", "jeju-005", "제주시 시티 호텔", 33.4990, 126.5310, "제주", setOf("주차", "와이파이", "조식"), "호텔"),
    )

    override fun search(region: String?): ContentResult {
        val result = if (region == null) stays else stays.filter { it.region == region }
        return ContentResult(stays = result, degraded = false)  // 스텁은 실패 없음
    }
}
