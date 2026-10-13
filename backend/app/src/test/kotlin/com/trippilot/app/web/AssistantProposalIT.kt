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
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * 도우미 제안 E2E(U8 · TRIP-1379) — **실 DB·실 배선·실 일정 경로**로만 드러나는 것을 잰다.
 *
 * 단위 테스트의 대역은 일정을 저장하지 않는다. 제안이 jsonb 로 저장됐다 그대로 읽히는지, [적용]이 정말 기존 편집 경로로
 * 일정을 바꾸는지(리비전까지), 지문이 실제 저장된 일정과 맞물리는지, 상태 전이가 DB 조건으로 지켜지는지는 여기서만 안다.
 * 해석은 꺼 둔 것과 같다 — **버튼만으로** 끝까지 간다(운영 기본값이 버튼 모드다). 일정 쪽 상대는 기본 대역(fake)이다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AssistantProposalIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val json = ObjectMapper()

    private data class Response(val status: Int, val body: JsonNode)

    private fun call(method: HttpMethod, path: String, bearer: String, body: String? = null): Response {
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build().method(method).uri(path).header("Authorization", "Bearer $bearer")
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> }).toEntity(String::class.java)
        return Response(res.statusCode.value(), res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode())
    }

    private fun newToken(): String {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z")))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun press(token: String, session: String, quickReplyId: String) = call(
        HttpMethod.POST, "/api/v1/assistant/sessions/$session/turns", token,
        """{"clientTurnId":"${UUID.randomUUID()}","input":{"type":"ACTION","quickReplyId":"$quickReplyId"},"screen":{"surface":"ITINERARY"}}""",
    )

    private fun apply(token: String, proposalId: String) = call(HttpMethod.POST, "/api/v1/assistant/proposals/$proposalId/apply", token)
    private fun dismiss(token: String, proposalId: String) = call(HttpMethod.POST, "/api/v1/assistant/proposals/$proposalId/dismiss", token)

    private inner class Scene {
        val token = newToken()

        // **오늘 기준 한 달 뒤**의 당일 여행 — 날짜를 박아 두면 그 날이 지나는 순간 "다음 장소"가 없어진다.
        val day: LocalDate = LocalDate.now(ZoneId.of("Asia/Seoul")).plusDays(30)
        val trip: String = call(
            HttpMethod.POST, "/api/v1/trips", token,
            """{"startDate":"$day","endDate":"$day","party":2,"destinations":[{"seq":0,"region":"제주","nights":0}],"preferenceSnapshot":{}}""",
        ).body["tripId"].asText()

        init {
            call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).status shouldBe 201
        }

        val session: String = call(HttpMethod.POST, "/api/v1/assistant/sessions", token, """{"tripId":"$trip"}""").body["session"]["id"].asText()

        fun slotPois(): List<String> = jdbc.queryForList(
            """
            SELECT s.source_poi_id::text FROM visit_slot s JOIN itinerary_day d ON d.itinerary_day_id = s.itinerary_day_id
              JOIN itinerary i ON i.itinerary_id = d.itinerary_id WHERE i.trip_id = ?::uuid ORDER BY d.day_order, s.order_index
            """.trimIndent(),
            String::class.java, trip,
        )

        /** 다음 장소 → 다른 곳 추천 → 후보 카드. */
        fun candidates(): JsonNode {
            val next = press(token, session, "qr-next")
            next.status shouldBe 200
            val alternative = next.body["quickReplies"].first { it["label"].asText() == "다른 곳 추천" }
            return press(token, session, alternative["id"].asText()).body
        }

        /** 후보 하나를 골라 제안을 받는다. */
        fun propose(pick: JsonNode): JsonNode = press(token, session, pick["id"].asText()).body["messages"][1]

        fun messages(): JsonNode = call(HttpMethod.GET, "/api/v1/assistant/sessions/$session/messages", token).body["messages"]
    }

    @Test
    fun `버튼만으로 후보를 고르고 제안을 적용하면 일정이 기존 편집 경로로 바뀐다`() {
        val scene = Scene()
        val before = scene.slotPois()

        val candidates = scene.candidates()
        candidates["messages"][1]["kind"].asText() shouldBe "CANDIDATES"
        val pick = candidates["quickReplies"][0]
        pick["action"].asText() shouldBe "PICK_CANDIDATE"
        // 카드의 후보와 고르는 버튼이 같은 장소를 가리킨다(프론트는 `params.poiId` 로 버튼을 찾는다)
        candidates["messages"][1]["payload"]["candidates"][0]["poiId"].asText() shouldBe pick["params"]["poiId"].asText()

        val card = scene.propose(pick)
        card["kind"].asText() shouldBe "PROPOSAL"
        val proposal = card["proposal"]
        proposal["status"].asText() shouldBe "PROPOSED"
        proposal["violations"].size() shouldBe 0
        proposal["diff"].map { it["change"].asText() } shouldContainExactly listOf("REPLACED")
        proposal["diff"][0]["slotKey"].asText() shouldBe pick["params"]["slotKey"].asText()
        proposal["diff"][0]["after"]["name"].asText() shouldBe pick["label"].asText()
        card.toString().contains("duration") shouldBe false // INV-3
        scene.slotPois() shouldContainExactly before // 제안일 뿐 — 아직 아무것도 바뀌지 않았다(BR-U8-30)

        val applied = apply(scene.token, proposal["id"].asText())

        applied.status shouldBe 200
        applied.body["proposal"]["status"].asText() shouldBe "APPLIED"
        applied.body["messages"][0]["kind"].asText() shouldBe "ACTION_LOG"
        applied.body["messages"][0]["payload"]["tag"].asText() shouldBe "CHANGE"
        // 일정이 정말 바뀌었다 — 그 슬롯만, 고른 장소로
        val replacedPoi = pick["params"]["slotKey"].asText().substringAfter('#')
        scene.slotPois() shouldContainExactly before.map { if (it == replacedPoi) pick["params"]["poiId"].asText() else it }
        // 기존 편집 경로를 탔다는 증거 — 리비전이 남았고 사유에 도우미 접두가 있다(BR-U8-19)
        jdbc.queryForObject(
            "SELECT summary FROM itinerary_revision WHERE trip_id = ?::uuid AND kind = 'EDIT' ORDER BY seq DESC LIMIT 1", String::class.java, scene.trip,
        ) shouldBe "[도우미] ${proposal["diff"][0]["before"]["name"].asText()} → ${pick["label"].asText()}"

        // 다시 열어도 카드는 지금 상태를 그린다 — 제안 카드와 적용 기록 둘 다 APPLIED
        scene.messages().filter { !it["proposal"].isNull }.map { it["kind"].asText() to it["proposal"]["status"].asText() } shouldContainExactly
            listOf("PROPOSAL" to "APPLIED", "ACTION_LOG" to "APPLIED")
        // 한 번만(INV-U8-08) — 다시 눌러도 다시 저장하지 않고 "적용됐다"고만 답한다. 리비전이 하나 더 쌓이지 않는다.
        val editsBefore = jdbc.queryForObject("SELECT count(*) FROM itinerary_revision WHERE trip_id = ?::uuid", Int::class.java, scene.trip)
        apply(scene.token, proposal["id"].asText()).let { Triple(it.status, it.body["proposal"]["status"].asText(), it.body["messages"].size()) } shouldBe
            Triple(200, "APPLIED", 0)
        jdbc.queryForObject("SELECT count(*) FROM itinerary_revision WHERE trip_id = ?::uuid", Int::class.java, scene.trip) shouldBe editsBefore
    }

    /** INV-U8-04 — 같은 일정을 보고 만든 제안 둘 중 하나를 적용하면, 다른 하나는 옛 일정에 맞춘 안이 된다. */
    @Test
    fun `제안을 만든 뒤 일정이 바뀌면 적용은 STALE 로 거절되고 일정을 덮어쓰지 않는다`() {
        val scene = Scene()
        val pick = scene.candidates()["quickReplies"][0]
        val first = scene.propose(pick)["proposal"]["id"].asText()
        val second = scene.propose(pick)["proposal"]["id"].asText()

        apply(scene.token, first).body["proposal"]["status"].asText() shouldBe "APPLIED"
        val afterFirst = scene.slotPois()

        apply(scene.token, second).let { it.status to it.body["error"]["code"].asText() } shouldBe (409 to "STALE")
        scene.slotPois() shouldContainExactly afterFirst
        jdbc.queryForObject("SELECT status FROM assistant_proposal WHERE proposal_id = ?::uuid", String::class.java, second) shouldBe "STALE"
        // 고른 슬롯이 이제 없다 — 옛 버튼을 다시 눌러도 엉뚱한 제안이 생기지 않고 편집 화면으로 간다
        scene.propose(pick).let { it["kind"].asText() to it["nextActions"][0]["type"].asText() } shouldBe ("TEXT" to "OPEN_ITINERARY_EDIT")
    }

    @Test
    fun `취소·만료된 제안은 적용되지 않고 남의 제안은 있는지도 모른다`() {
        val scene = Scene()
        val before = scene.slotPois()
        val pick = scene.candidates()["quickReplies"][0]

        val dismissed = scene.propose(pick)["proposal"]["id"].asText()
        apply(newToken(), dismissed).status shouldBe 404 // 남의 제안
        dismiss(newToken(), dismissed).status shouldBe 404
        dismiss(scene.token, dismissed).let { it.status to it.body["proposal"]["status"].asText() } shouldBe (200 to "DISMISSED")
        dismiss(scene.token, dismissed).body["proposal"]["status"].asText() shouldBe "DISMISSED" // 두 번 눌러도 오류가 아니다
        apply(scene.token, dismissed).let { it.status to it.body["error"]["code"].asText() } shouldBe (409 to "NOT_APPLICABLE")

        val expired = scene.propose(pick)["proposal"]["id"].asText()
        jdbc.update("UPDATE assistant_proposal SET expires_at = now() - interval '1 hour' WHERE proposal_id = ?::uuid", expired)
        // 만료는 읽을 때 드러난다 — 행을 고치는 것은 적용 시도다
        scene.messages().last { !it["proposal"].isNull }["proposal"]["status"].asText() shouldBe "EXPIRED"
        apply(scene.token, expired).let { it.status to it.body["error"]["code"].asText() } shouldBe (409 to "EXPIRED")
        jdbc.queryForObject("SELECT status FROM assistant_proposal WHERE proposal_id = ?::uuid", String::class.java, expired) shouldBe "EXPIRED"

        // 저장이 도는 중인(집힌) 제안 — 취소로 닫히지 않고, 다시 적용되지도 않는다. 닫으면 일정은 바뀌는데 제안은 "취소됨"으로 남는다.
        val claimed = scene.propose(pick)["proposal"]["id"].asText()
        jdbc.update("UPDATE assistant_proposal SET applied_at = now() WHERE proposal_id = ?::uuid", claimed)
        dismiss(scene.token, claimed).body["proposal"]["status"].asText() shouldBe "PROPOSED"
        apply(scene.token, claimed).let { it.status to it.body["error"]["code"].asText() } shouldBe (409 to "NOT_APPLICABLE")
        jdbc.queryForObject("SELECT status FROM assistant_proposal WHERE proposal_id = ?::uuid", String::class.java, claimed) shouldBe "PROPOSED"

        scene.slotPois() shouldContainExactly before
    }
}
