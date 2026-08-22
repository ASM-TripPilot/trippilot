package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock

/**
 * 중단된 2차 생성 정리(TRIP-267).
 *
 * 2차 생성은 인메모리 실행기가 돌린다 — 배포·재시작·OOM 으로 프로세스가 끊기면 일정은 `PARTIAL` 로 **영구히** 남는다.
 * 그 상태에선 확정도 편집도 409 라 사용자가 재생성 말고는 손쓸 수 없다.
 * 여기서 [ScheduleDeadlineProperties.staleAfter] 넘게 갱신이 멈춘 PARTIAL 을 FAILED 로 내려 잠금을 푼다(1차분 day1 은 그대로 유효).
 * 진행 상태 세션(h09·h10)도 같이 닫는다 — 한쪽만 정리하면 일정은 FAILED 인데 화면은 계속 "생성 중"이다.
 *
 * 기준(`ScheduleDeadlineProperties.staleAfter`)은 **기다려 주기로 한 시간보다 크게** 파생된다 —
 * 진행 중인 생성을 건드리지 않기 위해서다. 시간제약을 풀면(TRIP-474) 그 시간이 22초가 아니라 610초라
 * 기준도 함께 늘어난다. 고정 상수였다면 여기서 **살아 있는 2차를 잘라냈을 것이다.**
 * 계정 동시 생성 제한(TRIP-403)이 "멈춘 세션"을 판정할 때도 같은 값을 본다 — 정의가 갈리면
 * 같은 사고에 대기 시간이 둘이 된다.
 * 다중 인스턴스에서도 안전하다 — 전이는 `replaceIfCurrent` 조건부 쓰기라, 그 사이 2차가 끝났으면 아무 일도 하지 않는다.
 */
@Component
class StalePartialSweeper(
    private val itineraries: ItineraryRepository,
    private val sessions: GenerationSessionService,
    private val clock: Clock,
    private val deadlines: ScheduleDeadlineProperties,
) {
    @Scheduled(fixedDelayString = "\${trippilot.itinerary.stale-partial-sweep-ms:60000}")
    fun sweep() {
        val stale = itineraries.findStalePartial(clock.instant().minus(deadlines.staleAfter))
        if (stale.isEmpty()) return
        var swept = 0
        stale.forEach { itinerary ->
            runCatching {
                if (itineraries.replaceIfCurrent(itinerary.tripId, itinerary.itineraryId, itinerary.failGeneration(clock.instant()))) {
                    // 진행 상태 세션도 함께 닫는다 — 안 닫으면 일정은 FAILED 인데 화면은 계속 "생성 중"으로 보인다.
                    sessions.failRunning(itinerary.tripId)
                    swept++
                }
            }.onFailure { log.warn("중단된 생성 정리 실패 — tripId={}", itinerary.tripId, it) }
        }
        if (swept > 0) log.warn("중단된 2차 생성 {}건을 FAILED 로 정리했습니다(확정·편집 잠금 해제).", swept)
    }

    companion object {
        private val log = LoggerFactory.getLogger(StalePartialSweeper::class.java)
    }
}
