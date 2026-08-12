package com.trippilot.placedata.application

import com.trippilot.placedata.api.DomesticCheck
import com.trippilot.placedata.api.DomesticRegionFacade
import com.trippilot.placedata.domain.DomesticVerdict
import com.trippilot.placedata.domain.RegionGeocodePort
import com.trippilot.placedata.domain.RegionLocator
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.util.concurrent.ConcurrentHashMap

/**
 * [DomesticRegionFacade] 구현 — 판정 + 캐시.
 *
 * **왜 캐시하나**: 여행지는 반복되는 값이다("제주"·"부산"이 대부분). 캐시가 없으면 여행 생성마다
 * 외부를 부르고, 벤더 장애·쿼터 소진이 곧 생성 실패율이 된다.
 *
 * **확정 판정만 캐시한다.** [DomesticCheck.UNKNOWN] 은 "지금 못 물어봤다"이지 지역의 성질이 아니다 —
 * 캐시하면 벤더가 살아난 뒤에도 계속 모른다고 답한다.
 */
@Service
class DomesticRegionService(
    private val geocode: RegionGeocodePort,
) : DomesticRegionFacade {

    private val cache = ConcurrentHashMap<String, DomesticCheck>()

    override fun check(region: String): DomesticCheck {
        val key = region.trim()
        if (key.isEmpty()) return DomesticCheck.UNKNOWN
        cache[key]?.let { return it }

        val result = try {
            when (RegionLocator.verdict(key, geocode)) {
                DomesticVerdict.DOMESTIC -> DomesticCheck.INSIDE
                DomesticVerdict.FOREIGN -> DomesticCheck.OUTSIDE
                DomesticVerdict.UNKNOWN -> DomesticCheck.UNKNOWN
            }
        } catch (e: RuntimeException) {
            // **원인을 함께 남긴다** — "확인 못 했다"만 적으면 키가 없어서인지 벤더 장애인지 알 수 없다.
            log.warn("국내 여부 확인 실패 — 막지 않고 통과시킨다. region={}", key, e)
            DomesticCheck.UNKNOWN
        }
        if (result != DomesticCheck.UNKNOWN) cache[key] = result
        return result
    }

    private companion object {
        private val log = LoggerFactory.getLogger(DomesticRegionService::class.java)
    }
}
