package com.trippilot.assistant.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.FeedbackRating
import com.trippilot.assistant.domain.FeedbackReason
import com.trippilot.assistant.domain.FeedbackTarget
import com.trippilot.assistant.domain.MessageFeedback
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
 * 그래서 턴 서비스를 거치지 않는다. 평가는 **평가·지표 용도로만** 쓴다 — 모델 학습에 쓰지 않는다(BR-U8-63, 이유·의견도 같다).
 * 싫어요의 자유 의견은 사용자가 쓴 글이라 대화 원문과 같이 다룬다 — 로그에 싣지 않고, 상대(AI)에 보내는 길이 없다.
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
     * 평가를 남긴다 — 이미 있으면 **통째로** 바꾼다(이유·의견도 이번 값으로, 빠진 것은 지운다). 저장한 값을 돌려준다.
     * 남기면 로그 한 줄을 쓴다: 평가를 상대 로그와 잇는 추적 번호와 분류 칸, 이유와 의견 **유무**뿐이고
     * 발화·답 문장·의견 본문·계정은 싣지 않는다(SEC-U8-06 — 의견은 사용자가 쓴 글이라 발화 원문과 같다).
     */
    fun rate(
        accountId: UUID,
        sessionId: UUID,
        messageId: UUID,
        rating: FeedbackRating,
        reason: FeedbackReason? = null,
        comment: String? = null,
    ): MessageFeedback {
        val feedback = feedbackOf(rating, reason, comment)
        val target = target(accountId, sessionId, messageId)
        messages.upsertFeedback(messageId, accountId, feedback, clock.instant())
        val line = linkedMapOf<String, Any?>(
            "message_id" to messageId.toString(), "trace_id" to target.traceId, "intent" to target.intent,
            "kind" to target.kind.name, "rating" to feedback.rating.name,
            "reason" to feedback.reason?.name, "has_comment" to (feedback.comment != null),
        )
        log.info("assistant_feedback {}", mapper.writeValueAsString(line))
        return feedback
    }

    /** 평가를 지운다(취소). **멱등하다** — 남긴 평가가 없어도 조용히 끝난다. 대상 검사는 남기기와 같다. */
    fun unrate(accountId: UUID, sessionId: UUID, messageId: UUID) {
        target(accountId, sessionId, messageId)
        messages.deleteFeedback(messageId)
    }

    /**
     * 본문 규칙(BR-U8-60) — 의견은 앞뒤 공백을 지우고 비면 없는 것으로 본 **뒤에** 잰다(그래서 공백뿐인 의견은 좋아요에 실려도
     * 400 이 아니다). 이유·의견은 싫어요에만, 의견은 300자 이하 — **코드 포인트로 센다**: DB `char_length` 와 같은 단위여야
     * 이모지가 섞인 300자가 여기서는 통과하고 DB 에서 거부되는(또는 그 반대) 틈이 없다. 오류 문구에 의견을 되비추지 않는다.
     */
    private fun feedbackOf(rating: FeedbackRating, reason: FeedbackReason?, comment: String?): MessageFeedback {
        val text = comment?.trim()?.takeIf { it.isNotEmpty() }
        val errors = buildList {
            if (rating != FeedbackRating.DOWN) {
                if (reason != null) add(FieldError("reason", "이유는 싫어요에만 남길 수 있습니다."))
                if (text != null) add(FieldError("comment", "의견은 싫어요에만 남길 수 있습니다."))
            }
            if (text != null && text.codePointCount(0, text.length) > COMMENT_MAX) {
                add(FieldError("comment", "${COMMENT_MAX}자를 넘을 수 없습니다."))
            }
            // NUL 은 DB 가 받지 않는다 — 저장에서 500 이 나기 전에 입력 오류로 돌려준다(발화와 같은 규칙)
            if (text != null && '\u0000' in text) add(FieldError("comment", "쓸 수 없는 문자가 있습니다."))
        }
        if (errors.isNotEmpty()) throw ValidationFailed(errors)
        return MessageFeedback(rating, reason, text)
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

        /** 의견 상한(문자 수) — V2.74 의 `char_length(comment) <= 300` 과 같은 값이다. */
        private const val COMMENT_MAX = 300
    }
}
