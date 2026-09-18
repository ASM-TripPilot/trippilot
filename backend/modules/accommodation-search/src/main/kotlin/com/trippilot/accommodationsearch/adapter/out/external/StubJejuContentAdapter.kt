package com.trippilot.accommodationsearch.adapter.out.external

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.ContentResult
import com.trippilot.accommodationsearch.domain.Stay
import org.springframework.stereotype.Component

/**
 * 스텁 콘텐츠 어댑터 — 제주 고정 5곳(DEC-3).
 *
 * **기본값으로 남는다.** CI 게이트 정책이 "외부·실데이터 의존 0" 이고, 실 정본(`stay`)은 시드가
 * 채우므로 시드 없는 환경에서도 검색이 돌아야 한다. 실 데이터로 돌리려면
 * `trippilot.stay.content.mode=db` 로 켠다(`DbContentAdapter` 가 @Primary 로 이긴다).
 *
 * 이 스텁은 편의시설을 **가지고 있다** — 그래서 `amenitiesKnown` 기본값 true 가 맞다.
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
