package com.trippilot.assistant.adapter.`in`.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.assistant.application.AssistantSessionService
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 여행이 삭제되면 그 여행의 도우미 대화를 지운다(U8 FD §2.2).
 *
 * 여행 삭제는 소프트 삭제라 행이 남아 `assistant_session.trip_id` 의 FK CASCADE 가 닿지 않는다 — 이 구독이 없으면
 * **지운 여행에서 한 말이 보존 기간(90일) 내내 남는다.** 알림 예약이 같은 이유로 같은 구독을 둔다
 * (`notification` 의 `TripDeletedSubscriber`).
 *
 * 멱등: 여행 id 로 지우므로 같은 이벤트가 두 번 배달돼도(at-least-once) 두 번째는 0행이다.
 */
@Component("assistantTripDeletedSubscriber")
class TripDeletedSubscriber(
    private val sessions: AssistantSessionService,
    private val mapper: ObjectMapper,
) : OutboxSubscriber {

    override val eventType: String = "trip.TripDeleted"

    override fun handle(envelope: EventEnvelope) {
        val tripId = runCatching { mapper.readTree(envelope.payload).get("tripId")?.asText() }
            .getOrNull()?.let { runCatching { UUID.fromString(it) }.getOrNull() }
            // 못 읽으면 예외로 올린다 — 릴레이가 재시도하고 상한에서 error 로 남긴다(INV-4).
            ?: error("TripDeleted payload 에서 tripId 를 읽지 못했습니다. eventId=${envelope.eventId}")
        val deleted = sessions.deleteForTrip(tripId)
        log.debug("여행 삭제로 도우미 대화 {}건을 지웠습니다. tripId={} eventId={}", deleted, tripId, envelope.eventId)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(TripDeletedSubscriber::class.java)
    }
}
