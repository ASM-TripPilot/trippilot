package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSession
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.QuickReply
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.trip.api.TripListFacade
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * 도우미 세션(US-ASSIST-01·05) — 열기·목록·메시지 조회·지우기. 턴과 제안은 여기 없다(TRIP-1378·1379).
 *
 * 전부 **본인 것만**이다. 남의 세션은 있는지조차 알려 주지 않는다(404).
 */
@Service
class AssistantSessionService(
    private val sessions: AssistantSessionRepository,
    private val messages: AssistantMessageRepository,
    private val tripContexts: TripContextReader,
    private val tripList: TripListFacade,
    private val properties: AssistantProperties,
    private val clock: Clock,
) {
    /**
     * 그 여행(또는 일반)의 대화를 연다 — 있으면 이어 열고 없으면 만든다(멱등, FD §2.2).
     * 여행이 없거나 남의 것이면 만들지 않는다(INV-U8-02).
     */
    fun open(accountId: UUID, tripId: UUID?): OpenedSession {
        val context = tripId?.let { tripContexts.read(accountId, it) ?: throw ResourceNotFound() }
        val now = clock.instant()
        var session = sessions.openOrGet(newSession(accountId, tripId, now))
        // 보존 기간이 지났는데 청소가 아직 안 돈 세션 — 이어 열면 지워졌어야 할 대화가 되살아난다.
        if (session.expiresAt <= now) {
            sessions.delete(accountId, session.sessionId)
            session = sessions.openOrGet(newSession(accountId, tripId, now))
        }
        return OpenedSession(
            session = session,
            contextChip = context?.chip(),
            messages = messages.findPage(session.sessionId, beforeSeq = null, limit = DEFAULT_PAGE),
            quickReplies = StartQuickReplies.of(hasTrip = tripId != null),
        )
    }

    private fun newSession(accountId: UUID, tripId: UUID?, now: Instant) =
        AssistantSession(UUID.randomUUID(), accountId, tripId, createdAt = now, lastTurnAt = now, expiresAt = now + properties.retention)

    /** 이전 대화로 돌아가기(`b06`). 여행 제목은 지금 값이다 — 여행이 지워졌으면 세션도 함께 지워져 여기 없다. */
    fun list(accountId: UUID): List<SessionSummary> {
        val found = sessions.findByAccount(accountId, clock.instant(), MAX_SESSIONS)
        if (found.none { it.tripId != null }) return found.map { SessionSummary(it, null) }
        val titles = tripList.findTripsOf(accountId, MAX_TRIP_TITLES).associate { it.tripId to it.title }
        return found.map { SessionSummary(it, it.tripId?.let(titles::get)) }
    }

    /**
     * [before] 는 앞 응답의 `nextBefore` 를 그대로 돌려보내는 불투명 커서다.
     * 한 건 더 읽어 "더 있는가"를 안다 — 따로 세는 쿼리를 두지 않는다.
     */
    fun messages(accountId: UUID, sessionId: UUID, before: String?, limit: Int?): MessagePage {
        sessions.findOwned(accountId, sessionId) ?: throw ResourceNotFound()
        val size = limit ?: DEFAULT_PAGE
        if (size !in 1..MAX_PAGE) throw ValidationFailed(listOf(FieldError("limit", "1~${MAX_PAGE} 사이여야 합니다.")))
        val beforeSeq = before?.let {
            it.toLongOrNull() ?: throw ValidationFailed(listOf(FieldError("before", "커서가 올바르지 않습니다.")))
        }
        val rows = messages.findPage(sessionId, beforeSeq, size + 1)
        val page = rows.takeLast(size)
        return MessagePage(page, nextBefore = if (rows.size > size) page.first().seq.toString() else null)
    }

    /**
     * 대화를 지운다(hard delete — 메시지·제안이 함께 간다, DATA-U8-05). 이미 적용된 일정 변경과 그 이력은
     * 남는다(BR-U8-20). **멱등하다** — 없거나 남의 세션이어도 조용히 끝난다: 재시도한 삭제가 오류로 보일
     * 이유가 없고, 지워진 것이 없으니 새는 것도 없다.
     */
    fun clear(accountId: UUID, sessionId: UUID) {
        sessions.delete(accountId, sessionId)
    }

    companion object {
        const val DEFAULT_PAGE = 30
        const val MAX_PAGE = 100
        private const val MAX_SESSIONS = 50
        // 제목을 붙일 여행 수의 상한 — 세션 상한과 같게 둔다. 넘는 세션은 제목 없이 나간다.
        private const val MAX_TRIP_TITLES = 50
    }
}

data class OpenedSession(
    val session: AssistantSession,
    /** 무컨텍스트 세션은 null(`b07`). */
    val contextChip: String?,
    val messages: List<AssistantMessage>,
    val quickReplies: List<QuickReply>,
)

data class SessionSummary(val session: AssistantSession, val tripTitle: String?)

data class MessagePage(val messages: List<AssistantMessage>, val nextBefore: String?)
