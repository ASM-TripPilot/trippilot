package com.trippilot.assistant.adapter.out.persistence

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.assistant.domain.AccountTurnLock
import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSession
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.AssistantUsageRepository
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.NewMessage
import com.trippilot.assistant.domain.NextAction
import com.trippilot.assistant.domain.QuickReply
import com.trippilot.assistant.domain.RecordedTurn
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.time.LocalDate
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

    override fun recordTurn(sessionId: UUID, at: Instant, expiresAt: Instant, dialogueContext: String, refusalStreak: Int) {
        jdbc.update(
            "UPDATE assistant_session SET last_turn_at = ?, expires_at = ?, dialogue_context = ?::jsonb, refusal_streak = ? WHERE session_id = ?",
            Timestamp.from(at), Timestamp.from(expiresAt), dialogueContext, refusalStreak, sessionId,
        )
    }

    private fun ResultSet.toSession() = AssistantSession(
        sessionId = getObject("session_id", UUID::class.java),
        accountId = getObject("account_id", UUID::class.java),
        tripId = getObject("trip_id", UUID::class.java),
        createdAt = getTimestamp("created_at").toInstant(),
        lastTurnAt = getTimestamp("last_turn_at").toInstant(),
        expiresAt = getTimestamp("expires_at").toInstant(),
        dialogueContext = getString("dialogue_context"),
        refusalStreak = getInt("refusal_streak"),
    )

    private companion object {
        const val SELECT =
            "SELECT session_id, account_id, trip_id, created_at, last_turn_at, expires_at, dialogue_context, refusal_streak FROM assistant_session"
    }
}

