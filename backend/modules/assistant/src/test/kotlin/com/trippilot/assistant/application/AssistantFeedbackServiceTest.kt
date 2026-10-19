package com.trippilot.assistant.application

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantSession
import com.trippilot.assistant.domain.FeedbackRating
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.NewMessage
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import org.slf4j.LoggerFactory
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 도우미 답변 평가 규칙(US-ASSIST-09 · BR-U8-60~65). DB 가 보장하는 것(메시지당 한 행·CASCADE·CHECK)은 `AssistantFeedbackIT` 가
 * 실 DB 로 재고, 여기서는 **서비스가 정하는 것**을 본다 — 누가 무엇을 평가할 수 있는가, 평가 로그에 무엇이 실리는가.
 */
class AssistantFeedbackServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val now = Instant.parse("2026-10-19T03:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val json = ObjectMapper()

    class World(val sessions: FakeSessions = FakeSessions(), val messages: FakeMessages = FakeMessages()) {
        fun service() = AssistantFeedbackService(sessions, messages, json, clock)

        fun session(tripId: UUID? = null, expiresAt: Instant = now.plusSeconds(3600)): AssistantSession =
            AssistantSession(UUID.randomUUID(), acc, tripId, now, now, expiresAt).also { sessions.rows += it }

        /** 그 대화에 메시지 한 줄 — 도우미 행은 관측 칸(의도·추적 번호)까지 남긴다. */
        fun message(
            session: AssistantSession, role: MessageRole = MessageRole.ASSISTANT, kind: MessageKind = MessageKind.TEXT,
            intent: String? = "GET_WEATHER", traceId: String? = "trace-1",
        ): AssistantMessage = when (role) {
            MessageRole.USER -> messages.appendUser(session.sessionId, acc, UUID.randomUUID(), NewMessage(role, kind, "오늘 날씨 어때"), now)
            MessageRole.ASSISTANT -> messages.appendAssistant(
                session.sessionId, acc, UUID.randomUUID(),
                NewMessage(role, kind, "맑아요.", nextActions = listOf(AssistantTemplates.CAPABILITIES_ACTION), intent = intent, traceId = traceId), now,
            )
        }

        fun feedbackOf(session: AssistantSession, messageId: UUID) =
            messages.findPage(session.sessionId, beforeSeq = null, limit = 50).single { it.messageId == messageId }.feedback
    }

    /** 평가 로그를 듣는다 — 한 줄에 무엇이 실리는지가 SEC-U8-06 의 증거다. */
    fun <T> listening(block: () -> T): Pair<T, List<ILoggingEvent>> {
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val logger = LoggerFactory.getLogger(AssistantFeedbackService::class.java) as Logger
        logger.addAppender(appender)
        try {
            return block() to appender.list.toList()
        } finally {
            logger.detachAppender(appender)
        }
    }

    "도우미 답에 좋아요를 남기고, 다시 누르면 바꾸고, 취소하면 지운다 — 읽기에 그대로 보인다" {
        val w = World()
        val s = w.session()
        val said = w.message(s, MessageRole.USER)
        val reply = w.message(s)

        w.service().rate(acc, s.sessionId, reply.messageId, FeedbackRating.UP)
        w.feedbackOf(s, reply.messageId) shouldBe FeedbackRating.UP
        w.feedbackOf(s, said.messageId) shouldBe null

        w.service().rate(acc, s.sessionId, reply.messageId, FeedbackRating.DOWN)
        w.feedbackOf(s, reply.messageId) shouldBe FeedbackRating.DOWN
        w.messages.feedback.keys shouldContainExactly setOf(reply.messageId) // 메시지당 하나 — 바꿔도 늘지 않는다

        w.service().unrate(acc, s.sessionId, reply.messageId)
        w.feedbackOf(s, reply.messageId) shouldBe null
        w.service().unrate(acc, s.sessionId, reply.messageId) // 없어도 조용히 끝난다(멱등)
    }

    /** INV-U8-10 — 사용자 말·적용 기록(`ACTION_LOG`)은 답이 아니다. 거절·폴백·범위 밖도 답이라 평가를 받는다(그 평가가 가장 쓸모 있다). */
    "평가할 수 있는 것은 도우미의 답뿐이다 — 사용자 말·적용 기록은 400 이고, 그 밖의 카드는 전부 받는다" {
        MessageRole.entries.forEach { role ->
            MessageKind.entries.forEach { kind ->
                withClue("$role/$kind") {
                    val w = World()
                    val s = w.session()
                    val m = w.message(s, role, kind)
                    if (role == MessageRole.ASSISTANT && kind != MessageKind.ACTION_LOG) {
                        w.service().rate(acc, s.sessionId, m.messageId, FeedbackRating.DOWN)
                        w.feedbackOf(s, m.messageId) shouldBe FeedbackRating.DOWN
                    } else {
                        shouldThrow<ValidationFailed> { w.service().rate(acc, s.sessionId, m.messageId, FeedbackRating.UP) }
                        shouldThrow<ValidationFailed> { w.service().unrate(acc, s.sessionId, m.messageId) }
                        w.messages.feedback shouldBe emptyMap()
                    }
                }
            }
        }
    }

    "남의 대화·없는 대화·만료된 대화·다른 대화의 메시지·없는 메시지는 404 다 — 평가가 남지 않는다" {
        val w = World()
        val s = w.session()
        val reply = w.message(s)
        val otherReply = w.message(w.session(tripId = UUID.randomUUID()))
        val expired = w.session(tripId = UUID.randomUUID(), expiresAt = now) // 청소가 아직 안 돌았을 뿐 지워졌어야 할 대화다
        val expiredReply = w.message(expired)

        listOf(
            Triple(UUID.randomUUID(), s.sessionId, reply.messageId), // 남의 대화 — 있는지도 모르게
            Triple(acc, UUID.randomUUID(), reply.messageId), // 없는 대화
            Triple(acc, expired.sessionId, expiredReply.messageId), // 만료된 대화
            Triple(acc, s.sessionId, otherReply.messageId), // 내 다른 대화의 메시지
            Triple(acc, s.sessionId, UUID.randomUUID()), // 없는 메시지
        ).forEach { (account, session, message) ->
            shouldThrow<ResourceNotFound> { w.service().rate(account, session, message, FeedbackRating.UP) }
            shouldThrow<ResourceNotFound> { w.service().unrate(account, session, message) }
        }
        w.messages.feedback shouldBe emptyMap()
    }

    /** SEC-U8-06 — 평가 로그는 AI 로그와 잇는 열쇠(추적 번호)와 분류 칸뿐이다. 발화·답 문장·계정이 실리면 보존 정책 밖에서 남는다. */
    "평가를 남기면 로그 한 줄 — 메시지·추적 번호·의도·종류·평가만 싣고 발화·답 문장·계정은 싣지 않는다" {
        val w = World()
        val s = w.session()
        w.message(s, MessageRole.USER)
        val reply = w.message(s, kind = MessageKind.INFO, intent = "GET_WEATHER", traceId = "7c9e6679-7425-40de-944b-e07fc1f90ae7")

        val (_, events) = listening { w.service().rate(acc, s.sessionId, reply.messageId, FeedbackRating.DOWN) }

        val line = events.single()
        line.level shouldBe Level.INFO
        line.formattedMessage.startsWith("assistant_feedback ") shouldBe true
        val body = json.readTree(line.formattedMessage.removePrefix("assistant_feedback "))
        body.fieldNames().asSequence().toList() shouldContainExactly listOf("message_id", "trace_id", "intent", "kind", "rating")
        listOf(body["message_id"], body["trace_id"], body["intent"], body["kind"], body["rating"]).map { it.asText() } shouldContainExactly
            listOf(reply.messageId.toString(), "7c9e6679-7425-40de-944b-e07fc1f90ae7", "GET_WEATHER", "INFO", "DOWN")
        listOf("오늘 날씨 어때", "맑아요", acc.toString()).forEach { line.formattedMessage shouldNotContain it }
    }

    "해석을 부르지 않은 답의 평가는 추적 번호·의도가 비어 로그에 남는다 — 취소와 거부된 평가는 로그가 없다" {
        val w = World()
        val s = w.session()
        val pressed = w.message(s, intent = null, traceId = null) // 버튼 턴의 답 — 이을 상대 로그가 없다
        val said = w.message(s, MessageRole.USER)

        val (_, events) = listening {
            w.service().rate(acc, s.sessionId, pressed.messageId, FeedbackRating.UP)
            w.service().unrate(acc, s.sessionId, pressed.messageId)
            runCatching { w.service().rate(acc, s.sessionId, said.messageId, FeedbackRating.UP) }
            runCatching { w.service().rate(acc, UUID.randomUUID(), pressed.messageId, FeedbackRating.UP) }
        }

        val body = json.readTree(events.single().formattedMessage.removePrefix("assistant_feedback "))
        body["trace_id"].isNull shouldBe true
        body["intent"].isNull shouldBe true
        body["rating"].asText() shouldBe "UP"
    }
})
