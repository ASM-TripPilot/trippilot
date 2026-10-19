package com.trippilot.planbdetection.adapter.`in`.event

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.planbdetection.application.TriggerService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.util.UUID

/**
 * 재계획이 일정에 반영되면 **근거 트리거를 소비(CONSUMED)** 한다(설계서 규칙 16).
 *
 * 재계획 모듈을 **이벤트 타입 문자열**로 듣는다 — 컴파일 의존이 없어 recalculation → planb-detection(api) 의존과
 * 순환하지 않는다. payload 는 트리로만 읽는다(R1 — 발행측 DTO 를 참조하지 않는다).
 *
 * - 수동 재계획·옛 사건(트리거·날짜 없음)은 할 일이 없다.
 * - 여행을 못 읽거나 payload 가 JSON 이 아니면 예외로 올린다 — 릴레이가 재시도하고 상한에서 error 로 남긴다(INV-4).
 * - 트리거 id·날짜의 형식이 어긋나면 WARN 후 넘어간다 — 재시도해도 같은 값이라 풀리지 않는다(CD19).
 */
@Component
class ReplanAppliedSubscriber(
    private val triggers: TriggerService,
    private val mapper: ObjectMapper,
) : OutboxSubscriber {

    override val eventType: String = "recalculation.ItineraryRecalculated"

    override fun handle(envelope: EventEnvelope) {
        val tripId = runCatching { UUID.fromString(envelope.aggregateId) }.getOrNull()
            ?: error("ItineraryRecalculated 의 aggregateId 를 여행으로 읽지 못했습니다. eventId=${envelope.eventId}")
        val payload = runCatching { mapper.readTree(envelope.payload) }.getOrNull()
            ?: error("ItineraryRecalculated payload 를 읽지 못했습니다. eventId=${envelope.eventId}")
        val rawTrigger = payload.text("triggerId") ?: return // 수동 재계획 — 소비할 트리거가 없다
        val rawDate = payload.text("targetDate") ?: return // 옛 사건 — 날짜를 대조할 수 없으면 닫지 않는다
        val triggerId = runCatching { UUID.fromString(rawTrigger) }.getOrNull()
        val targetDate = runCatching { LocalDate.parse(rawDate) }.getOrNull()
        if (triggerId == null || targetDate == null) {
            log.warn("재계획 적용 사건의 트리거·날짜 형식이 어긋나 소비하지 않습니다. eventId={}", envelope.eventId)
            return
        }
        val consumed = triggers.consume(tripId, triggerId, targetDate)
        log.debug("재계획 적용 — 트리거 소비={} tripId={} triggerId={} targetDate={}", consumed, tripId, triggerId, targetDate)
    }

    private fun JsonNode.text(field: String): String? = get(field)?.takeIf { !it.isNull }?.asText()

    private companion object {
        private val log = LoggerFactory.getLogger(ReplanAppliedSubscriber::class.java)
    }
}
