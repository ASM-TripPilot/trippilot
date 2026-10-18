package com.trippilot.assistant.adapter.`in`.event

import com.trippilot.assistant.api.event.DialogueForgetRequested
import com.trippilot.assistant.domain.DialogueMemoryPort
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 이력 지우기 → 상대(AI) 세션 메모리 파기. **실패는 올린다** — 릴레이가 백오프로 재시도하고 상한에서 error 로 남긴다(INV-4).
 * 상대 파기는 멱등이라(없으면 0) 재배달이 해롭지 않다. 이 구독자는 식별자를 로그에 싣지 않지만, 릴레이의 실패 로그는
 * 예외를 그대로 남기므로 HTTP 클라이언트 예외 메시지(요청 URL 의 세션 id)가 실릴 수 있다 — 발화 원문은 실리지 않는다.
 */
@Component
class DialogueForgetSubscriber(private val memory: DialogueMemoryPort) : OutboxSubscriber {

    override val eventType: String = DialogueForgetRequested("").eventType

    override fun handle(envelope: EventEnvelope) {
        val sessionId = runCatching { UUID.fromString(envelope.aggregateId) }.getOrNull()
            ?: error("DialogueForgetRequested 의 aggregateId 를 세션으로 읽지 못했습니다. eventId=${envelope.eventId}")
        memory.deleteBySession(sessionId)
    }
}
