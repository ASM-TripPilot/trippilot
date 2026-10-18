package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSession
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.DialogueMemoryPort
import com.trippilot.assistant.domain.QuickReply
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.trip.api.TripListFacade
import org.slf4j.LoggerFactory
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
    private val memory: DialogueMemoryPort,
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
            page = page(session.sessionId, beforeSeq = null, size = DEFAULT_PAGE),
            quickReplies = StartQuickReplies.of(hasTrip = tripId != null),
        )
    }

    private fun newSession(accountId: UUID, tripId: UUID?, now: Instant) =
        AssistantSession(UUID.randomUUID(), accountId, tripId, createdAt = now, lastTurnAt = now, expiresAt = now + properties.retention)

    /**
     * 이전 대화로 돌아가기(`b06`). 여행 제목은 지금 값이다.
     *
     * **여행을 못 찾는 대화는 뺀다.** 여행 삭제는 소프트 삭제라 대화 행이 잠깐 남는다([deleteForTrip] 이 아웃박스로
     * 뒤따라 지운다) — 그 사이 목록에 나오면 제목 없는 행이 "여행 없이 한 대화"로 보이고, 눌러 열면 404 다.
     */
    fun list(accountId: UUID): List<SessionSummary> {
        val found = sessions.findByAccount(accountId, clock.instant(), MAX_SESSIONS)
        if (found.none { it.tripId != null }) return found.map { SessionSummary(it, null) }
        // ponytail: 여행이 이 상한보다 많은 계정은 오래된 여행의 대화가 목록에서 빠진다(그 여행 화면에서 열면 이어진다).
        // 그런 계정이 생기면 id 묶음으로 제목을 묻는 조회를 trip.api 에 연다.
        val titles = tripList.findTripsOf(accountId, MAX_TRIPS).associate { it.tripId to it.title }
        return found.mapNotNull { s ->
            when (val tripId = s.tripId) {
                null -> SessionSummary(s, null)
                else -> titles[tripId]?.let { SessionSummary(s, it) }
            }
        }
    }

    /**
     * 여행이 지워졌다 — 그 여행의 대화를 지운다(FD §2.2). 같은 이벤트가 두 번 와도 결과가 같다.
     * 상대 요약도 함께 지운다(DE §4.1) — 대화가 이미 없어도 부른다: 앞선 파기가 실패했을 수 있고, 없으면 0 이다.
     */
    fun deleteForTrip(tripId: UUID): Int = sessions.deleteByTrip(tripId).also { forget("trip") { memory.deleteByTrip(tripId) } }

    /**
     * [before] 는 앞 응답의 `nextBefore` 를 그대로 돌려보내는 불투명 커서다.
     * 한 건 더 읽어 "더 있는가"를 안다 — 따로 세는 쿼리를 두지 않는다.
     */
    fun messages(accountId: UUID, sessionId: UUID, before: String?, limit: Int?): MessagePage {
        sessions.findOwned(accountId, sessionId, clock.instant()) ?: throw ResourceNotFound()
        val size = limit ?: DEFAULT_PAGE
        if (size !in 1..MAX_PAGE) throw ValidationFailed(listOf(FieldError("limit", "1~${MAX_PAGE} 사이여야 합니다.")))
        val beforeSeq = before?.let {
            it.toLongOrNull() ?: throw ValidationFailed(listOf(FieldError("before", "커서가 올바르지 않습니다.")))
        }
        return page(sessionId, beforeSeq, size)
    }

    private fun page(sessionId: UUID, beforeSeq: Long?, size: Int): MessagePage {
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
        // 실제로 지운 대화의 상대 요약만 지운다 — 세션 id 를 안다고 남의 기억을 지우게 두지 않는다(0행이면 내 것이 아니었거나 이미 없다).
        if (sessions.delete(accountId, sessionId) == 0) return
        forget("session") { memory.deleteBySession(sessionId) }
    }

    /**
     * 상대 메모리 파기는 **최선 노력**이다(BR-AO-10) — 실패해도 대화는 이미 지워졌고, 상대 TTL(90일)이 백스톱이다.
     * 그 창("지웠는데 기억한다")은 미결 #13. 조용히 삼키지 않고 WARN 으로 남긴다(INV-4). 식별자는 싣지 않는다.
     */
    private fun forget(what: String, call: () -> Int) {
        runCatching(call).onFailure { log.warn("도우미 상대 메모리 파기 실패({}) — 상대 TTL 이 백스톱입니다. type={}", what, it.javaClass.simpleName) }
    }

    companion object {
        const val DEFAULT_PAGE = 30
        const val MAX_PAGE = 100
        private const val MAX_SESSIONS = 50
        private const val MAX_TRIPS = 200
        private val log = LoggerFactory.getLogger(AssistantSessionService::class.java)
    }
}

data class OpenedSession(
    val session: AssistantSession,
    /** 무컨텍스트 세션은 null(`b07`). */
    val contextChip: String?,
    /** 가장 최근 한 쪽. 이어 연 대화가 더 길면 커서가 함께 온다 — 없으면 앱이 위로 더 읽을 방법이 없다. */
    val page: MessagePage,
    val quickReplies: List<QuickReply>,
)

data class SessionSummary(val session: AssistantSession, val tripTitle: String?)

data class MessagePage(val messages: List<AssistantMessage>, val nextBefore: String?)