/** assistant_message 매핑(V2.64). */
@Component
class AssistantMessageRepositoryAdapter(
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
) : AssistantMessageRepository {

    /**
     * 저장된 행은 **지금의 타입보다 오래 산다.** 필드가 늘어난 뒤 옛 파드가(배포 중·롤백 뒤) 새 행을 읽어도 죽지 않게
     * 모르는 필드는 버린다 — 한 줄이 못 읽히면 그 대화는 열기도 조회도 500 이 된다.
     */
    private val reader = mapper.reader().without(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)

    override fun appendUser(sessionId: UUID, accountId: UUID, clientTurnId: UUID, message: NewMessage, at: Instant) =
        insert(sessionId, accountId, clientTurnId, message, at)

    override fun appendAssistant(sessionId: UUID, accountId: UUID, message: NewMessage, at: Instant) =
        insert(sessionId, accountId, null, message, at)

    /** `RETURNING` 으로 DB 가 매긴 순번까지 한 번에 받는다 — 넣고 다시 읽으면 그 사이가 한 번 더 비는 왕복이다. */
    private fun insert(sessionId: UUID, accountId: UUID, clientTurnId: UUID?, m: NewMessage, at: Instant): AssistantMessage = jdbc.query(
        """
        INSERT INTO assistant_message (
            message_id, session_id, account_id, client_turn_id, role, kind, text, redacted, payload, next_actions, quick_replies,
            intent, match_route, outcome, llm_calls, latency_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?, ?)
        RETURNING $COLUMNS
        """.trimIndent(),
        { rs, _ -> rs.toMessage() },
        UUID.randomUUID(), sessionId, accountId, clientTurnId, m.role.name, m.kind.name, m.text, m.redacted,
        m.payload?.let(mapper::writeValueAsString), mapper.writeValueAsString(m.nextActions), m.quickReplies?.let(mapper::writeValueAsString),
        m.intent, m.matchRoute, m.outcome, m.llmCalls, m.latencyMs, Timestamp.from(at),
    ).single()

    /** 사용자 행과, 그 뒤 **다음 사용자 행 전까지**의 도우미 행 — 한 턴의 응답은 그 사이에만 있다. */
    override fun findTurn(sessionId: UUID, clientTurnId: UUID): RecordedTurn? {
        val user = jdbc.query(
            "SELECT $COLUMNS FROM assistant_message WHERE session_id = ? AND client_turn_id = ?",
            { rs, _ -> rs.toMessage() }, sessionId, clientTurnId,
        ).firstOrNull() ?: return null
        val replies = jdbc.query(
            """
            SELECT $COLUMNS FROM assistant_message
             WHERE session_id = ? AND role = 'ASSISTANT' AND seq > ?
               AND seq < COALESCE((SELECT min(seq) FROM assistant_message WHERE session_id = ? AND role = 'USER' AND seq > ?), 9223372036854775807)
             ORDER BY seq
            """.trimIndent(),
            { rs, _ -> rs.toMessage() }, sessionId, user.seq, sessionId, user.seq,
        )
        return RecordedTurn(user, replies)
    }

    override fun userTurnTimesSince(accountId: UUID, since: Instant): List<Instant> = jdbc.query(
        "SELECT created_at FROM assistant_message WHERE account_id = ? AND role = 'USER' AND created_at > ? ORDER BY created_at",
        { rs, _ -> rs.getTimestamp(1).toInstant() }, accountId, Timestamp.from(since),
    )

    /** jsonb 포함 연산으로 그 id 를 발급한 행만 고른 뒤, 그 행의 목록에서 꺼낸다. */
    override fun findIssuedQuickReply(sessionId: UUID, quickReplyId: String): QuickReply? = jdbc.query(
        """
        SELECT quick_replies FROM assistant_message
         WHERE session_id = ? AND role = 'ASSISTANT' AND quick_replies @> ?::jsonb
         ORDER BY seq DESC LIMIT 1
        """.trimIndent(),
        { rs, _ -> reader.forType(QUICK_REPLIES).readValue<List<QuickReply>>(rs.getString(1)) },
        sessionId, mapper.writeValueAsString(listOf(mapOf("id" to quickReplyId))),
    ).firstOrNull()?.firstOrNull { it.id == quickReplyId }

    override fun lastUserText(sessionId: UUID, beforeSeq: Long): String? = jdbc.query(
        """
        SELECT text FROM assistant_message
         WHERE session_id = ? AND role = 'USER' AND seq < ? AND redacted = false AND text IS NOT NULL
           AND intent IS DISTINCT FROM 'RETRY'
         ORDER BY seq DESC LIMIT 1
        """.trimIndent(),
        { rs, _ -> rs.getString(1) }, sessionId, beforeSeq,
    ).firstOrNull()

    /** 최근 것부터 [limit] 건을 집고 뒤집는다 — 화면은 오래된 것이 위다. */
    override fun findPage(sessionId: UUID, beforeSeq: Long?, limit: Int): List<AssistantMessage> = jdbc.query(
        """
        SELECT $COLUMNS
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
        const val COLUMNS = "message_id, seq, role, kind, text, payload, next_actions, quick_replies, footnote, created_at"
        val PAYLOAD = object : TypeReference<Map<String, Any?>>() {}
        val NEXT_ACTIONS = object : TypeReference<List<NextAction>>() {}
        val QUICK_REPLIES = object : TypeReference<List<QuickReply>>() {}
    }
}

/** assistant_usage_daily(V2.64) — 계정·일 카운터. `ON CONFLICT` 로 "없으면 만들고 있으면 더한다"를 한 문장에. */
@Component
class AssistantUsageRepositoryAdapter(private val jdbc: JdbcTemplate) : AssistantUsageRepository, AccountTurnLock {

    override fun llmTurns(accountId: UUID, day: LocalDate): Int = jdbc.query(
        "SELECT llm_turns FROM assistant_usage_daily WHERE account_id = ? AND day = ?",
        { rs, _ -> rs.getInt(1) }, accountId, java.sql.Date.valueOf(day),
    ).firstOrNull() ?: 0

    override fun record(accountId: UUID, day: LocalDate, llm: Boolean) {
        jdbc.update(
            """
            INSERT INTO assistant_usage_daily (account_id, day, turns, llm_turns) VALUES (?, ?, 1, ?)
            ON CONFLICT (account_id, day) DO UPDATE
               SET turns = assistant_usage_daily.turns + 1, llm_turns = assistant_usage_daily.llm_turns + EXCLUDED.llm_turns
            """.trimIndent(),
            accountId, java.sql.Date.valueOf(day), if (llm) 1 else 0,
        )
    }

    /**
     * 트랜잭션이 끝날 때 풀리는 잠금(SEC-U8-01). 이름공간은 이 모듈 것이고, 키는 계정 id 의 해시다 —
     * 다른 계정과 겹쳐도 잠깐 같이 줄을 설 뿐 틀린 결과는 없다.
     */
    override fun acquire(accountId: UUID) {
        jdbc.query("SELECT pg_advisory_xact_lock(?, ?)", { _ -> }, LOCK_NAMESPACE, accountId.hashCode())
    }

    private companion object {
        /** 다른 모듈의 이름공간(403 생성 세션 · 828 회고)과 겹치지 않게. */
        const val LOCK_NAMESPACE = 816
    }
}
