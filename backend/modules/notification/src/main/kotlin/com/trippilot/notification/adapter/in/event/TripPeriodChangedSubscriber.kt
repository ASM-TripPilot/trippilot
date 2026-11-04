package com.trippilot.notification.adapter.`in`.event

import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.notification.application.NotificationScheduleService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 여행 기간이 바뀌면 리마인드 예약을 새 기간으로 다시 세운다(TRIP-1758).
 *
 * ## 없으면 무엇이 잘못되나
 *
 * 예약의 발화 시각(여행 전날·여행 매일 08:00)은 **여행 기간에서만** 계산되는데, 적재는 일정 생성·재계획·여행 삭제 이벤트에서만 돌았다.
 * 편집(PATCH)이 기간만 바꾸고 일정은 다시 짜지 않으면 예약은 **옛 날짜 그대로**라 — 줄인 날에도 울리고, 늘린 날에는 안 운다.
 *
 * ## 일정이 없는 여행은 건드리지 않는다
 *
 * 예약은 일정 생성·재계산 이벤트가 처음 만든다. 일정을 짜기 전에 기간을 고친 여행에 여기서 예약을 세우면, 일정도 없는 여행의
 * "오늘의 일정"이 울린다 — 그래서 `onlyIfScheduled`(예약이 한 번이라도 적재된 여행만).
 *
 * 멱등: [NotificationScheduleService.reload] 가 미발화분을 통째로 갈아끼우므로 두 번 배달돼도(at-least-once) 결과가 같다. 순서에도 기대지
 * 않는다 — 배달 시점의 **현재 기간**으로 계산한다(사건에 실린 날짜를 쓰지 않는다).
 */
@Component
class TripPeriodChangedSubscriber(
    private val schedules: NotificationScheduleService,
) : OutboxSubscriber {

    override val eventType: String = "trip.TripPeriodChanged"

    override fun handle(envelope: EventEnvelope) {
        // 못 읽으면 예외로 올린다 — 릴레이가 재시도하고 상한에서 error 로 남긴다. 조용히 건너뛰면 "기간을 고쳤는데 옛 날에 알림이 온다"의 원인을 못 찾는다(INV-4).
        val tripId = runCatching { UUID.fromString(envelope.aggregateId) }.getOrNull()
            ?: error("TripPeriodChanged 의 aggregateId 를 여행으로 읽지 못했습니다. eventId=${envelope.eventId}")

        schedules.reload(tripId, onlyIfScheduled = true)
        log.debug("여행 기간 변경으로 리마인드 예약을 다시 세웠습니다. tripId={} eventId={}", tripId, envelope.eventId)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(TripPeriodChangedSubscriber::class.java)
    }
}
