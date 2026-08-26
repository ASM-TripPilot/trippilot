package com.trippilot.reflection.adapter.`in`.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.reflection.application.TripSummaryService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 여행이 끝나면 요약을 만든다(BR-U5-39).
 *
 * 멱등: [TripSummaryService.generate] 가 여행당 한 행을 덮어쓰므로 같은 이벤트가 두 번 배달돼도
 * (at-least-once) 결과가 같다. 그래서 `eventId` 를 따로 기억하지 않는다.
 *
 * ⚠ 릴레이는 **구독자를 붙인 시점 이후** 이벤트만 준다 — 과거에 끝난 여행은 요약이 생기지 않는다.
 * 소급이 필요하면 `trip.ended_at` 을 훑는 별도 배치가 필요하고, 그건 이 티켓 밖이다.
 */
@Component
class TripEndedSubscriber(
    private val summaries: TripSummaryService,
    private val mapper: ObjectMapper,
) : OutboxSubscriber {

    override val eventType: String = "trip.TripEnded"

    override fun handle(envelope: EventEnvelope) {
        val tripId = runCatching { mapper.readTree(envelope.payload).get("tripId")?.asText() }
            .getOrNull()
            ?.let { runCatching { UUID.fromString(it) }.getOrNull() }
        // 못 읽으면 예외로 올린다 — 릴레이가 재시도하고 상한에서 error 로 남긴다.
        // 조용히 건너뛰면 "요약이 왜 안 생겼나"를 영영 못 찾는다(INV-4).
        if (tripId == null) error("TripEnded payload 에서 tripId 를 읽지 못했습니다. eventId=${envelope.eventId}")
        summaries.generate(tripId)
        log.debug("여행 종료로 요약을 만들었습니다. tripId={} eventId={}", tripId, envelope.eventId)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(TripEndedSubscriber::class.java)
    }
}
