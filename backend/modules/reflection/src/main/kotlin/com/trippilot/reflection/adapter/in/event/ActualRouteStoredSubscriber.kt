package com.trippilot.reflection.adapter.`in`.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.reflection.application.ReflectionService
import com.trippilot.reflection.application.TripSummaryService
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.util.UUID

/**
 * 하루치 실제 경로가 저장됐다(U10 `archive.ActualRouteStored`) — 그날 회고와 여행 요약의 **통계만** 다시 센다(BR-U10-39).
 *
 * 멱등: 통계는 지금 저장된 경로·실적에서 다시 계산할 뿐이라 두 번 배달돼도 결과가 같다. 회고·요약이 아직 없으면 아무것도 안 한다 —
 * 나중에 만들 때 경로를 읽는다. 그래서 이 구독자가 생기기 전에 올라온 경로도 놓치지 않는다(만들 때 읽으므로).
 */
@Component
class ActualRouteStoredSubscriber(
    private val reflections: ReflectionService,
    private val summaries: TripSummaryService,
    private val mapper: ObjectMapper,
) : OutboxSubscriber {

    override val eventType: String = "archive.ActualRouteStored"

    override fun handle(envelope: EventEnvelope) {
        val payload = mapper.readTree(envelope.payload)
        val tripId = runCatching { UUID.fromString(payload["tripId"].asText()) }.getOrNull()
        val day = runCatching { LocalDate.parse(payload["localDate"].asText()) }.getOrNull()
        // 못 읽으면 예외로 올린다 — 조용히 건너뛰면 "거리가 왜 근사로 남았나"를 영영 못 찾는다(INV-4).
        if (tripId == null || day == null) error("ActualRouteStored payload 를 읽지 못했습니다. eventId=${envelope.eventId}")
        reflections.refreshRouteStats(tripId, day)
        summaries.refreshRouteStats(tripId)
    }
}
