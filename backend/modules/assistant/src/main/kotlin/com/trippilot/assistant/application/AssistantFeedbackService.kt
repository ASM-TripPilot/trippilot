package com.trippilot.assistant.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.FeedbackRating
import com.trippilot.assistant.domain.FeedbackTarget
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.Clock
import java.util.UUID

/**
 * 도우미 답변 평가(US-ASSIST-09 · BR-U8-60~65) — 좋아요/싫어요를 남기고 바꾸고 지운다.
 *
 * **평가는 턴이 아니다**(BR-U8-61) — 분당 상한·하루 사용량에 세지 않고, 상대를 부르지 않으며, 메시지를 만들지 않는다.
 * 그래서 턴 서비스를 거치지 않는다. 평가는 **평가·지표 용도로만** 쓴다 — 모델 학습에 쓰지 않는다(BR-U8-63).
 *
 * 남의 대화는 있는지조차 알려 주지 않는다(404) — 세션 서비스와 같은 규율.
 */
@Service
class AssistantFeedbackService(
    private val sessions: AssistantSessionRepository,
    private val messages: AssistantMessageRepository,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    /**
     * 평가를 남긴다 — 이미 있으면 바꾼다. 남기면 로그 한 줄을 쓴다: 평가를 상대 로그와 잇는 추적 번호와 분류 칸뿐이고,
     * 발화·답 문장·계정은 싣지 않는다(SEC-U8-06).
     */
    fun rate(accountId: UUID, sessionId: UUID, messageId: UUID, rating: FeedbackRating) {
        val target = target(accountId, sessionId, messageId)
        messages.upsertFeedback(messageId, accountId, rating, clock.instant())
        val line = linkedMapOf(
            "message_id" to messageId.toString(), "trace_id" to target.traceId, "intent" to target.intent,
            "kind" to target.kind.name, "rating" to rating.name,
        )
        log.info("assistant_feedback {}", mapper.writeValueAsString(line))
    }

    /** 평가를 지운다(취소). **멱등하다** — 남긴 평가가 없어도 조용히 끝난다. 대상 검사는 남기기와 같다. */
    fun unrate(accountId: UUID, sessionId: UUID, messageId: UUID) {
        target(accountId, sessionId, messageId)
        messages.deleteFeedback(messageId)
    }

    /** 내 살아 있는 대화의 메시지여야 하고(아니면 404), 도우미의 답이어야 한다(아니면 400 — INV-U8-10). */
    private fun target(accountId: UUID, sessionId: UUID, messageId: UUID): FeedbackTarget {
        sessions.findOwned(accountId, sessionId, clock.instant()) ?: throw ResourceNotFound()
        val target = messages.findFeedbackTarget(sessionId, messageId) ?: throw ResourceNotFound()
        // 사용자 말은 답이 아니고, 적용 기록(`ACTION_LOG`)은 도우미가 한 일의 기록이지 답이 아니다.
        if (target.role != MessageRole.ASSISTANT || target.kind == MessageKind.ACTION_LOG) {
            throw ValidationFailed(listOf(FieldError("messageId", "도우미의 답만 평가할 수 있습니다.")))
        }
        return target
    }

    private companion object {
        private val log = LoggerFactory.getLogger(AssistantFeedbackService::class.java)
    }
}
