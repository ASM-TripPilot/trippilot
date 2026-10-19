package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.event.OutboxRelay
import com.trippilot.assistant.application.AssistantRetention
import com.trippilot.auth.api.event.AccountDeletionRequested
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.core.io.ClassPathResource
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import org.yaml.snakeyaml.Yaml
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

    /** 계약의 스키마 property 이름 — 빌드가 복사한 classpath 정본을 읽는다(`OpenApiContractIT` 와 같은 원천). */
    private fun contractKeys(schema: String): Set<String> {
        @Suppress("UNCHECKED_CAST")
        val schemas = (Yaml().load<Map<String, Any>>(ClassPathResource("static/openapi.yaml").inputStream)["components"] as Map<String, Any>)["schemas"] as Map<String, Any>
        @Suppress("UNCHECKED_CAST")
        return ((schemas.getValue(schema) as Map<String, Any>)["properties"] as Map<String, Any>).keys
    }

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
