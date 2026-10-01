package com.trippilot.accommodationsearch.adapter.out.external

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.ContentResult
import com.trippilot.accommodationsearch.domain.Stay
import com.trippilot.accommodationsearch.domain.StayKey
import org.springframework.stereotype.Component

/**
 * 스텁 콘텐츠 어댑터 — 제주 고정 5곳(DEC-3).
 *
 * **기본값으로 남는다.** CI 게이트 정책이 "외부·실데이터 의존 0" 이고, 실 정본(`stay`)은 시드가
 * 채우므로 시드 없는 환경에서도 검색이 돌아야 한다. 실 데이터로 돌리려면
 * `trippilot.stay.content.mode=db` 로 켠다(`DbContentAdapter` 가 @Primary 로 이긴다).
 *
 * 이 스텁은 편의시설을 **가지고 있다** — 그래서 `amenitiesKnown` 기본값 true 가 맞다.
 *
 * **주소·전화·객실 수도 채운다.** 기본 모드가 이것이라 여기를 비우면 로컬·CI 에서 그 칸이 늘
 * null 이고, 화면을 만드는 쪽은 "아직 안 들어온 기능"으로 읽는다.
 *
 * 다만 **전화는 일부러 둘을 비웠다**(jeju-002·004). 정본 채움률이 54.8% 라 없는 쪽이 정상 경로인데,
 * 다섯 곳이 전부 번호를 가지면 화면이 그 경로를 한 번도 안 밟아 본 채 배포된다. `rooms` 도
 * 같은 이유로 하나(jeju-002)를 비운다.
 *
 * 번호는 형식만 맞춘 **명백한 가짜**다(`064-000-000X`) — 그럴듯한 번호를 지어내면 실제 남의
 * 번호일 수 있고, 개발자가 눌러서 확인하는 자리이기 때문이다.
 */
@Component
class StubJejuContentAdapter : AccommodationContentPort {

    private val stays = listOf(
        Stay("STUB", "jeju-001", "제주 오션 리조트", 33.2460, 126.5620, "제주", setOf("주차", "조식", "와이파이", "오션뷰"), "리조트",
            address = "제주특별자치도 서귀포시 중문관광로 100", phone = "064-000-0001", rooms = 120),
        Stay("STUB", "jeju-002", "성산 게스트하우스", 33.4580, 126.9420, "제주", setOf("와이파이", "공용주방"), "게스트하우스",
            address = "제주특별자치도 서귀포시 성산읍 일출로 22", phone = null, rooms = null),
        Stay("STUB", "jeju-003", "중문 비치 호텔", 33.2440, 126.4120, "제주", setOf("주차", "조식", "수영장", "오션뷰"), "호텔",
            address = "제주특별자치도 서귀포시 색달동 2812-1", phone = "064-000-0003", rooms = 88),
        Stay("STUB", "jeju-004", "애월 감성 펜션", 33.4630, 126.3100, "제주", setOf("주차", "바비큐"), "펜션",
            address = "제주특별자치도 제주시 애월읍 애월해안로 543", phone = null, rooms = 8),
        Stay("STUB", "jeju-005", "제주시 시티 호텔", 33.4990, 126.5310, "제주", setOf("주차", "와이파이", "조식"), "호텔",
            address = "제주특별자치도 제주시 탑동로 66", phone = "064-000-0005", rooms = 54),
    )

    override fun search(region: String?): ContentResult {
        val result = if (region == null) stays else stays.filter { it.region == region }
        return ContentResult(stays = result, degraded = false)  // 스텁은 실패 없음
    }

    override fun findOne(key: StayKey): Stay? = stays.firstOrNull { it.key() == key }
}
