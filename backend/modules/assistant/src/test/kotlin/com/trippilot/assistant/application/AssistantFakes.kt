package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSession
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.AssistantUsageRepository
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.NewMessage
import com.trippilot.assistant.domain.QuickReply
import com.trippilot.assistant.domain.RecordedTurn
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.TransactionStatus
import org.springframework.transaction.support.SimpleTransactionStatus
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 실 어댑터와 **같은 규칙**의 인메모리 대역. DB 가 보장하는 것(부분 유니크·CASCADE·CHECK·잠금)은 여기서 재지 않는다 —
 * 그건 `AssistantApiIT`·`AssistantTurnIT` 가 실 DB 로 잰다.
 */
internal class FakeSessions : AssistantSessionRepository {
    val rows = mutableListOf<AssistantSession>()
    override fun openOrGet(candidate: AssistantSession) =
        rows.firstOrNull { it.accountId == candidate.accountId && it.tripId == candidate.tripId } ?: candidate.also { rows += it }
    override fun findOwned(accountId: UUID, sessionId: UUID, now: Instant) =
        rows.firstOrNull { it.sessionId == sessionId && it.accountId == accountId && it.expiresAt > now }
    override fun findByAccount(accountId: UUID, now: Instant, limit: Int) =
        rows.filter { it.accountId == accountId && it.expiresAt > now }.sortedByDescending { it.lastTurnAt }.take(limit)
    override fun recordTurn(sessionId: UUID, at: Instant, expiresAt: Instant, dialogueContext: String, refusalStreak: Int) {
        rows.replaceAll {
            if (it.sessionId == sessionId) it.copy(lastTurnAt = at, expiresAt = expiresAt, dialogueContext = dialogueContext, refusalStreak = refusalStreak) else it
        }
    }
    override fun delete(accountId: UUID, sessionId: UUID): Int = remove { it.sessionId == sessionId && it.accountId == accountId }
    override fun deleteByTrip(tripId: UUID): Int = remove { it.tripId == tripId }
    private fun remove(match: (AssistantSession) -> Boolean): Int {
        val before = rows.size
        rows.removeAll(match)
        return before - rows.size
    }
}

internal class FakeMessages : AssistantMessageRepository {
    /** 저장된 행 — 화면에 안 나가는 칸(계정·턴 id·관측 칸)까지 본다. */
    data class Row(val sessionId: UUID, val accountId: UUID, val clientTurnId: UUID?, val saved: NewMessage, val message: AssistantMessage)

    val rows = mutableListOf<Row>()
    private var seq = 0L

    /** 읽기 테스트용 — 이미 만들어진 메시지를 그대로 심는다. */
    fun seed(sessionId: UUID, vararg messages: AssistantMessage) {
        messages.forEach { rows += Row(sessionId, UUID.randomUUID(), null, NewMessage(it.role, it.kind, it.text), it) }
        seq = maxOf(seq, messages.maxOfOrNull { it.seq } ?: 0L)
    }

    override fun appendUser(sessionId: UUID, accountId: UUID, clientTurnId: UUID, message: NewMessage, at: Instant): AssistantMessage {
        check(rows.none { it.sessionId == sessionId && it.clientTurnId == clientTurnId }) { "같은 턴 id 의 두 번째 행 — DB 는 유니크로 거부한다" }
        return insert(sessionId, accountId, clientTurnId, message, at)
    }

    override fun appendAssistant(sessionId: UUID, accountId: UUID, message: NewMessage, at: Instant): AssistantMessage {
        check(message.nextActions.isNotEmpty()) { "다음 행동 없는 도우미 메시지 — DB 는 CHECK 로 거부한다(INV-U8-03)" }
        return insert(sessionId, accountId, null, message, at)
    }

    private fun insert(sessionId: UUID, accountId: UUID, clientTurnId: UUID?, m: NewMessage, at: Instant): AssistantMessage {
        val stored = AssistantMessage(UUID.randomUUID(), ++seq, m.role, m.kind, m.text, m.payload, m.nextActions, m.quickReplies, null, at)
        rows += Row(sessionId, accountId, clientTurnId, m, stored)
        return stored
    }

    override fun findTurn(sessionId: UUID, clientTurnId: UUID): RecordedTurn? {
        val inSession = rows.filter { it.sessionId == sessionId }.sortedBy { it.message.seq }
        val user = inSession.firstOrNull { it.clientTurnId == clientTurnId } ?: return null
        val replies = inSession.dropWhile { it.message.seq <= user.message.seq }.takeWhile { it.message.role == MessageRole.ASSISTANT }
        return RecordedTurn(user.message, replies.map { it.message })
    }

    override fun userTurnTimesSince(accountId: UUID, since: Instant) =
        rows.filter { it.accountId == accountId && it.message.role == MessageRole.USER && it.message.createdAt > since }
            .map { it.message.createdAt }.sorted()

    override fun findIssuedQuickReply(sessionId: UUID, quickReplyId: String): QuickReply? =
        rows.filter { it.sessionId == sessionId && it.message.role == MessageRole.ASSISTANT }.sortedByDescending { it.message.seq }
            .firstNotNullOfOrNull { row -> row.message.quickReplies?.firstOrNull { it.id == quickReplyId } }

    override fun lastUserText(sessionId: UUID, beforeSeq: Long): String? =
        rows.filter { it.sessionId == sessionId && it.message.role == MessageRole.USER && it.message.seq < beforeSeq }
            .filter { !it.saved.redacted && it.message.text != null && it.saved.intent != "RETRY" }
            .maxByOrNull { it.message.seq }?.message?.text

    override fun findPage(sessionId: UUID, beforeSeq: Long?, limit: Int) =
        rows.filter { it.sessionId == sessionId }.map { it.message }.filter { beforeSeq == null || it.seq < beforeSeq }.sortedBy { it.seq }.takeLast(limit)
}

internal class FakeUsage : AssistantUsageRepository {
    val turns = mutableMapOf<Pair<UUID, LocalDate>, Int>()
    val llm = mutableMapOf<Pair<UUID, LocalDate>, Int>()
    override fun llmTurns(accountId: UUID, day: LocalDate) = llm[accountId to day] ?: 0
    override fun record(accountId: UUID, day: LocalDate, llm: Boolean) {
        turns.merge(accountId to day, 1, Int::plus)
        if (llm) this.llm.merge(accountId to day, 1, Int::plus)
    }
}

internal val NOOP_TX = object : PlatformTransactionManager {
    override fun getTransaction(definition: TransactionDefinition?): TransactionStatus = SimpleTransactionStatus()
    override fun commit(status: TransactionStatus) {}
    override fun rollback(status: TransactionStatus) {}
}
