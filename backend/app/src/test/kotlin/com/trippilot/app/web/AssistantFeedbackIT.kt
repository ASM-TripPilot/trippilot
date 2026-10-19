package com.trippilot.app.web

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.event.OutboxRelay
import com.trippilot.app.export.AccountExportService
import com.trippilot.assistant.application.AssistantFeedbackService
import com.trippilot.assistant.application.AssistantRetention
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.FeedbackRating
import com.trippilot.assistant.domain.FeedbackReason
import com.trippilot.assistant.domain.MessageFeedback
import com.trippilot.auth.api.event.AccountDeletionRequested
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.core.io.ClassPathResource
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import org.yaml.snakeyaml.Yaml
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

/**
 * 도우미 답변 평가 E2E(US-ASSIST-09) — **실 DB 와 실 배선으로만 드러나는 것**을 잰다.
 *
 * 평가는 메시지에 매달린 행이다(PK = `message_id`). "다시 누르면 바꾼다"는 upsert(`ON CONFLICT`)가, "대화와 함께 사라진다"는
 * FK CASCADE 가 받친다 — 둘 다 단위 테스트의 대역(Map)으로는 원리적으로 못 본다. 파기는 **"있음"을 센다**(평가 행 1 → 0) —
 * "없음"만 세면 애초에 남지 않은 경우도 초록이다(anti-patterns).
 *
 * 응답 키는 **계약(openapi.yaml)의 property 집합과 대 본다** — 있는 키만 골라 물으면 빠진 키를 영영 못 본다(anti-patterns).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AssistantFeedbackIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var retention: AssistantRetention
    @Autowired private lateinit var export: AccountExportService
    @Autowired private lateinit var sessionStore: AssistantSessionRepository
    @Autowired private lateinit var messageStore: AssistantMessageRepository
    @Autowired private lateinit var clock: Clock

    @Autowired
    @Qualifier("assistantAccountDeletionSubscriber")
    private lateinit var accountDeletion: OutboxSubscriber

    private val json = ObjectMapper()

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build().method(method).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> }).toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun newAccount(): Pair<UUID, String> {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z")))
        return account.id.value to accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun newTrip(token: String): String {
        val body = """{"startDate":"2026-11-01","endDate":"2026-11-03","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":2}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun open(token: String, tripId: String? = null): JsonNode =
        call(HttpMethod.POST, "/api/v1/assistant/sessions", token, """{"tripId":${tripId?.let { "\"$it\"" } ?: "null"}}""").second

    private fun say(token: String, session: String, text: String): JsonNode = call(
        HttpMethod.POST, "/api/v1/assistant/sessions/$session/turns", token,
        """{"clientTurnId":"${UUID.randomUUID()}","input":{"type":"TEXT","text":"$text"},"screen":{"surface":"ITINERARY"}}""",
    ).also { it.first shouldBe 200 }.second

    /** 한 턴을 보내고 그 턴의 도우미 답 id 를 돌려준다. */
    private fun answer(token: String, session: String, text: String = "오늘 날씨"): String = say(token, session, text)["messages"][1]["id"].asText()

    private fun feedbackPath(session: String, message: String) = "/api/v1/assistant/sessions/$session/messages/$message/feedback"

    private fun rate(token: String?, session: String, message: String, body: String = """{"rating":"UP"}""") =
        call(HttpMethod.PUT, feedbackPath(session, message), token, body)

    private fun unrate(token: String?, session: String, message: String) = call(HttpMethod.DELETE, feedbackPath(session, message), token)

    private fun feedbackRows(message: String): Int =
        jdbc.queryForObject("SELECT count(*) FROM assistant_message_feedback WHERE message_id = ?::uuid", Int::class.java, message)!!

    private fun messages(token: String, session: String): JsonNode =
        call(HttpMethod.GET, "/api/v1/assistant/sessions/$session/messages", token).also { it.first shouldBe 200 }.second["messages"]

    private fun JsonNode.byId(id: String): JsonNode = first { it["id"].asText() == id }

    private fun JsonNode.keys(): Set<String> = fieldNames().asSequence().toSet()

    /** 계약의 스키마 property 들 — 빌드가 복사한 classpath 정본을 읽는다(`OpenApiContractIT` 와 같은 원천). */
    private fun contractProperties(schema: String): Map<String, Any> {
        @Suppress("UNCHECKED_CAST")
        val schemas = (Yaml().load<Map<String, Any>>(ClassPathResource("static/openapi.yaml").inputStream)["components"] as Map<String, Any>)["schemas"] as Map<String, Any>
        @Suppress("UNCHECKED_CAST")
        return (schemas.getValue(schema) as Map<String, Any>)["properties"] as Map<String, Any>
    }

    private fun contractKeys(schema: String): Set<String> = contractProperties(schema).keys

    /** 계약이 그 칸에 허용하는 값(null 제외) — DB CHECK 가 계약과 같은 집합인지 잴 때 쓴다. */
    private fun contractEnum(schema: String, property: String): List<String> =
        ((contractProperties(schema).getValue(property) as Map<*, *>)["enum"] as List<*>).filterNotNull().map { it.toString() }

    /** 평가 본문 — 의견은 이스케이프가 필요한 글(이모지·줄바꿈·NUL)이라 손으로 잇지 않고 직렬화한다. */
    private fun feedback(rating: String, reason: String? = null, comment: String? = null): String =
        json.writeValueAsString(mapOf("rating" to rating, "reason" to reason, "comment" to comment))

    /** 저장된 평가 한 행 — `[rating, reason, comment]`. */
    private fun stored(message: String): List<Any?> =
        jdbc.queryForMap("SELECT rating, reason, comment FROM assistant_message_feedback WHERE message_id = ?::uuid", message)
            .let { listOf(it["rating"], it["reason"], it["comment"]) }

    /** 그동안 **모든 로거**가 남긴 줄 — 루트에 붙여 듣는다(요청은 서버 스레드에서 돌지만 같은 JVM 이다). */
    private fun capturingLogs(block: () -> Unit): List<ILoggingEvent> {
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val root = LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME) as Logger
        root.addAppender(appender)
        try {
            block()
        } finally {
            root.detachAppender(appender)
        }
        return synchronized(appender) { appender.list.toList() }
    }

    /** 메시지 본문과 예외 사슬의 메시지 어디에든 [text] 가 있는가. */
    private fun ILoggingEvent.mentions(text: String): Boolean =
        text in formattedMessage || generateSequence(throwableProxy) { it.cause }.any { text in (it.message ?: "") }

    @Test
    fun `좋아요를 누르면 남고 싫어요로 바꾸면 바뀌며 취소하면 사라진다 — 턴 응답·조회·열기에 그대로 보인다`() {
        val (_, token) = newAccount()
        val session = open(token)["session"]["id"].asText()
        val turn = say(token, session, "오늘 날씨")
        val reply = turn["messages"][1]["id"].asText()
        val said = turn["messages"][0]["id"].asText()
        // 턴 응답의 메시지도 같은 모양이다 — 막 생긴 답은 평가가 없다
        turn["messages"].forEach { it.keys() shouldBe contractKeys("AssistantMessage") }
        turn["messages"][1]["feedback"].isNull shouldBe true

        val (status, rated) = rate(token, session, reply)

        status shouldBe 200
        rated.keys() shouldBe contractKeys("AssistantFeedbackResponse")
        listOf(rated["messageId"].asText(), rated["rating"].asText()) shouldContainExactly listOf(reply, "UP")
        val page = messages(token, session)
        page.forEach { it.keys() shouldBe contractKeys("AssistantMessage") }
        page.byId(reply)["feedback"].asText() shouldBe "UP"
        page.byId(said)["feedback"].isNull shouldBe true // 사용자 말에는 평가가 없다
        val first = jdbc.queryForMap("SELECT rating, created_at, updated_at FROM assistant_message_feedback WHERE message_id = ?::uuid", reply)

        // 다시 누르면 바꾼다 — 행은 하나 그대로이고 처음 남긴 시각도 그대로, 바꾼 시각만 간다
        rate(token, session, reply, """{"rating":"DOWN"}""").let { (s, b) -> listOf(s, b["rating"].asText()) shouldContainExactly listOf(200, "DOWN") }
        feedbackRows(reply) shouldBe 1
        val second = jdbc.queryForMap("SELECT rating, created_at, updated_at FROM assistant_message_feedback WHERE message_id = ?::uuid", reply)
        second["rating"] shouldBe "DOWN"
        second["created_at"] shouldBe first["created_at"]
        ((second["updated_at"] as java.sql.Timestamp).after(first["updated_at"] as java.sql.Timestamp)) shouldBe true
        // 다시 열어도 같은 값이 온다
        open(token)["messages"].byId(reply)["feedback"].asText() shouldBe "DOWN"

        // 취소 — 없어도 204 다(멱등)
        unrate(token, session, reply).first shouldBe 204
        feedbackRows(reply) shouldBe 0
        messages(token, session).byId(reply)["feedback"].isNull shouldBe true
        unrate(token, session, reply).first shouldBe 204
    }

    @Test
    fun `평가할 수 없는 것은 400 이다 — 이상한 평가, 사용자 말, 적용 기록`() {
        val (accountId, token) = newAccount()
        val session = open(token)["session"]["id"].asText()
        val turn = say(token, session, "오늘 날씨")
        val reply = turn["messages"][1]["id"].asText()
        val said = turn["messages"][0]["id"].asText()
        val actionLog = UUID.randomUUID().toString()
        jdbc.update(
            """
            INSERT INTO assistant_message (message_id, session_id, account_id, role, kind, text, next_actions, created_at)
            VALUES (?::uuid, ?::uuid, ?, 'ASSISTANT', 'ACTION_LOG', '카페 모카 → 책방카페', '[{"type":"OPEN_ITINERARY","label":"일정 보기","params":{}}]'::jsonb, now())
            """.trimIndent(),
            actionLog, session, accountId,
        )

        listOf("""{"rating":"MEH"}""", """{"rating":"up"}""", """{"rating":null}""", "{}").forEach { body ->
            rate(token, session, reply, body).let { (s, b) -> listOf(s, b["error"]["code"].asText()) shouldContainExactly listOf(400, "VALIDATION_ERROR") }
        }
        rate(token, session, said).first shouldBe 400
        rate(token, session, actionLog).first shouldBe 400
        unrate(token, session, said).first shouldBe 400 // 평가가 붙을 수 없는 대상은 지우기도 같은 답이다
        jdbc.queryForObject("SELECT count(*) FROM assistant_message_feedback WHERE account_id = ?", Int::class.java, accountId) shouldBe 0
    }

    @Test
    fun `남의 대화·없는 대화·만료된 대화·다른 대화의 메시지·없는 메시지는 404 이고 인증 없으면 401 이다`() {
        val (_, owner) = newAccount()
        val (_, stranger) = newAccount()
        val session = open(owner)["session"]["id"].asText()
        val reply = answer(owner, session)
        val otherSession = open(owner, newTrip(owner))["session"]["id"].asText()
        val otherReply = answer(owner, otherSession)

        listOf(
            Triple(stranger, session, reply), // 남의 대화 — 있는지도 모르게
            Triple(owner, UUID.randomUUID().toString(), reply), // 없는 대화
            Triple(owner, session, otherReply), // 내 다른 대화의 메시지
            Triple(owner, session, UUID.randomUUID().toString()), // 없는 메시지
        ).forEach { (token, s, m) ->
            rate(token, s, m).first shouldBe 404
            unrate(token, s, m).first shouldBe 404
        }
        rate(null, session, reply).first shouldBe 401
        unrate(null, session, reply).first shouldBe 401
        feedbackRows(reply) shouldBe 0
        feedbackRows(otherReply) shouldBe 0

        // 보존 기간이 지난 대화 — 청소가 아직 안 돌았어도 없는 것이다
        rate(owner, session, reply).first shouldBe 200
        jdbc.update("UPDATE assistant_session SET expires_at = now() - interval '1 hour' WHERE session_id = ?::uuid", session)
        rate(owner, session, reply, """{"rating":"DOWN"}""").first shouldBe 404
        unrate(owner, session, reply).first shouldBe 404
        jdbc.queryForObject("SELECT rating FROM assistant_message_feedback WHERE message_id = ?::uuid", String::class.java, reply) shouldBe "UP"
    }

    /**
     * 확인과 쓰기 사이에 대화가 지워지는 경합(이력 지우기·여행 삭제 등이 평가 PUT 과 겹친다) — 쓰기 직전에 대화를 지워 순서를 고정한다
     * (스레드 경합에 기대지 않는다). 실 DB 의 메시지 FK 위반이 정말 `DataIntegrityViolationException` 으로 올라오는지 — 단위 테스트
     * 대역의 전제 — 를 여기서 본다. 계약은 없는 대화(404)다 — 500 이 아니다.
     */
    @Test
    fun `평가를 쓰기 직전에 대화가 지워지면 실 DB 의 FK 위반이 없는 대화(404)가 된다`() {
        val (owner, token) = newAccount()
        val session = open(token)["session"]["id"].asText()
        val reply = answer(token, session)
        val racing = object : AssistantMessageRepository by messageStore {
            override fun upsertFeedback(messageId: UUID, accountId: UUID, feedback: MessageFeedback, at: Instant) {
                jdbc.update("DELETE FROM assistant_session WHERE session_id = ?::uuid", session) shouldBe 1 // 세션 → 메시지 연쇄
                messageStore.upsertFeedback(messageId, accountId, feedback, at)
            }
        }

        shouldThrow<ResourceNotFound> {
            AssistantFeedbackService(sessionStore, racing, json, clock)
                .rate(owner, UUID.fromString(session), UUID.fromString(reply), FeedbackRating.DOWN, FeedbackReason.WRONG, "지워진 대화의 의견")
        }
        feedbackRows(reply) shouldBe 0
    }

    /** BR-U8-24 의 분당 20턴은 사용자 턴을 센다. 평가가 턴으로 세지면 답을 몇 번 평가한 사람이 말을 못 하게 된다. */
    @Test
    fun `평가는 턴이 아니다 — 분당 상한을 쓰지 않고 메시지·사용량이 늘지 않는다`() {
        val (accountId, token) = newAccount()
        val session = open(token)["session"]["id"].asText()
        val reply = answer(token, session)
        repeat(18) { // 방금 한 턴과 합쳐 19턴 — 한 턴만 더 받는다
            jdbc.update(
                "INSERT INTO assistant_message (message_id, session_id, account_id, client_turn_id, role, kind, text, created_at) VALUES (?, ?::uuid, ?, ?, 'USER', 'TEXT', '앞선 말', now())",
                UUID.randomUUID(), session, accountId, UUID.randomUUID(),
            )
        }
        val countMessages = { jdbc.queryForObject("SELECT count(*) FROM assistant_message WHERE session_id = ?::uuid", Int::class.java, session)!! }
        val usage = { jdbc.queryForMap("SELECT turns, llm_turns FROM assistant_usage_daily WHERE account_id = ?", accountId).values.toList() }
        val (messagesBefore, usageBefore) = countMessages() to usage()

        listOf(rate(token, session, reply), rate(token, session, reply, """{"rating":"DOWN"}"""), unrate(token, session, reply), rate(token, session, reply))
            .map { it.first } shouldContainExactly listOf(200, 200, 204, 200)

        countMessages() shouldBe messagesBefore // 도우미 메시지를 새로 만들지 않는다
        usage() shouldBe usageBefore
        say(token, session, "오늘 날씨") // 스무 번째 턴 — 평가가 창을 썼으면 429 였다
    }

    // ── 싫어요 이유·의견 — 싫어요에만 붙고 PUT 이 통째로 덮어쓴다. 의견은 사용자가 쓴 글이라 대화 원문과 같이 다룬다 ──

    /** "다시 보내면 바뀐다"는 upsert 의 `DO UPDATE SET` 이 받친다 — 칸을 빠뜨리면 옛 이유·의견이 새 평가에 붙어 남는다. 대역(Map)은 늘 통째로 바꿔 못 본다. */
    @Test
    fun `싫어요에 남긴 이유·의견이 그대로 돌아오고 다시 보내면 통째로 바뀌며 좋아요로 바꾸면 지워진다 — 메시지 읽기에는 평가만 실린다`() {
        val (_, token) = newAccount()
        val session = open(token)["session"]["id"].asText()
        val reply = answer(token, session)

        val (status, saved) = rate(token, session, reply, feedback("DOWN", "NOT_HELPFUL", "  날짜를 물었는데 날씨를 알려 줬어요 \n"))

        status shouldBe 200
        saved.keys() shouldBe contractKeys("AssistantFeedbackResponse")
        // 앞뒤 공백은 지워 저장하고, 응답도 저장한 값이다
        listOf(saved["rating"].asText(), saved["reason"].asText(), saved["comment"].asText()) shouldContainExactly
            listOf("DOWN", "NOT_HELPFUL", "날짜를 물었는데 날씨를 알려 줬어요")
        stored(reply) shouldContainExactly listOf("DOWN", "NOT_HELPFUL", "날짜를 물었는데 날씨를 알려 줬어요")
        // 메시지 읽기는 평가만 싣는다 — 계약의 메시지 칸 그대로이고 이유·의견 칸이 없다
        messages(token, session).byId(reply).let {
            it.keys() shouldBe contractKeys("AssistantMessage")
            it["feedback"].asText() shouldBe "DOWN"
        }

        // 다시 보내면 통째로 바뀐다 — 이번 본문에 없는 의견은 지워진다
        rate(token, session, reply, feedback("DOWN", "WRONG")).first shouldBe 200
        stored(reply) shouldContainExactly listOf("DOWN", "WRONG", null)
        // "직접 적기"만 — 이유 없이 의견만 남길 수 있다
        rate(token, session, reply, feedback("DOWN", comment = "직접 적은 말")).second.let {
            listOf(it.path("reason").isNull, it.path("comment").asText()) shouldContainExactly listOf(true, "직접 적은 말")
        }
        stored(reply) shouldContainExactly listOf("DOWN", null, "직접 적은 말")

        // 좋아요로 바꾸면 이유·의견이 함께 사라진다 — 행은 하나 그대로다
        rate(token, session, reply, feedback("UP")).second.let {
            listOf(it.path("reason").isNull, it.path("comment").isNull) shouldContainExactly listOf(true, true)
        }
        stored(reply) shouldContainExactly listOf("UP", null, null)
        feedbackRows(reply) shouldBe 1
    }

    @Test
    fun `계약의 이유 칩은 전부 저장되고 의견은 코드 포인트로 300자까지 받는다 — 공백뿐인 의견은 없는 것이다`() {
        val (_, token) = newAccount()
        val session = open(token)["session"]["id"].asText()
        val reply = answer(token, session)

        // DB CHECK 어휘가 계약과 같은 집합인가 — 하나라도 어긋나면 그 칩을 누른 사람만 500 을 본다
        val reasons = contractEnum("AssistantFeedbackRequest", "reason")
        reasons shouldContainExactly listOf("WRONG", "NOT_HELPFUL", "NOT_WHAT_I_WANTED") // 비면 아래 반복이 헛돈다
        reasons.forEach { reason ->
            withClue(reason) {
                rate(token, session, reply, feedback("DOWN", reason)).first shouldBe 200
                stored(reply)[1] shouldBe reason
            }
        }
        // 글자 수는 코드 포인트로 센다(DB `char_length` 와 같다) — 이모지 300개는 UTF-16 으로 600 단위다
        rate(token, session, reply, feedback("DOWN", comment = "😀".repeat(300))).first shouldBe 200
        jdbc.queryForObject("SELECT char_length(comment) FROM assistant_message_feedback WHERE message_id = ?::uuid", Int::class.java, reply) shouldBe 300
        // 공백뿐인 의견은 없는 것이다
        rate(token, session, reply, feedback("DOWN", "WRONG", " \n\t ")).second.path("comment").isNull shouldBe true
        stored(reply) shouldContainExactly listOf("DOWN", "WRONG", null)
    }

    @Test
    fun `좋아요에 실린 이유·의견, 계약에 없는 이유, 300자를 넘는 의견, NUL 은 400 이고 남긴 평가는 그대로다`() {
        val (_, token) = newAccount()
        val session = open(token)["session"]["id"].asText()
        val reply = answer(token, session)
        rate(token, session, reply, feedback("DOWN", "WRONG", "처음 남긴 의견")).first shouldBe 200

        listOf(
            feedback("UP", "WRONG"), // 이유는 싫어요에만
            feedback("UP", comment = "좋았어요"), // 의견도 싫어요에만
            feedback("DOWN", "MEH"),
            feedback("DOWN", "wrong"), // 어휘는 대문자 그대로다
            feedback("DOWN", comment = "가".repeat(301)),
            feedback("DOWN", comment = "글 사이\u0000NUL"), // DB 가 받지 않는 문자 — 저장에서 500 이 나기 전에 400 이다
        ).forEach { body ->
            withClue(body.take(80)) {
                rate(token, session, reply, body).let { (s, b) ->
                    listOf(s, b.path("error").path("code").asText()) shouldContainExactly listOf(400, "VALIDATION_ERROR")
                }
            }
        }
        stored(reply) shouldContainExactly listOf("DOWN", "WRONG", "처음 남긴 의견")
    }

    /** DB 가 마지막 방어선이다 — 서비스 검사를 거치지 않는 쓰기(수동 보정·배치)도 같은 규칙에 걸린다. 어느 제약에 걸렸는지까지 본다. */
    @Test
    fun `DB 도 막는다 — 좋아요 행의 이유·의견, 계약에 없는 이유, 300자를 넘는 의견`() {
        val (accountId, token) = newAccount()
        val session = open(token)["session"]["id"].asText()
        val reply = answer(token, session)
        val insert = "INSERT INTO assistant_message_feedback (message_id, account_id, rating, reason, comment) VALUES (?::uuid, ?, ?, ?, ?)"

        listOf(
            listOf("UP", "WRONG", null) to "ck_assistant_message_feedback_down_only",
            listOf("UP", null, "좋았어요") to "ck_assistant_message_feedback_down_only",
            listOf("DOWN", "MEH", null) to "assistant_message_feedback_reason_check",
            listOf("DOWN", null, "가".repeat(301)) to "assistant_message_feedback_comment_check",
        ).forEach { (row, constraint) ->
            withClue(constraint) {
                shouldThrow<DataIntegrityViolationException> { jdbc.update(insert, reply, accountId, *row.toTypedArray()) }.message shouldContain constraint
            }
        }
        feedbackRows(reply) shouldBe 0
        // 대조군 — 같은 문장이 맞는 값은 받는다(위 실패가 다른 이유로 난 것이 아니다)
        jdbc.update(insert, reply, accountId, "DOWN", "WRONG", "가".repeat(300)) shouldBe 1
    }

    /** SEC-U8-06 — 의견은 사용자가 쓴 글이다. 평가 로그는 이유와 의견 **유무**만 싣고, 거부된 요청의 오류 로그에도 본문이 없어야 한다. */
    @Test
    fun `평가 로그에는 이유와 의견 유무만 남고 의견 본문은 어느 로그에도 없다`() {
        val (_, token) = newAccount()
        val session = open(token)["session"]["id"].asText()
        val reply = answer(token, session)
        val secret = "의견본문-${UUID.randomUUID()}" // 다른 로그에 우연히 나올 수 없는 값

        val events = capturingLogs {
            rate(token, session, reply, feedback("DOWN", "NOT_WHAT_I_WANTED", "  $secret  ")).first shouldBe 200
            rate(token, session, reply, feedback("UP", comment = secret)).first shouldBe 400
            rate(token, session, reply, feedback("DOWN", comment = secret + "가".repeat(300))).first shouldBe 400
        }

        // "있음"을 먼저 센다 — 평가 로그 한 줄이 잡혀야 "본문이 없다"가 뜻을 갖는다(듣는 자리가 틀렸으면 아무것도 안 잡힌다)
        val line = events.map { it.formattedMessage }.single { it.startsWith("assistant_feedback ") && reply in it }
        json.readTree(line.removePrefix("assistant_feedback ")).let {
            listOf(it.path("rating").asText(), it.path("reason").asText(), it.path("has_comment").asText()) shouldContainExactly
                listOf("DOWN", "NOT_WHAT_I_WANTED", "true")
        }
        events.filter { it.mentions(secret) }.map { it.formattedMessage } shouldBe emptyList()
    }

    /** DATA-U8-06 — 이유·의견도 정보주체 열람 대상이다. 몫을 따로 두지 않고 그 답의 줄에 싣는다(BR-U8-62). */
    @Test
    fun `내보내기의 그 답 줄에 이유와 의견이 실린다`() {
        val (accountId, token) = newAccount()
        val session = open(token)["session"]["id"].asText()
        val reply = answer(token, session)
        rate(token, session, reply, feedback("DOWN", "WRONG", "일정을 물었는데 날씨를 알려 줬어요")).first shouldBe 200

        val rows = export.export(accountId).sections.single { it.section == "assistantMessages" }.items

        val rated = rows.single { it["feedback"] != null }
        listOf(rated["role"], rated["feedback"], rated["feedbackReason"], rated["feedbackComment"]) shouldContainExactly
            listOf("ASSISTANT", "DOWN", "WRONG", "일정을 물었는데 날씨를 알려 줬어요")
        (rows - rated).forEach { listOf(it["feedbackReason"], it["feedbackComment"]) shouldContainExactly listOf(null, null) }
    }

    // ── 파기 — 평가는 대화의 부속이다(BR-U8-62). 대화가 사라지는 네 길 모두에서 함께 간다 ──

    @Test
    fun `이력을 지우면 평가도 함께 사라진다`() {
        val (_, token) = newAccount()
        val session = open(token)["session"]["id"].asText()
        val reply = answer(token, session)
        rate(token, session, reply).first shouldBe 200
        feedbackRows(reply) shouldBe 1

        call(HttpMethod.DELETE, "/api/v1/assistant/sessions/$session", token).first shouldBe 204

        feedbackRows(reply) shouldBe 0
    }

    @Test
    fun `여행을 지우면 그 대화의 평가도 사라진다 — 다른 대화의 평가는 남는다`() {
        val (_, token) = newAccount()
        val trip = newTrip(token)
        val tripSession = open(token, trip)["session"]["id"].asText()
        val tripReply = answer(token, tripSession)
        val general = open(token)["session"]["id"].asText()
        val generalReply = answer(token, general)
        rate(token, tripSession, tripReply).first shouldBe 200
        rate(token, general, generalReply).first shouldBe 200
        feedbackRows(tripReply) shouldBe 1

        // 실제 삭제 경로 — 여행 삭제는 소프트 삭제라 대화는 구독이 지운다(AssistantApiIT 와 같은 길)
        call(HttpMethod.DELETE, "/api/v1/trips/$trip", token).first shouldBe 204
        repeat(3) { relay.relay() } // 배치 상한 대비 — 다른 IT 의 미발행분이 앞에 있을 수 있다

        feedbackRows(tripReply) shouldBe 0
        feedbackRows(generalReply) shouldBe 1
    }

    @Test
    fun `계정 삭제 요청이 대화를 지우면 평가도 사라진다 — 남의 평가는 남는다`() {
        val (leaving, leavingToken) = newAccount()
        val (_, stayingToken) = newAccount()
        val gone = open(leavingToken)["session"]["id"].asText()
        val goneReply = answer(leavingToken, gone)
        val kept = open(stayingToken)["session"]["id"].asText()
        val keptReply = answer(stayingToken, kept)
        rate(leavingToken, gone, goneReply).first shouldBe 200
        rate(stayingToken, kept, keptReply).first shouldBe 200
        feedbackRows(goneReply) shouldBe 1
        val now = Instant.now()
        val event = AccountDeletionRequested(leaving.toString(), UUID.randomUUID().toString(), now + Duration.ofDays(30))

        accountDeletion.handle(EventEnvelope(UUID.randomUUID(), event.eventType, 1, event.aggregateType, event.aggregateId, null, now, "{}"))

        feedbackRows(goneReply) shouldBe 0
        feedbackRows(keptReply) shouldBe 1
    }

    @Test
    fun `보존 청소가 만료된 대화를 지우면 평가도 사라진다 — 살아 있는 대화의 평가는 남는다`() {
        val (_, oldToken) = newAccount()
        val (_, liveToken) = newAccount()
        val old = open(oldToken)["session"]["id"].asText()
        val oldReply = answer(oldToken, old)
        val live = open(liveToken)["session"]["id"].asText()
        val liveReply = answer(liveToken, live)
        rate(oldToken, old, oldReply).first shouldBe 200
        rate(liveToken, live, liveReply).first shouldBe 200
        feedbackRows(oldReply) shouldBe 1
        jdbc.update("UPDATE assistant_session SET expires_at = now() - interval '1 hour' WHERE session_id = ?::uuid", old)

        retention.sweep()

        feedbackRows(oldReply) shouldBe 0
        feedbackRows(liveReply) shouldBe 1
    }
}
