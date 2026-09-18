package com.trippilot.notification.adapter.`in`.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.notification.application.NotificationScheduleService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 일정이 생성되면 그 여행의 리마인드 예약을 다시 적재한다(DEC-U6-10 · INV-U6-08).
 *
 * `itinerary.ItineraryGenerated` 는 **이미 발행 중**이라 U3 코드를 한 줄도 건드리지 않고 붙는다 —
 * U6 에서 가장 먼저 설 수 있는 경로이자, TRIP-539 릴레이의 첫 소비자다.
 *
 * **`ItineraryConfirmed` 는 구독하지 않는다.** 예약 시각은 여행 기간(`trip.start_date`·`end_date`)에서
 * 나오고 확정은 그 기간을 바꾸지 않는다 — 구독해 봐야 같은 값을 다시 쓸 뿐이다. 슬롯 시각에서 파생하는
 * `SLOT_PRE` 가 붙을 때 다시 판단할 자리다.
 *
 * 멱등: [NotificationScheduleService.reload] 가 미발화분을 통째로 갈아끼우므로 같은 이벤트가 두 번
 * 배달돼도(at-least-once) 결과가 같다. 그래서 `eventId` 를 따로 기억하지 않는다.
 */
@Component
class ItineraryGeneratedSubscriber(
    private val schedules: NotificationScheduleService,
    private val mapper: ObjectMapper,
) : OutboxSubscriber {

    override val eventType: String = "itinerary.ItineraryGenerated"

    override fun handle(envelope: EventEnvelope) {
        val tripId = tripIdOf(envelope)
        if (tripId == null) {
            // 못 읽으면 예외로 올린다 — 릴레이가 재시도하고 상한에서 error 로 남긴다. 조용히 건너뛰면
            // "알림이 안 온다"의 원인을 영영 못 찾는다(INV-4).
            error("ItineraryGenerated payload 에서 tripId 를 읽지 못했습니다. eventId=${envelope.eventId}")
        }
        schedules.reload(tripId)
        log.debug("일정 생성으로 리마인드 예약을 재적재했습니다. tripId={} eventId={}", tripId, envelope.eventId)
    }

    private fun tripIdOf(envelope: EventEnvelope): UUID? =
        runCatching { mapper.readTree(envelope.payload).get("tripId")?.asText() }
            .getOrNull()
            ?.let { runCatching { UUID.fromString(it) }.getOrNull() }

    private companion object {
        private val log = LoggerFactory.getLogger(ItineraryGeneratedSubscriber::class.java)
    }
}
