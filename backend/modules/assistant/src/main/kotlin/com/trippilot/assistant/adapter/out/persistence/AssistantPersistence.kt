package com.trippilot.assistant.adapter.out.persistence

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSession
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.NextAction
import com.trippilot.assistant.domain.QuickReply
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/**
 * assistant_session 매핑(V2.64). JPA 대신 네이티브를 쓴다 — "없으면 만들고 있으면 그것을 준다"를 한 문장으로
 * 하려면 `ON CONFLICT` 가 필요하다(`NotificationToggleRepositoryAdapter` 와 같은 이유).
 */
@Component
class AssistantSessionRepositoryAdapter(private val jdbc: JdbcTemplate) : AssistantSessionRepository {

    /**
     * 부분 유니크가 둘이라(여행 세션 · 일반 세션) **충돌 대상을 적지 않는다** — 어느 쪽에 걸려도 물러난다.
     * `DO NOTHING` 뒤에 다시 읽는다 —
     * 진 쪽 요청은 이긴 쪽이 만든 행을 받는다. 그 사이 이긴 쪽 행이 지워졌다면(동시 이력 삭제) 한 번 더 넣는다.
     */
    override fun openOrGet(candidate: AssistantSession): AssistantSession {
        repeat(2) {
            jdbc.update(
                """
                INSERT INTO assistant_session (session_id, account_id, trip_id, status, created_at, last_turn_at, expires_at)
                VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)
                ON CONFLICT DO NOTHING
                """.trimIndent(),
                candidate.sessionId, candidate.accountId, candidate.tripId,
                Timestamp.from(candidate.createdAt), Timestamp.from(candidate.lastTurnAt), Timestamp.from(candidate.expiresAt),
            )
            findActive(candidate.accountId, candidate.tripId)?.let { return it }
        }
        error("도우미 세션을 열지 못했습니다 — 삽입과 조회가 두 번 연달아 어긋났습니다.")
    }

    private fun findActive(accountId: UUID, tripId: UUID?): AssistantSession? = jdbc.query(
        "$SELECT WHERE account_id = ? AND status = 'ACTIVE' AND trip_id IS NOT DISTINCT FROM ?::uuid",
        { rs, _ -> rs.toSession() },
        accountId, tripId,
    ).firstOrNull()

    override fun findOwned(accountId: UUID, sessionId: UUID, now: Instant): AssistantSession? = jdbc.query(
        "$SELECT WHERE session_id = ? AND account_id = ? AND status = 'ACTIVE' AND expires_at > ?",
        { rs, _ -> rs.toSession() },
        sessionId, accountId, Timestamp.from(now),
    ).firstOrNull()

    override fun findByAccount(accountId: UUID, now: Instant, limit: Int): List<AssistantSession> = jdbc.query(
        "$SELECT WHERE account_id = ? AND status = 'ACTIVE' AND expires_at > ? ORDER BY last_turn_at DESC, session_id LIMIT ?",
        { rs, _ -> rs.toSession() },
        accountId, Timestamp.from(now), limit,
    )

    /** 계정 조건이 삭제문 안에 있다 — 소유 확인과 삭제 사이에 틈이 없다. 메시지·제안은 FK CASCADE 로 간다. */
    override fun delete(accountId: UUID, sessionId: UUID): Int =
        jdbc.update("DELETE FROM assistant_session WHERE session_id = ? AND account_id = ?", sessionId, accountId)

    override fun deleteByTrip(tripId: UUID): Int = jdbc.update("DELETE FROM assistant_session WHERE trip_id = ?", tripId)

    private fun ResultSet.toSession() = AssistantSession(
        sessionId = getObject("session_id", UUID::class.java),
        accountId = getObject("account_id", UUID::class.java),
        tripId = getObject("trip_id", UUID::class.java),
        createdAt = getTimestamp("created_at").toInstant(),
        lastTurnAt = getTimestamp("last_turn_at").toInstant(),
        expiresAt = getTimestamp("expires_at").toInstant(),
    )

    private companion object {
        const val SELECT = "SELECT session_id, account_id, trip_id, created_at, last_turn_at, expires_at FROM assistant_session"
    }
}

/** assistant_message 조회(V2.64). 쓰기는 턴 처리와 함께 들어온다(TRIP-1378). */
@Component
class AssistantMessageRepositoryAdapter(
    private val jdbc: JdbcTemplate,
    mapper: ObjectMapper,
) : AssistantMessageRepository {

    /**
     * 저장된 행은 **지금의 타입보다 오래 산다.** 필드가 늘어난 뒤 옛 파드가(배포 중·롤백 뒤) 새 행을 읽어도 죽지 않게
     * 모르는 필드는 버린다 — 한 줄이 못 읽히면 그 대화는 열기도 조회도 500 이 된다.
     */
    private val reader = mapper.reader().without(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)

    /** 최근 것부터 [limit] 건을 집고 뒤집는다 — 화면은 오래된 것이 위다. */
    override fun findPage(sessionId: UUID, beforeSeq: Long?, limit: Int): List<AssistantMessage> = jdbc.query(
        """
        SELECT message_id, seq, role, kind, text, payload, next_actions, quick_replies, footnote, created_at
          FROM assistant_message
         WHERE session_id = ? AND seq < ?
         ORDER BY seq DESC
         LIMIT ?
        """.trimIndent(),
        { rs, _ -> rs.toMessage() },
        sessionId, beforeSeq ?: Long.MAX_VALUE, limit,
    ).asReversed()

    private fun ResultSet.toMessage() = AssistantMessage(
        messageId = getObject("message_id", UUID::class.java),
        seq = getLong("seq"),
        role = MessageRole.valueOf(getString("role")),
        kind = MessageKind.valueOf(getString("kind")),
        text = getString("text"),
        payload = getString("payload")?.let { reader.forType(PAYLOAD).readValue<Map<String, Any?>>(it) },
        nextActions = reader.forType(NEXT_ACTIONS).readValue(getString("next_actions")),
        quickReplies = getString("quick_replies")?.let { reader.forType(QUICK_REPLIES).readValue<List<QuickReply>>(it) },
        footnote = getString("footnote"),
        createdAt = getTimestamp("created_at").toInstant(),
    )

    private companion object {
        val PAYLOAD = object : TypeReference<Map<String, Any?>>() {}
        val NEXT_ACTIONS = object : TypeReference<List<NextAction>>() {}
        val QUICK_REPLIES = object : TypeReference<List<QuickReply>>() {}
    }
}
