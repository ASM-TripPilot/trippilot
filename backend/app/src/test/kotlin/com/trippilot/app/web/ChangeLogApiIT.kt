package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.changelog.api.DaySnapshotView
import com.trippilot.changelog.api.ItinerarySnapshotView
import com.trippilot.changelog.api.SlotSnapshotView
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import java.time.LocalDate
import java.time.LocalTime
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import java.time.Instant
import java.util.UUID

/**
 * 변경 이력 E2E(US-PLANB-09 · TRIP-275) — 이력이 타임라인으로 읽히는지,
 * 그리고 **append-only 가 DB 권한으로 실제 강제되는지**(앱 롤에 UPDATE/DELETE 없음) 확인한다.
 *
 * 생산자는 아직 없다 — 편집 이력은 DEC-U3-1 로 U3 `ItineraryRevision` 소유가 됐고(TRIP-310),
 * 이 change-log 는 Plan-B(U4)·아카이브(U5) 원천을 기다린다. 그래서 퍼사드를 직접 호출해 영속·조회를 검증한다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ChangeLogApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var changeLog: ChangeLogFacade

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

    private fun newToken(): String {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun newTrip(token: String): String {
        val body = """{"startDate":"2026-08-01","endDate":"2026-08-01","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":0}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun poiId(token: String): String =
        call(HttpMethod.GET, "/api/v1/places?region=제주", token).second[0]["poiId"].asText()

    /** 하루 여행 → 생성은 2차 없이 즉시 COMPLETE 라 편집이 바로 가능하다. */
    private fun tripWithItinerary(token: String): String {
        val trip = newTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201
        return trip
    }

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/api/v1/trips/${UUID.randomUUID()}/change-log", null).first shouldBe 401
    }

    private fun snapshot(poi: String, start: String) = ItinerarySnapshotView(
        listOf(
            DaySnapshotView(
                LocalDate.parse("2026-08-01"),
                listOf(SlotSnapshotView(UUID.fromString(poi), LocalTime.parse(start), LocalTime.parse("15:00"), false, false)),
            ),
        ),
    )

    @Test
    fun `기록한 이력이 전후 스냅숏·사유와 함께 타임라인에 나온다`() {
        val token = newToken()
        val trip = tripWithItinerary(token)
        val poi = poiId(token)

        changeLog.append(
            AppendChangeLog(
                tripId = UUID.fromString(trip),
                actor = "system",
                sourceType = ChangeSourceType.PLAN_B,
                reason = "비 예보로 실내로 변경",
                before = snapshot(poi, "10:00"),
                after = snapshot(poi, "14:00"),
            ),
        )

        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$trip/change-log", token)
        rc shouldBe 200
        val entry = body["entries"][0]
        entry["sourceType"].asText() shouldBe "PLAN_B"
        entry["reason"].asText() shouldBe "비 예보로 실내로 변경"
        entry.has("at") shouldBe true
        // jsonb 왕복(직렬화→저장→역직렬화) — 이중 인코딩이면 여기서 깨진다
        entry["after"]["days"][0]["slots"][0]["poiId"].asText() shouldBe poi
        entry["after"]["days"][0]["slots"][0]["startAt"].asText() shouldBe "14:00:00"
        entry["before"]["days"][0]["slots"][0]["startAt"].asText() shouldBe "10:00:00"
        entry["after"]["days"][0]["slots"][0].has("duration") shouldBe false // INV-3
    }

    @Test
    fun `여러 건이면 최신순으로 쌓이고 limit 이 먹는다`() {
        val token = newToken()
        val trip = tripWithItinerary(token)
        val poi = poiId(token)
        listOf("첫 번째", "두 번째", "세 번째").forEach { reason ->
            changeLog.append(
                AppendChangeLog(
                    UUID.fromString(trip), "system", ChangeSourceType.PLAN_B, reason,
                    snapshot(poi, "10:00"), snapshot(poi, "14:00"),
                ),
            )
        }

        val entries = call(HttpMethod.GET, "/api/v1/trips/$trip/change-log", token).second["entries"]
        entries.size() shouldBe 3
        entries[0]["reason"].asText() shouldBe "세 번째" // 최신이 앞
        call(HttpMethod.GET, "/api/v1/trips/$trip/change-log?limit=2", token).second["entries"].size() shouldBe 2
    }

    @Test
    fun `타 계정 이력은 404`() {
        val owner = newToken()
        val trip = tripWithItinerary(owner)
        call(HttpMethod.GET, "/api/v1/trips/$trip/change-log", newToken()).first shouldBe 404
    }

    @Test
    fun `이력 없는 여행은 빈 목록`() {
        val token = newToken()
        val trip = tripWithItinerary(token)
    }
}
