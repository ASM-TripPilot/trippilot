package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/**
 * 도우미 세션 E2E(U8 · TRIP-1377) — **실 DB 로만 드러나는 것**을 잰다.
 *
 * 단위 테스트의 대역은 Map 이라 "여행당 대화 하나"를 원리적으로 지킨다. 실제로 그것을 지키는 것은 부분 유니크
 * 인덱스와 `ON CONFLICT` 이고, 둘이 어긋나면 앱을 두 번 여는 순간 대화가 둘로 쪼개지거나 500 이 난다.
 * 메시지·제안의 CASCADE, 도우미 메시지의 다음 행동 CHECK 도 여기서만 확인된다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AssistantApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private companion object {
        const val CONCURRENT_OPENS = 3
    }

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-08-01T00:00:00Z")

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build().method(method).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun newAccount(): Pair<UUID, String> {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return account.id.value to accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun newTrip(token: String): String {
        val body = """{"startDate":"2026-11-01","endDate":"2026-11-03","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":2}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun open(token: String, tripId: String?): Pair<Int, JsonNode> =
        call(HttpMethod.POST, "/api/v1/assistant/sessions", token, """{"tripId":${tripId?.let { "\"$it\"" } ?: "null"}}""")

    /** 턴 처리가 아직 없어(TRIP-1378) 메시지는 직접 넣는다 — 읽기 경로와 DB 제약만 본다. */
    private fun insertMessage(sessionId: String, accountId: UUID, role: String, text: String, nextActions: String = "[]"): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO assistant_message (message_id, session_id, account_id, role, kind, text, next_actions, quick_replies, created_at)
            VALUES (?, ?::uuid, ?, ?, 'TEXT', ?, ?::jsonb, '[{"id":"qr-retry","label":"다시 시도","action":"RETRY","params":{}}]'::jsonb, now())
            """.trimIndent(),
            id, sessionId, accountId, role, text, nextActions,
        )
        return id
    }

    private fun count(table: String, sessionId: String): Int =
        jdbc.queryForObject("SELECT count(*) FROM $table WHERE session_id = ?::uuid", Int::class.java, sessionId)!!

    @Test
    fun `인증 없으면 전부 401`() {
        val id = UUID.randomUUID()
        call(HttpMethod.POST, "/api/v1/assistant/sessions", null, """{"tripId":null}""").first shouldBe 401
        call(HttpMethod.GET, "/api/v1/assistant/sessions", null).first shouldBe 401
        call(HttpMethod.GET, "/api/v1/assistant/sessions/$id/messages", null).first shouldBe 401
        call(HttpMethod.DELETE, "/api/v1/assistant/sessions/$id", null).first shouldBe 401
        call(HttpMethod.POST, "/api/v1/assistant/sessions/$id/turns", null, "{}").first shouldBe 401
        call(HttpMethod.POST, "/api/v1/assistant/proposals/$id/apply", null).first shouldBe 401
    }

    @Test
    fun `여행 대화를 열면 칩과 서버 발급 빠른 답이 오고 다시 열면 같은 대화다`() {
        val (_, token) = newAccount()
        val trip = newTrip(token)

        val (status, first) = open(token, trip)

        status shouldBe 200
        first["session"]["tripId"].asText() shouldBe trip
        first["session"]["contextChip"].asText() shouldBe "제주 2박 3일" // 등록 숙소가 없다 — 없는 것을 말하지 않는다
        first["messages"].size() shouldBe 0
        first["quickReplies"].map { it["id"].asText() } shouldContainExactly listOf("qr-review", "qr-next", "qr-weather", "qr-capabilities")
        first["quickReplies"][0]["action"].asText() shouldBe "REVIEW"

        open(token, trip).second["session"]["id"].asText() shouldBe first["session"]["id"].asText()
        // 일반 대화는 여행 대화와 따로 하나다(INV-U8-01)
        val general = open(token, null).second
        general["session"]["id"].asText() shouldNotBe first["session"]["id"].asText()
        general["session"]["contextChip"].isNull shouldBe true
        open(token, null).second["session"]["id"].asText() shouldBe general["session"]["id"].asText()
    }

    @Test
    fun `남의 여행으로는 열 수 없고(404) 세션도 생기지 않는다`() {
        val (_, owner) = newAccount()
        val (strangerId, stranger) = newAccount()
        val trip = newTrip(owner)

        open(stranger, trip).first shouldBe 404
        open(stranger, UUID.randomUUID().toString()).first shouldBe 404

        jdbc.queryForObject("SELECT count(*) FROM assistant_session WHERE account_id = ?", Int::class.java, strangerId) shouldBe 0
    }

    /**
     * 앱을 두 번 연 요청이 동시에 온다. 선검사 후 삽입이면 둘 다 통과해 대화가 둘이 되거나 유니크 위반으로 500 이다.
     */
    @Test
    fun `동시에 열어도 대화는 하나고 전부 200 이다`() {
        val (accountId, token) = newAccount()
        val trip = newTrip(token)

        // **셋이다 — 풀 크기(4)보다 작아야 한다.** 테스트 컨텍스트는 open-in-view 가 켜져 있어(테스트용 application.yml 이
        // 본 설정을 가린다) 요청 하나가 JPA 연결을 쥔 채 JdbcTemplate 용 연결을 하나 더 집는다. 동시 요청이 풀 크기
        // 이상이면 전부 첫 연결을 쥐고 두 번째를 기다리다 말라붙는다(실측: 8개로 돌려 전원 500). 운영은
        // open-in-view=false 라 요청당 연결이 하나다 — 그 설정으로는 8개도 통과함을 확인했다.
        val results = Executors.newFixedThreadPool(CONCURRENT_OPENS).use { pool ->
            pool.invokeAll(List(CONCURRENT_OPENS) { Callable { open(token, trip) } }).map { it.get() }
        }

        results.map { it.first }.distinct() shouldContainExactly listOf(200)
        results.map { it.second["session"]["id"].asText() }.distinct().size shouldBe 1
        jdbc.queryForObject("SELECT count(*) FROM assistant_session WHERE account_id = ?", Int::class.java, accountId) shouldBe 1
    }

    @Test
    fun `메시지는 대화 순서로 쪽을 나눠 읽고 저장된 카드 값이 그대로 나간다`() {
        val (accountId, token) = newAccount()
        val session = open(token, null).second["session"]["id"].asText()
        val next = """[{"type":"SHOW_CAPABILITIES","label":"내가 할 수 있는 것 보기","params":{}}]"""
        val ids = (1..5).map { i ->
            if (i % 2 == 1) insertMessage(session, accountId, "USER", "말 $i") else insertMessage(session, accountId, "ASSISTANT", "답 $i", next)
        }

        val (status, latest) = call(HttpMethod.GET, "/api/v1/assistant/sessions/$session/messages?limit=2", token)
        status shouldBe 200
        latest["messages"].map { it["id"].asText() } shouldContainExactly ids.takeLast(2).map { it.toString() }
        val assistant = latest["messages"][0]
        assistant["role"].asText() shouldBe "ASSISTANT"
        assistant["nextActions"][0]["type"].asText() shouldBe "SHOW_CAPABILITIES"
        assistant["quickReplies"][0]["action"].asText() shouldBe "RETRY"
        assistant["proposal"].isNull shouldBe true

        val older = call(HttpMethod.GET, "/api/v1/assistant/sessions/$session/messages?limit=3&before=${latest["nextBefore"].asText()}", token).second
        older["messages"].map { it["id"].asText() } shouldContainExactly ids.take(3).map { it.toString() }
        older["nextBefore"].isNull shouldBe true

        // 다시 열면 지난 대화가 함께 온다(이어 열기)
        open(token, null).second["messages"].size() shouldBe 5
        call(HttpMethod.GET, "/api/v1/assistant/sessions/$session/messages?limit=0", token).first shouldBe 400
        call(HttpMethod.GET, "/api/v1/assistant/sessions/$session/messages?before=x", token).first shouldBe 400
    }

    @Test
    fun `남의 대화는 읽을 수도 지울 수도 없다 — 읽기는 404, 지우기는 조용히 아무 일도 없다`() {
        val (ownerId, owner) = newAccount()
        val (_, stranger) = newAccount()
        val session = open(owner, null).second["session"]["id"].asText()
        insertMessage(session, ownerId, "USER", "내 말")

        call(HttpMethod.GET, "/api/v1/assistant/sessions/$session/messages", stranger).first shouldBe 404
        call(HttpMethod.DELETE, "/api/v1/assistant/sessions/$session", stranger).first shouldBe 204
        count("assistant_message", session) shouldBe 1

        call(HttpMethod.GET, "/api/v1/assistant/sessions", stranger).second.size() shouldBe 0
    }

    @Test
    fun `대화를 지우면 메시지와 제안이 함께 지워지고 다시 지워도 204 다 — 사용량은 남는다`() {
        val (accountId, token) = newAccount()
        val trip = newTrip(token)
        val session = open(token, trip).second["session"]["id"].asText()
        insertMessage(session, accountId, "USER", "말")
        jdbc.update(
            """
            INSERT INTO assistant_proposal (proposal_id, session_id, account_id, trip_id, kind, base_fingerprint, after, diff, status, expires_at, created_at)
            VALUES (?, ?::uuid, ?, ?::uuid, 'EDIT', 'fp', '{}'::jsonb, '[]'::jsonb, 'PROPOSED', now(), now())
            """.trimIndent(),
            UUID.randomUUID(), session, accountId, trip,
        )
        jdbc.update("INSERT INTO assistant_usage_daily (account_id, day, turns, llm_turns) VALUES (?, current_date, 3, 1)", accountId)

        call(HttpMethod.GET, "/api/v1/assistant/sessions", token).second.map { it["id"].asText() } shouldContainExactly listOf(session)
        call(HttpMethod.DELETE, "/api/v1/assistant/sessions/$session", token).first shouldBe 204
        call(HttpMethod.DELETE, "/api/v1/assistant/sessions/$session", token).first shouldBe 204

        count("assistant_message", session) shouldBe 0
        count("assistant_proposal", session) shouldBe 0
        call(HttpMethod.GET, "/api/v1/assistant/sessions", token).second.size() shouldBe 0
        // 이력을 지워도 사용량은 줄지 않는다(COST-U8-01) — 줄면 지우기가 상한 우회 수단이 된다
        jdbc.queryForObject("SELECT turns FROM assistant_usage_daily WHERE account_id = ?", Int::class.java, accountId) shouldBe 3
        // 지운 뒤 다시 열면 새 대화다
        open(token, trip).second["session"]["id"].asText() shouldNotBe session
    }

    @Test
    fun `목록은 여행 제목을 붙이고 여행을 지우면 그 대화도 사라진다`() {
        val (_, token) = newAccount()
        val trip = newTrip(token)
        val tripSession = open(token, trip).second["session"]["id"].asText()
        val general = open(token, null).second["session"]["id"].asText()

        val listed = call(HttpMethod.GET, "/api/v1/assistant/sessions", token).second
        listed.map { it["id"].asText() }.toSet() shouldBe setOf(tripSession, general)
        listed.single { it["id"].asText() == tripSession }["tripTitle"].isNull shouldBe false
        listed.single { it["id"].asText() == general }["tripTitle"].isNull shouldBe true

        // 여행 행이 사라지면(물리 삭제) 대화도 함께 간다 — 남의 여행이 된 대화가 남지 않는다
        jdbc.update("DELETE FROM trip WHERE trip_id = ?::uuid", trip)
        call(HttpMethod.GET, "/api/v1/assistant/sessions", token).second.map { it["id"].asText() } shouldContainExactly listOf(general)
    }

    /** 청소 배치가 아직 안 돈 만료 대화 — 목록에 안 나오고, 열면 지난 발화 없이 새 대화다(DATA-U8-01). */
    @Test
    fun `보존 기간이 지난 대화는 목록에 없고 열면 새로 시작한다`() {
        val (accountId, token) = newAccount()
        val old = open(token, null).second["session"]["id"].asText()
        insertMessage(old, accountId, "USER", "오래된 말")
        jdbc.update("UPDATE assistant_session SET expires_at = now() - interval '1 second' WHERE session_id = ?::uuid", old)

        call(HttpMethod.GET, "/api/v1/assistant/sessions", token).second.size() shouldBe 0
        val reopened = open(token, null).second
        reopened["session"]["id"].asText() shouldNotBe old
        reopened["messages"].size() shouldBe 0
        count("assistant_message", old) shouldBe 0
    }

    /** INV-U8-03 — 도우미 응답이 다음 행동 없이 저장되는 길을 DB 가 막는다. 턴 처리의 버그가 dead-end 로 새지 않게. */
    @Test
    fun `DB 가 다음 행동 없는 도우미 메시지와 같은 턴 id 의 두 번째 행을 거부한다`() {
        val (accountId, token) = newAccount()
        val session = open(token, null).second["session"]["id"].asText()

        shouldThrow<DataIntegrityViolationException> { insertMessage(session, accountId, "ASSISTANT", "막다른 길") }
        insertMessage(session, accountId, "USER", "사용자 행은 다음 행동이 없어도 된다")

        val turn = UUID.randomUUID()
        val insertTurn = {
            jdbc.update(
                "INSERT INTO assistant_message (message_id, session_id, account_id, client_turn_id, role, kind, text, created_at) VALUES (?, ?::uuid, ?, ?, 'USER', 'TEXT', '같은 턴', now())",
                UUID.randomUUID(), session, accountId, turn,
            )
        }
        insertTurn()
        shouldThrow<DataIntegrityViolationException> { insertTurn() } // 멱등 키(INV-U8-05)
    }

    @Test
    fun `턴과 제안은 계약만 열려 있다 — 채워질 때까지 501`() {
        val (_, token) = newAccount()
        val id = UUID.randomUUID()

        call(HttpMethod.POST, "/api/v1/assistant/sessions/$id/turns", token, "{}").first shouldBe 501
        call(HttpMethod.POST, "/api/v1/assistant/proposals/$id/apply", token).first shouldBe 501
        call(HttpMethod.POST, "/api/v1/assistant/proposals/$id/dismiss", token).first shouldBe 501
    }
}
