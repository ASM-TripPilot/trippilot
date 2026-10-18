package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.assistant.domain.AssistantUsageRepository
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
import java.time.LocalDate
import java.time.ZoneId
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
    @Autowired private lateinit var usage: AssistantUsageRepository

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

    /**
     * 상대가 답까지 완성한 턴(`ANSWER`, assistant-orchestrator 1단계) — 대역의 인사말이 그 모양이다. jsonb 로 쓴 카드와
     * 서버가 발급한 빠른 답(`qr-ai-*`)이 실 DB 제약(다음 행동 ≥1·kind CHECK)을 지나 그대로 돌아오고, 누르면 다음 턴이 되는지.
     */
    @Test
    fun `완성된 답(ANSWER)은 그대로 저장되고 발급한 빠른 답을 누르면 다음 턴이 된다`() {
        val (_, token) = newAccount()
        val session = open(token, newTrip(token))

        val turn = say(token, session, "안녕")

        turn.status shouldBe 200
        turn.body["messages"][1]["kind"].asText() shouldBe "TEXT"
        turn.body["messages"][1]["nextActions"][0]["type"].asText() shouldBe "SHOW_CAPABILITIES"
        val issued = turn.body["quickReplies"].single()
        issued["id"].asText().startsWith("qr-ai-") shouldBe true
        // 프레임 없는 답 — intent 는 비고 match_route 는 NONE(OBS-U8-01 어휘)
        jdbc.queryForMap("SELECT intent, match_route, outcome, llm_calls FROM assistant_message WHERE session_id = ?::uuid AND role = 'ASSISTANT'", session)
            .let { listOf(it["intent"], it["match_route"], it["outcome"], it["llm_calls"]) shouldContainExactly listOf(null, "NONE", "ANSWER", 0) }

        // 발급된 빠른 답은 jsonb 포함 조회로 찾아 받는다 — 라벨("오늘 날씨")이 다음 턴의 말이 되어 해석으로 간다
        val pressed = press(token, session, issued["id"].asText())
        pressed.status shouldBe 200
        pressed.body["messages"][0]["text"].asText() shouldBe "오늘 날씨"
        pressed.body["messages"][1]["nextActions"][0]["type"].asText() shouldBe "OPEN_ITINERARY"
    }

    /**
     * 진행 검토가 **실제 일정**을 읽는다 — 일정 생성 API 로 만든 일정, 실 퍼사드, jsonb 로 저장된 카드.
     * 카드의 값은 저장된 사실이고, 각주까지 다시 열었을 때 그대로 읽힌다.
     */
    @Test
    fun `진행 검토 카드가 실제 여행·일정으로 채워지고 저장된 그대로 다시 읽힌다`() {
        val (_, token) = newAccount()
        // **오늘 기준 한 달 뒤**로 잡는다 — 날짜를 박아 두면 그 날이 오는 순간 "다음 장소"의 답이 바뀌어 테스트가 깨진다.
        val day = LocalDate.now(ZoneId.of("Asia/Seoul")).plusDays(30)
        val trip = call(
            HttpMethod.POST, "/api/v1/trips", token,
            """{"startDate":"$day","endDate":"$day","party":2,"destinations":[{"seq":0,"region":"제주","nights":0}],"preferenceSnapshot":{}}""",
        ).body["tripId"].asText()
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).status shouldBe 201
        val session = open(token, trip)

        val review = press(token, session, "qr-review").body["messages"][1]

        review["kind"].asText() shouldBe "REVIEW"
        val summary = review["payload"]["summary"].map { it["label"].asText() to it["value"].asText() }
        summary.take(2) shouldContainExactly listOf("여행" to "제주 당일", "숙소" to "미등록")
        // 생성이 끝났든 아직 도는 중이든 첫 날은 채워져 있다
        (summary[2].second in setOf("1일 중 1일 채움", "만드는 중 (1일 중 1일 채움)")) shouldBe true
        review["payload"]["problems"].size() shouldBe 0 // 당일 여행 — 숙소가 없는 것은 문제가 아니다
        review["footnote"].asText() shouldBe "* 시간·이동 검증은 일정 솔버 기준"
        review["nextActions"][0]["type"].asText() shouldBe "OPEN_ITINERARY"

        // 다음 장소도 그 일정에서 — 여행은 한참 뒤라 첫 슬롯이다(날짜가 함께 온다)
        val next = press(token, session, "qr-next").body["messages"][1]
        next["kind"].asText() shouldBe "INFO"
        next["payload"]["infoKind"].asText() shouldBe "NEXT_SLOT"
        next["payload"]["rows"].map { it["label"].asText() }.take(2) shouldContainExactly listOf("날짜", "계획 시각")

        val reread = call(HttpMethod.GET, "/api/v1/assistant/sessions/$session/messages", token).body["messages"]
        reread.first { it["kind"].asText() == "REVIEW" } shouldBe review
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

    /**
     * 같은 턴 id 가 **동시에** 들어온다(앱의 재전송이 첫 요청과 겹친다). 계정 잠금이 멱등 확인보다 앞에 있어야 뒤쪽이
     * 앞쪽의 사용자 행을 본다 — 아니면 둘 다 넣으려다 하나가 유니크 위반(500)이다. 뒤쪽은 다시 처리하지 않고 기다린다.
     */
    @Test
    fun `같은 턴 id 가 동시에 와도 전부 200 이고 메시지는 한 쌍, 사용량은 한 번이다`() {
        val (accountId, token) = newAccount()
        val session = open(token)
        val turn = UUID.randomUUID()

        val results = Executors.newFixedThreadPool(3).use { pool ->
            pool.invokeAll(List(3) { Callable { say(token, session, "스타일 분석해줘", turn) } }).map { it.get() }
        }

        results.map { it.status } shouldContainExactly listOf(200, 200, 200)
        results.map { it.body }.distinct().size shouldBe 1
        count("SELECT count(*) FROM assistant_message WHERE session_id = ?::uuid AND role = 'USER'", session) shouldBe 1
        count("SELECT count(*) FROM assistant_message WHERE session_id = ?::uuid AND role = 'ASSISTANT'", session) shouldBe 1
        count("SELECT turns FROM assistant_usage_daily WHERE account_id = ?", accountId) shouldBe 1
    }

    /** 응답은 그 턴을 가리킨다(`reply_to`) — 실 DB 로: 뒤 턴의 사용자 행 뒤에 적힌 앞 턴의 답도 앞 턴의 것이다. */
    @Test
    fun `늦게 적힌 응답도 자기 턴에 붙는다`() {
        val (accountId, token) = newAccount()
        val session = open(token)
        val (a, b) = UUID.randomUUID() to UUID.randomUUID()
        // A 의 사용자 행만 먼저(처리 중), 그 사이 B 가 끝까지 갔다
        jdbc.update(
            "INSERT INTO assistant_message (message_id, session_id, account_id, client_turn_id, role, kind, text, created_at) VALUES (?, ?::uuid, ?, ?, 'USER', 'TEXT', '오늘 날씨', now() - interval '1 minute')",
            UUID.randomUUID(), session, accountId, a,
        )
        val second = say(token, session, "스타일 분석해줘", b)

        val first = say(token, session, "오늘 날씨", a) // A 를 넘겨받아 끝낸다 — 응답은 B 의 것들 뒤에 적힌다

        first.body["messages"].map { it["text"].asText() } shouldContainExactly listOf("오늘 날씨", "먼저 여행을 만들거나 숙소를 등록하면 일정을 함께 볼 수 있어요.")
        say(token, session, "오늘 날씨", a).body shouldBe first.body
        say(token, session, "스타일 분석해줘", b).body shouldBe second.body
        count("SELECT count(*) FROM assistant_message WHERE session_id = ?::uuid", session) shouldBe 4
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

    /** 겹쳐 처리된 같은 턴이 LLM 을 한 번 더 썼을 때의 기록 — 턴 수는 그대로, LLM 턴만 는다(실 SQL 로). */
    @Test
    fun `사용량은 턴과 LLM 턴을 따로 센다`() {
        val (accountId, _) = newAccount()
        val day = LocalDate.parse("2026-10-14")

        usage.record(accountId, day, llm = false)
        usage.record(accountId, day, llm = true)
        usage.record(accountId, day, llm = true, turn = false)

        jdbc.queryForMap("SELECT turns, llm_turns FROM assistant_usage_daily WHERE account_id = ?", accountId)
            .let { listOf(it["turns"], it["llm_turns"]) shouldContainExactly listOf(2, 2) }
        usage.llmTurns(accountId, day) shouldBe 2
        usage.llmTurns(accountId, day.plusDays(1)) shouldBe 0
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
        // 다시 태울 **말**이 없다(앞선 것은 버튼뿐) — 버튼 문구를 말로 해석하지 않고 할 수 있는 것을 보인다
        retried.body["messages"][1]["kind"].asText() shouldBe "TEXT"
        retried.body["quickReplies"].map { it["id"].asText() } shouldContainExactly listOf("qr-new-trip", "qr-stay", "qr-capabilities")
    }

    @Test
    fun `잘못된 요청은 400, 남의 대화는 404, 인증 없으면 401`() {
        val (_, owner) = newAccount()
        val (_, stranger) = newAccount()
        val session = open(owner)

        say(stranger, session, "오늘 날씨").status shouldBe 404
        say(owner, session, "").status shouldBe 400
        say(owner, session, "가".repeat(501)).status shouldBe 400
        say(owner, session, "널\\u0000문자").status shouldBe 400 // DB 가 받지 않는 문자 — 저장에서 500 이 나기 전에
        call(HttpMethod.POST, "/api/v1/assistant/sessions/$session/turns", owner, """{"input":{"type":"TEXT","text":"안녕"},"screen":{"surface":"HOME"}}""").status shouldBe 400
        call(HttpMethod.POST, "/api/v1/assistant/sessions/$session/turns", owner,
            """{"clientTurnId":"${UUID.randomUUID()}","input":{"type":"TEXT","text":"안녕"},"screen":{"surface":"MOON"}}""").status shouldBe 400
        call(HttpMethod.POST, "/api/v1/assistant/sessions/$session/turns", owner,
            """{"clientTurnId":"${UUID.randomUUID()}","input":{"type":"ACTION"},"screen":{"surface":"HOME"}}""").status shouldBe 400
        say(null.toString(), session, "안녕").status shouldBe 401
        count("SELECT count(*) FROM assistant_message WHERE session_id = ?::uuid", session) shouldBe 0
    }
}
