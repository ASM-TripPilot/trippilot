package com.trippilot.recalculation.adapter.`in`.event

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.recalculation.application.PreparedReplanService
import com.trippilot.recalculation.application.ReplanMaterial
import com.trippilot.recalculation.application.RiskEvent
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 위험 알림 사건 → 미리 짜 둔 대안(situation-awareness BR-SA-18 · DEC-SA-4).
 *
 * 감지 모듈을 **이벤트 타입 문자열**로 듣고 payload 는 트리로만 읽는다(알림 구독자 선례 · DEC-SA-4) — 발행측 DTO 에 묶이지 않아
 * 옛 사건(새 필드 전)과 새 사건을 같은 코드로 받고, 모르는 키는 그냥 지나간다.
 *
 * - 옛 사건(새 필드 전)·주의(CAUTION)는 할 일이 없다 — 무동작.
 * - **계약 위반·파싱 실패는 WARN 후 삼킨다**(CD19) — 재시도해도 같은 값이라 풀리지 않고, 던지면 같은 이벤트의 알림 구독자까지
 *   상한(약 13분)까지 다시 돈다.
 * - **일시 오류는 던진다** — 릴레이가 구독자를 서로 독립으로 돌리고 하나라도 실패하면 이벤트째 재시도한다(#1348). 그래서 멱등이
 *   필수다 — 트리거당 SYSTEM 세션 1개(서비스의 사전 확인 + DB 부분 유니크)가 재배달을 받아 넘긴다. 알림은 `source_event_id` 로 멱등이다.
 */
@Component
class PlanBTriggeredPrepareSubscriber(
    private val prepared: PreparedReplanService,
    private val mapper: ObjectMapper,
) : OutboxSubscriber {

    override val eventType: String = "planb.PlanBTriggered"

    override fun handle(envelope: EventEnvelope) {
        val event = when (val read = read(envelope)) {
            Read.NotRisk -> return
            is Read.Broken -> {
                log.warn("선계산 — 알림 사건 계약 위반으로 건너뜁니다(재시도해도 같다). eventId={} 위치={}", envelope.eventId, read.where)
                return
            }
            is Read.Risk -> read.event
        }
        prepared.onRisk(event, envelope.occurredAt)
    }

    private sealed interface Read {
        data object NotRisk : Read
        data class Broken(val where: String) : Read
        data class Risk(val event: RiskEvent) : Read
    }

    /** 사건 → 선계산 입력. 대표가 위험이 아니면(옛 사건 포함) [Read.NotRisk], 모양이 어긋나면 [Read.Broken]. */
    private fun read(envelope: EventEnvelope): Read {
        val payload = runCatching { mapper.readTree(envelope.payload) }.getOrNull()?.takeIf { it.isObject }
            ?: return Read.Broken("payload")
        // 심각도는 새 필드다 — 없으면 감지 개정 전 사건이다. 주의는 선계산하지 않는다(BR-SA-18 ①).
        if (payload.text("severity") != SEVERITY_RISK) return Read.NotRisk
        val triggerId = uuidOf(envelope.aggregateId) ?: return Read.Broken("aggregateId")
        val accountId = payload.text("accountId")?.let(::uuidOf) ?: return Read.Broken("accountId")
        val tripId = payload.text("tripId")?.let(::uuidOf) ?: return Read.Broken("tripId")
        // 위험 대표의 사건은 그 날 위험을 하나 이상 싣는다(대표 포함) — 비었으면 발행측 결함이다.
        val items = payload.get("dateRisks")?.takeIf { it.isArray && !it.isEmpty } ?: return Read.Broken("dateRisks")
        val risks = items.map { riskOf(it) ?: return Read.Broken("dateRisks[]") }
        return Read.Risk(RiskEvent(accountId, tripId, triggerId, risks))
    }

    /** 그 날 위험 한 건. kind·poiIds 는 필수다. 모르는 kind·변형·영향 범위는 계약 위반이 아니다 — 재료 매핑이 거른다. */
    private fun riskOf(item: JsonNode): ReplanMaterial.Risk? {
        if (!item.isObject) return null
        val kind = item.text("kind") ?: return null
        val pois = item.get("poiIds")?.takeIf { it.isArray } ?: return null
        val poiIds = pois.map { p -> p.takeIf { it.isTextual }?.asText()?.let(::uuidOf) ?: return null }
        return ReplanMaterial.Risk(kind, item.text("variant"), poiIds, item.text("coverage"))
    }

    private fun JsonNode.text(field: String): String? = get(field)?.takeIf { it.isTextual }?.asText()

    private fun uuidOf(raw: String): UUID? = runCatching { UUID.fromString(raw) }.getOrNull()

    private companion object {
        private const val SEVERITY_RISK = "RISK"
        private val log = LoggerFactory.getLogger(PlanBTriggeredPrepareSubscriber::class.java)
    }
}
