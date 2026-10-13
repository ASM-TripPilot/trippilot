package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/**
 * 도우미 턴 E2E(U8 · TRIP-1378) — **실 DB 와 실 배선으로만 드러나는 것**을 잰다.
 *
 * 단위 테스트의 대역은 잠금이 없고 저장이 Map 이다. 분당 제한이 동시 요청에서도 맞는지(계정 잠금), 턴 id 유니크가
 * 멱등을 받쳐 주는지, jsonb 로 쓴 카드가 그대로 읽히는지, 금칙어 사전·해석 대역이 실제로 물려 있는지는 여기서만 안다.
 * 해석은 기본 대역(`fake` — 낱말 표)으로 돈다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AssistantTurnIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val json = ObjectMapper()

    private data class Response(val status: Int, val body: JsonNode, val retryAfter: String?)

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Response {
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build().method(method).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> }).toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return Response(res.statusCode.value(), parsed, res.headers.getFirst("Retry-After"))
    }

    private fun newAccount(): Pair<UUID, String> {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z")))
        return account.id.value to accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun newTrip(token: String): String {
        val body = """{"startDate":"2026-11-01","endDate":"2026-11-03","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":2}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).body["tripId"].asText()
    }

    private fun open(token: String, tripId: String? = null): String =
        call(HttpMethod.POST, "/api/v1/assistant/sessions", token, """{"tripId":${tripId?.let { "\"$it\"" } ?: "null"}}""").body["session"]["id"].asText()

    private fun say(token: String, session: String, text: String, turn: UUID = UUID.randomUUID()) = call(
        HttpMethod.POST, "/api/v1/assistant/sessions/$session/turns", token,
        """{"clientTurnId":"$turn","input":{"type":"TEXT","text":"$text"},"screen":{"surface":"ITINERARY"}}""",
    )

    private fun press(token: String, session: String, quickReplyId: String) = call(
        HttpMethod.POST, "/api/v1/assistant/sessions/$session/turns", token,
        """{"clientTurnId":"${UUID.randomUUID()}","input":{"type":"ACTION","quickReplyId":"$quickReplyId"},"screen":{"surface":"HOME"}}""",
    )

    private fun count(sql: String, vararg args: Any): Int = jdbc.queryForObject(sql, Int::class.java, *args)!!

    @Test
    fun `말을 보내면 사용자·도우미 메시지가 저장되고 다시 열면 이어진다`() {
        val (accountId, token) = newAccount()
        val session = open(token, newTrip(token))

        val turn = say(token, session, "오늘 날씨 어때")

        turn.status shouldBe 200
        turn.body["messages"].map { it["role"].asText() } shouldContainExactly listOf("USER", "ASSISTANT")
        turn.body["messages"][0]["text"].asText() shouldBe "오늘 날씨 어때"
        turn.body["messages"][0]["quickReplies"].isNull shouldBe true
        turn.body["messages"][1]["nextActions"][0]["type"].asText() shouldBe "OPEN_ITINERARY"
        turn.body["quickReplies"].map { it["id"].asText() } shouldContainExactly listOf("qr-review", "qr-next", "qr-weather", "qr-capabilities")

        // 관측 칸·맥락·사용량이 실제 칸에 들어갔다
        jdbc.queryForMap("SELECT intent, match_route, outcome, llm_calls FROM assistant_message WHERE session_id = ?::uuid AND role = 'ASSISTANT'", session)
            .let { listOf(it["intent"], it["match_route"], it["outcome"], it["llm_calls"]) shouldContainExactly listOf("GET_WEATHER", "CONFIDENT", "FRAME", 0) }
        count("SELECT (dialogue_context->>'turn_index')::int FROM assistant_session WHERE session_id = ?::uuid", session) shouldBe 1
        count("SELECT turns FROM assistant_usage_daily WHERE account_id = ?", accountId) shouldBe 1

        val reopened = call(HttpMethod.POST, "/api/v1/assistant/sessions", token, """{"tripId":null}""") // 다른 대화는 비어 있다
        reopened.body["messages"].size() shouldBe 0
        call(HttpMethod.GET, "/api/v1/assistant/sessions/$session/messages", token).body["messages"].map { it["id"].asText() } shouldContainExactly
            turn.body["messages"].map { it["id"].asText() }
    }

    /** INV-U8-05 — 앱은 응답을 못 받으면 같은 턴 id 로 다시 보낸다. 두 번 만들면 대화가 겹치고 사용량이 두 번 센다. */
    @Test
    fun `같은 턴 id 로 다시 보내면 처음 응답을 그대로 받는다`() {
        val (accountId, token) = newAccount()
        val session = open(token)
        val turn = UUID.randomUUID()

        val first = say(token, session, "스타일 분석해줘", turn)
        val again = say(token, session, "스타일 분석해줘", turn)

        again.status shouldBe 200
        again.body shouldBe first.body
        count("SELECT count(*) FROM assistant_message WHERE session_id = ?::uuid", session) shouldBe 2
        count("SELECT turns FROM assistant_usage_daily WHERE account_id = ?", accountId) shouldBe 1

        // 그 뒤에 다른 턴이 쌓여도, 옛 턴의 재전송은 **그 턴의 응답만** 돌려준다 — 뒤 턴의 답이 딸려 오지 않는다
        say(token, session, "오늘 날씨")
        say(token, session, "스타일 분석해줘", turn).body shouldBe first.body
    }

    /** 연달아 누르면 "다시 시도"라는 말을 해석하게 된다 — 그 행들을 건너뛰고 원래 말을 다시 태운다. */
    @Test
    fun `다시 시도를 연달아 눌러도 원래 말을 다시 태운다`() {
        val (accountId, token) = newAccount()
        val session = open(token, newTrip(token))
        say(token, session, "오늘 날씨 어때")
        jdbc.update(
            """
            INSERT INTO assistant_message (message_id, session_id, account_id, role, kind, text, next_actions, quick_replies, created_at)
            VALUES (?, ?::uuid, ?, 'ASSISTANT', 'FALLBACK', '지금 도우미가 응답하지 못했어요.',
                    '[{"type":"RETRY_TURN","label":"다시 시도","params":{}}]'::jsonb,
                    '[{"id":"qr-retry","label":"다시 시도","action":"RETRY","params":{}}]'::jsonb, now())
            """.trimIndent(),
            UUID.randomUUID(), session, accountId,
        )

        val once = press(token, session, "qr-retry")
        val twice = press(token, session, "qr-retry")

        // 낱말 표 대역은 "날씨"를 알아듣고 "다시 시도"는 모른다(범위 밖) — 두 번 다 날씨로 답해야 한다
        listOf(once, twice).forEach { it.body["messages"][1]["nextActions"][0]["type"].asText() shouldBe "OPEN_ITINERARY" }
        count("SELECT count(*) FROM assistant_message WHERE session_id = ?::uuid AND role = 'USER' AND intent = 'RETRY'", session) shouldBe 2
    }

    /**
     * SEC-U8-01 · PBT-U8-4 보강 — 파드가 여럿이면 동시 요청이 각자 "19건"을 보고 둘 다 통과한다. 계정 잠금이 줄을 세운다.
     * (동시 요청 수는 풀 크기보다 작게 둔다 — `AssistantApiIT` 의 동시 열기와 같은 이유, TRIP-1387.)
     */
    @Test
    fun `분당 제한은 동시 요청에서도 정확하다 — 스무 번째만 받고 나머지는 429 다`() {
        val (accountId, token) = newAccount()
        val session = open(token)
        repeat(19) {
            jdbc.update(
                "INSERT INTO assistant_message (message_id, session_id, account_id, client_turn_id, role, kind, text, created_at) VALUES (?, ?::uuid, ?, ?, 'USER', 'TEXT', '앞선 말', now())",
                UUID.randomUUID(), session, accountId, UUID.randomUUID(),
            )
        }

        val results = Executors.newFixedThreadPool(3).use { pool ->
            pool.invokeAll(List(3) { Callable { say(token, session, "오늘 날씨") } }).map { it.get() }
        }

        results.map { it.status }.sorted() shouldContainExactly listOf(200, 429, 429)
        val limited = results.first { it.status == 429 }
        limited.body["error"]["code"].asText() shouldBe "RATE_LIMITED"
        ((limited.retryAfter!!.toInt()) in 1..60) shouldBe true
        // 거절된 턴은 기록되지 않는다(BR-U8-24)
        count("SELECT count(*) FROM assistant_message WHERE account_id = ? AND role = 'USER'", accountId) shouldBe 20
    }

    /** 이력을 지우면 분당 창의 행도 지워진다 — 그래도 **하루 사용량은 남는다**(COST-U8-01). */
    @Test
    fun `대화를 지워도 하루 사용량은 줄지 않는다`() {
        val (accountId, token) = newAccount()
        val session = open(token)
        say(token, session, "오늘 날씨")
        say(token, session, "스타일 분석")

        call(HttpMethod.DELETE, "/api/v1/assistant/sessions/$session", token).status shouldBe 204

        count("SELECT turns FROM assistant_usage_daily WHERE account_id = ?", accountId) shouldBe 2
    }

    /** BR-U8-23 — 실 사전으로: 걸러진 원문은 DB 에 없다. */
    @Test
    fun `금칙어가 든 말은 거절되고 원문이 DB 에 남지 않는다`() {
        val (_, token) = newAccount()
        val session = open(token)

        val turn = say(token, session, "비속어예시1 알려줘") // 시드 금칙어

        turn.status shouldBe 200
        turn.body["messages"][0]["text"].isNull shouldBe true
        turn.body["messages"][1]["kind"].asText() shouldBe "REFUSAL"
        count("SELECT count(*) FROM assistant_message WHERE session_id = ?::uuid AND text LIKE '%비속어예시1%'", session) shouldBe 0
        count("SELECT count(*) FROM assistant_message WHERE session_id = ?::uuid AND role = 'USER' AND redacted", session) shouldBe 1
        count("SELECT refusal_streak FROM assistant_session WHERE session_id = ?::uuid", session) shouldBe 1
    }

    @Test
    fun `빠른 답은 서버가 발급한 것만 받는다 — 시작 빠른 답과 메시지가 낸 빠른 답`() {
        val (accountId, token) = newAccount()
        val session = open(token)

        press(token, session, "qr-capabilities").status shouldBe 200
        press(token, session, "qr-made-up").status shouldBe 400

        // 도우미 메시지가 발급한 빠른 답 — jsonb 포함 조회로 찾는다
        jdbc.update(
            """
            INSERT INTO assistant_message (message_id, session_id, account_id, role, kind, text, next_actions, quick_replies, created_at)
            VALUES (?, ?::uuid, ?, 'ASSISTANT', 'FALLBACK', '지금 도우미가 응답하지 못했어요.',
                    '[{"type":"RETRY_TURN","label":"다시 시도","params":{}}]'::jsonb,
                    '[{"id":"qr-issued-once","label":"다시 시도","action":"RETRY","params":{}}]'::jsonb, now())
            """.trimIndent(),
            UUID.randomUUID(), session, accountId,
        )
        val retried = press(token, session, "qr-issued-once")
        retried.status shouldBe 200
        // 다시 태울 말은 직전의 사용자 발화다 — 앞서 누른 "내가 할 수 있는 것 보기"가 해석으로 갔다(범위 밖)
        retried.body["messages"][1]["kind"].asText() shouldBe "SCOPE"
    }

    @Test
    fun `잘못된 요청은 400, 남의 대화는 404, 인증 없으면 401`() {
        val (_, owner) = newAccount()
        val (_, stranger) = newAccount()
        val session = open(owner)

        say(stranger, session, "오늘 날씨").status shouldBe 404
        say(owner, session, "").status shouldBe 400
        say(owner, session, "가".repeat(501)).status shouldBe 400
        call(HttpMethod.POST, "/api/v1/assistant/sessions/$session/turns", owner, """{"input":{"type":"TEXT","text":"안녕"},"screen":{"surface":"HOME"}}""").status shouldBe 400
        call(HttpMethod.POST, "/api/v1/assistant/sessions/$session/turns", owner,
            """{"clientTurnId":"${UUID.randomUUID()}","input":{"type":"TEXT","text":"안녕"},"screen":{"surface":"MOON"}}""").status shouldBe 400
        call(HttpMethod.POST, "/api/v1/assistant/sessions/$session/turns", owner,
            """{"clientTurnId":"${UUID.randomUUID()}","input":{"type":"ACTION"},"screen":{"surface":"HOME"}}""").status shouldBe 400
        say(null.toString(), session, "안녕").status shouldBe 401
        count("SELECT count(*) FROM assistant_message WHERE session_id = ?::uuid", session) shouldBe 0
    }
}
