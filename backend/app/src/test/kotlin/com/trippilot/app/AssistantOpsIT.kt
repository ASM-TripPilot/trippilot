package com.trippilot.app

import com.trippilot.app.export.AccountExportService
import com.trippilot.assistant.application.AssistantRetention
import com.trippilot.assistant.application.AssistantTemplates
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSession
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.AssistantUsageRepository
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.NewMessage
import com.trippilot.auth.api.event.AccountDeletionRequested
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * 도우미 데이터의 파기·내보내기(U8 · TRIP-1380) — **실 DB 로만 드러나는 것**을 잰다.
 *
 * 대화가 지워질 때 메시지가 정말 함께 가는지(CASCADE), 날짜 경계가 DB 비교로도 맞는지, 계정 삭제 구독이 실제 이벤트
 * 이름에 물려 있는지, 내보내기에 남의 말이 한 줄도 섞이지 않는지는 대역으로는 모른다 — 대역은 애초에 한 계정 것만 든다.
 * 배경 청소는 테스트 설정에서 꺼져 있고 여기서 `sweep()` 을 직접 부른다.
 */
@SpringBootTest
class AssistantOpsIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var retention: AssistantRetention
    @Autowired private lateinit var export: AccountExportService
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var sessions: AssistantSessionRepository
    @Autowired private lateinit var messages: AssistantMessageRepository
    @Autowired private lateinit var usage: AssistantUsageRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    @Autowired
    @Qualifier("assistantAccountDeletionSubscriber")
    private lateinit var accountDeletion: OutboxSubscriber

    private val now: Instant = Instant.now()
    private val today: LocalDate = LocalDate.ofInstant(now, ZoneId.of("Asia/Seoul"))

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z"))).id.value

    /** 여행 없는 대화 하나와 그 안의 말 — 사용자 한 줄, 도우미 한 줄. */
    private fun conversation(accountId: UUID, said: String, expiresAt: Instant = now + Duration.ofDays(90)): UUID {
        val session = sessions.openOrGet(AssistantSession(UUID.randomUUID(), accountId, null, now, now, expiresAt))
        val turn = UUID.randomUUID()
        messages.appendUser(session.sessionId, accountId, turn, NewMessage(MessageRole.USER, MessageKind.TEXT, said), now)
        messages.appendAssistant(session.sessionId, accountId, turn, AssistantTemplates.capabilities(hasTrip = false), now)
        return session.sessionId
    }

    private fun messageCount(sessionId: UUID): Int =
        jdbc.queryForObject("SELECT count(*) FROM assistant_message WHERE session_id = ?", Int::class.java, sessionId)!!

    private fun sessionExists(sessionId: UUID): Boolean =
        jdbc.queryForObject("SELECT count(*) FROM assistant_session WHERE session_id = ?", Int::class.java, sessionId)!! == 1

    private fun usageDays(accountId: UUID): List<LocalDate> =
        jdbc.query("SELECT day FROM assistant_usage_daily WHERE account_id = ? ORDER BY day", { rs, _ -> rs.getDate(1).toLocalDate() }, accountId)

    @Test
    fun `보존 청소는 만료된 대화를 메시지째 지우고 살아 있는 대화와 최근 사용량은 둔다`() {
        val expired = conversation(newAccount(), "지난 여행 이야기", expiresAt = now.minusSeconds(1))
        val account = newAccount()
        val live = conversation(account, "오늘 날씨")
        usage.record(account, today.minusDays(41), llm = true)
        usage.record(account, today.minusDays(40), llm = true)
        usage.record(account, today, llm = false)

        retention.sweep()

        sessionExists(expired) shouldBe false
        messageCount(expired) shouldBe 0 // 사용자가 한 말이 남지 않는다
        jdbc.queryForObject("SELECT count(*) FROM assistant_proposal WHERE session_id = ?", Int::class.java, expired) shouldBe 0
        sessionExists(live) shouldBe true
        messageCount(live) shouldBe 2
        usageDays(account) shouldContainExactly listOf(today.minusDays(40), today) // 40일은 남고 41일은 간다
        retention.sweep() // 다시 돌아도 같다
        messageCount(live) shouldBe 2
    }

    /** COST-U8-04 — 전역 월 상한이 세는 값. **모든 계정의, 그 날부터의** 합이다(다른 테스트의 행이 섞여 있어 늘어난 만큼으로 잰다). */
    @Test
    fun `전역 LLM 턴 합계는 기준일부터 모든 계정의 것을 더한다`() {
        val from = today.minusDays(2)
        val before = usage.llmTurnsSince(from)

        usage.record(newAccount(), today, llm = true)
        usage.record(newAccount(), from, llm = true) // 기준일 당일은 센다
        usage.record(newAccount(), from.minusDays(1), llm = true) // 그 전날은 세지 않는다
        usage.record(newAccount(), today, llm = false) // LLM 을 안 쓴 턴은 세지 않는다

        usage.llmTurnsSince(from) - before shouldBe 2
    }

    /** DATA-U8-02 — 유예(30일)를 기다리지 않는다. 계정 행은 그동안 남으므로 FK CASCADE 는 닿지 않는다. */
    @Test
    fun `계정 삭제 요청이 오면 그 계정의 대화와 사용량을 즉시 지운다 — 남의 것은 그대로다`() {
        val leaving = newAccount()
        val staying = newAccount()
        val gone = conversation(leaving, "탈퇴하는 사람의 말")
        val kept = conversation(staying, "남는 사람의 말")
        usage.record(leaving, today, llm = true)
        usage.record(staying, today, llm = true)
        val event = AccountDeletionRequested(leaving.toString(), UUID.randomUUID().toString(), now + Duration.ofDays(30))
        // 구독이 **실제 이벤트 이름**에 물려 있다 — 이름이 어긋나면 릴레이가 이 구독자를 영영 부르지 않는다
        accountDeletion.eventType shouldBe event.eventType
        val envelope = EventEnvelope(UUID.randomUUID(), event.eventType, 1, event.aggregateType, event.aggregateId, null, now, "{}")

        accountDeletion.handle(envelope)
        accountDeletion.handle(envelope) // 같은 이벤트가 두 번 와도 된다(at-least-once)

        sessionExists(gone) shouldBe false
        messageCount(gone) shouldBe 0
        usageDays(leaving) shouldBe emptyList()
        sessionExists(kept) shouldBe true
        messageCount(kept) shouldBe 2
        usageDays(staying) shouldContainExactly listOf(today)
        (accounts.findById(AccountId(leaving)) != null) shouldBe true // 계정 행 자체는 이 구독이 건드리지 않는다
    }

    /** DATA-U8-06 — 이 표면의 유일한 안전 요건은 남의 데이터가 한 줄도 섞이지 않는 것이다. */
    @Test
    fun `내보내기에는 내 대화만 실리고 가려진 입력은 표지만 나간다`() {
        val mine = newAccount()
        val session = conversation(mine, "내가 한 말")
        messages.appendUser(session, mine, UUID.randomUUID(), NewMessage(MessageRole.USER, MessageKind.TEXT, text = null, redacted = true, outcome = "VIOLATION"), now)
        conversation(newAccount(), "남이 한 말")
        // 보존 기간이 지난 대화는 이미 없는 것이다 — 청소가 아직 안 돌았어도 내보내지 않는다
        val old = newAccount()
        conversation(old, "오래된 말", expiresAt = now.minusSeconds(1))

        val items = export.export(mine).sections.single { it.section == "assistantMessages" }.items

        items.map { listOf(it["role"], it["text"], it["redacted"]) } shouldContainExactly listOf(
            listOf("USER", "내가 한 말", false),
            listOf("ASSISTANT", AssistantTemplates.capabilities(hasTrip = false).text, false),
            listOf("USER", null, true),
        )
        items.all { it["sessionId"] == session.toString() } shouldBe true
        export.export(old).sections.single { it.section == "assistantMessages" }.items shouldBe emptyList()

        // 상한을 넘으면 자르고 그렇다고 알린다
        val cut = export.export(mine, perSectionLimit = 2)
        cut.sections.single { it.section == "assistantMessages" }.let { it.items.size to it.truncated } shouldBe (2 to true)
        ("assistantMessages" in cut.truncatedSections) shouldBe true
    }
}
