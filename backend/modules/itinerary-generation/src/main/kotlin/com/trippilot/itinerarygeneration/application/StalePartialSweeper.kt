package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration

/**
 * 중단된 2차 생성 정리(TRIP-267).
 *
 * 2차 생성은 인메모리 실행기가 돌린다 — 배포·재시작·OOM 으로 프로세스가 끊기면 일정은 `PARTIAL` 로 **영구히** 남는다.
 * 그 상태에선 확정도 편집도 409 라 사용자가 재생성 말고는 손쓸 수 없다.
 * 여기서 [STALE_AFTER] 넘게 갱신이 멈춘 PARTIAL 을 FAILED 로 내려 잠금을 푼다(1차분 day1 은 그대로 유효).
 *
 * [STALE_AFTER] 는 2차 최대 시한(약 22s)보다 충분히 크게 잡아 **진행 중인** 생성을 건드리지 않는다.
 * 다중 인스턴스에서도 안전하다 — 전이는 `replaceIfCurrent` 조건부 쓰기라, 그 사이 2차가 끝났으면 아무 일도 하지 않는다.
 */
@Component
class StalePartialSweeper(
    private val itineraries: ItineraryRepository,
    private val clock: Clock,
) {
    @Scheduled(fixedDelayString = "\${trippilot.itinerary.stale-partial-sweep-ms:60000}")
    fun sweep() {
        val stale = itineraries.findStalePartial(clock.instant().minus(STALE_AFTER))
        if (stale.isEmpty()) return
        var swept = 0
        stale.forEach { itinerary ->
            runCatching {
                if (itineraries.replaceIfCurrent(itinerary.tripId, itinerary.itineraryId, itinerary.failGeneration(clock.instant()))) {
                    swept++
                }
            }.onFailure { log.warn("중단된 생성 정리 실패 — tripId={}", itinerary.tripId, it) }
        }
        if (swept > 0) log.warn("중단된 2차 생성 {}건을 FAILED 로 정리했습니다(확정·편집 잠금 해제).", swept)
    }

    companion object {
        private val log = LoggerFactory.getLogger(StalePartialSweeper::class.java)
        private val STALE_AFTER: Duration = Duration.ofMinutes(5)
    }
}
