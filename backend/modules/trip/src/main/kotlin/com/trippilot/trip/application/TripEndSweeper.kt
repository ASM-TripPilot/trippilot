package com.trippilot.trip.application

import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.trip.api.event.TripEnded
import com.trippilot.trip.domain.TripEndRepository
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId

/**
 * 끝난 여행에 종료를 **기록하고 알린다**(TRIP-554).
 *
 * ## 왜 스위퍼인가
 *
 * 여행 종료는 사용자가 누르는 행동이 아니라 **날짜가 지나면 일어나는 일**이다. 그런데
 * `TripStatus.ENDED` 는 저장되지 않고 파생돼(`Trip.statusAt`), 끝나는 "순간"이 어디에도 없었다.
 * 파생 상태로는 이벤트를 만들 수 없다 — 매 폴링마다 "지금 끝난 여행"을 훑으면 같은 여행에 이벤트가
 * 계속 나간다.
 *
 * 그래서 `ended_at` 을 조건부로 찍고(`ended_at IS NULL`), **찍힌 그 순간에만** 발행한다.
 * 그 조건부 쓰기가 멱등의 전부다 — 다중 인스턴스가 같은 여행을 집어도 UPDATE 는 하나만 성공한다.
 * 선례는 `OutboxRelay`·`NotificationSchedulePoller` 다.
 *
 * ## 판정 시각
 *
 * **여행지 기준 날짜**로 본다(U4 승계). 서버가 UTC 로 돌아도 사용자의 여행은 KST 로 끝난다 —
 * UTC 자정을 쓰면 한국 시간 오전 9시까지 "아직 안 끝난" 여행이 된다.
 */
@Component
class TripEndSweeper(
    private val trips: TripEndRepository,
    private val events: DomainEventPublisher,
    private val clock: Clock,
) {
    @Scheduled(fixedDelayString = "\${trippilot.trip.end-sweep-ms:600000}")
    @Transactional
    fun sweep() {
        val today = LocalDate.ofInstant(clock.instant(), TRAVEL_ZONE)
        val now = clock.instant()
        var ended = 0
        trips.findEndedButUnmarked(today, BATCH_SIZE).forEach { tripId ->
            // 조건부 쓰기가 곧 멱등이다 — 이미 찍혔으면 아무 일도 하지 않고 발행도 하지 않는다.
            if (!trips.markEnded(tripId, now)) return@forEach
            events.publish(TripEnded(tripId.toString(), tripId.toString(), now.toString()))
            ended++
        }
        // 조용히 지나가지 않는다 — "요약이 왜 안 생겼나"의 첫 단서가 이 줄이다(INV-4).
        if (ended > 0) log.info("끝난 여행 {}건에 종료를 기록하고 알렸습니다.", ended)
    }

    private companion object {
        /** 여행지 기준. 서버 존이 아니라 여행이 벌어지는 곳의 자정이어야 한다. */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

        /** 한 번에 집는 양. 밀려도 다음 주기가 가져간다 — 종료는 몇 분 늦어도 해가 없다. */
        private const val BATCH_SIZE = 200

        private val log = LoggerFactory.getLogger(TripEndSweeper::class.java)
    }
}
