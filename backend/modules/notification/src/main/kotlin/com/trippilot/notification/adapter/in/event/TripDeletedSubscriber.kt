package com.trippilot.notification.adapter.`in`.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.notification.application.NotificationScheduleService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 여행이 삭제되면 리마인드 예약을 비운다(TRIP-1061 · QA #024 계열).
 *
 * 소프트 삭제는 행이 남아 `notification_schedule` 의 FK CASCADE 가 닿지 않는다 — 이 구독이 없으면
 * **삭제한 여행의 알림이 계속 울린다.** [NotificationScheduleService.reload] 는 여행을 못 찾으면
 * (삭제분은 조회에서 걸러진다) 미발화 예약을 통째로 비우므로, 여기서는 그대로 태우면 된다.
 * 기존 IT 가 삭제 후 reload 를 **손으로** 불러 이 공백을 가리고 있었다 — 운영 경로가 이것이다.
 *
 * 멱등: reload 가 미발화분 전체 교체라 같은 이벤트가 두 번 배달돼도(at-least-once) 결과가 같다.
 */
@Component
class TripDeletedSubscriber(
    private val schedules: NotificationScheduleService,
    private val mapper: ObjectMapper,
) : OutboxSubscriber {

    override val eventType: String = "trip.TripDeleted"

    override fun handle(envelope: EventEnvelope) {
        val tripId = runCatching { mapper.readTree(envelope.payload).get("tripId")?.asText() }
            .getOrNull()?.let { runCatching { UUID.fromString(it) }.getOrNull() }
            // 못 읽으면 예외로 올린다 — 릴레이가 재시도하고 상한에서 error 로 남긴다(INV-4).
            ?: error("TripDeleted payload 에서 tripId 를 읽지 못했습니다. eventId=${envelope.eventId}")
        schedules.reload(tripId)
        log.debug("여행 삭제로 리마인드 예약을 비웠습니다. tripId={} eventId={}", tripId, envelope.eventId)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(TripDeletedSubscriber::class.java)
    }
}
