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
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import java.time.LocalDate
import java.time.LocalTime
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import java.sql.Timestamp
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
    @Autowired private lateinit var jdbc: JdbcTemplate

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

    /** 퍼사드 조회는 계정 id 로 소유를 판정하므로 토큰만으로는 부족하다 — 같은 계정의 (id, 토큰) 을 함께 쓴다. */
    private fun newAccount(): Pair<UUID, String> {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return account.id.value to accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun newToken(): String = newAccount().second

    private fun newTrip(token: String): String {
        val body = """{"startDate":"2026-08-01","endDate":"2026-08-01","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":0}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun poiId(token: String): String =
        call(HttpMethod.GET, "/api/v1/places?region=제주", token).second["items"][0]["poiId"].asText()

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
        call(HttpMethod.GET, "/api/v1/trips/$trip/change-log", token).second["entries"].size() shouldBe 0
    }

    /**
     * 퍼사드 조회(BR-U5-29 · TRIP-543) — 아카이브(U5)가 읽을 진입점. HTTP 가 아니라 **모듈 경계**로 왕복한다.
     * jsonb 보존은 실 DB 로만 확인된다 — 인메모리 대역은 이중 인코딩·형 변환을 원리적으로 못 본다.
     */
    @Test
    fun `퍼사드 조회가 기록한 이력을 최신순으로 돌려주고 전후 스냅숏이 보존된다`() {
        val (accountId, token) = newAccount()
        val trip = tripWithItinerary(token)
        val poi = poiId(token)
        listOf("첫 번째", "두 번째").forEach { reason ->
            changeLog.append(
                AppendChangeLog(
                    UUID.fromString(trip), "system", ChangeSourceType.PLAN_B, reason,
                    snapshot(poi, "10:00"), snapshot(poi, "14:00"),
                ),
            )
        }

        val entries = changeLog.findTimeline(accountId, UUID.fromString(trip), 100)

        entries.map { it.reason } shouldBe listOf("두 번째", "첫 번째") // 최신이 앞
        val latest = entries.first()
        latest.sourceType shouldBe ChangeSourceType.PLAN_B
        latest.actor shouldBe "system"
        // jsonb 왕복 — 저장 형식이 깨지면 전후가 같아 보이거나 슬롯이 통째로 사라진다
        latest.before.days[0].slots[0].startAt shouldBe LocalTime.parse("10:00")
        latest.after.days[0].slots[0].startAt shouldBe LocalTime.parse("14:00")
        latest.after.days[0].slots[0].poiId shouldBe UUID.fromString(poi)
        latest.after.days[0].date shouldBe LocalDate.parse("2026-08-01")
    }

    @Test
    fun `퍼사드 조회 — 이력 없는 여행은 빈 목록, 타 계정은 404`() {
        val (accountId, token) = newAccount()
        val trip = tripWithItinerary(token)

        changeLog.findTimeline(accountId, UUID.fromString(trip), 100) shouldBe emptyList()
        shouldThrow<ResourceNotFound> {
            changeLog.findTimeline(newAccount().first, UUID.fromString(trip), 100)
        }
    }

    /**
     * 저장 계약과 모양이 다른 옛 행(TRIP-1476 B·H). 이력은 append-only 라 고칠 수 없으므로, 한 행이 그 여행의
     * 타임라인 전체를 영구히 500 으로 만들면 안 된다. 그렇다고 **반쯤 읽어 돌려주면** 소비자가 없던 변경을 본다 —
     * 재계획(`ReplanFacadeService.changesOn`)은 `before − after` 로 "그날 뺀 곳"을 계산해 AI 에 싣는다. 그래서 그런
     * 행은 통째로 빠지고, 성한 행과 슬롯 없는 생성 이력(`{"days":[]}`)만 나온다.
     *
     * 실 DB 로만 본다 — 최상위가 `[]`·스칼라인 jsonb 는 어댑터에 닿기 전 **Hibernate 가 엔티티를 적재하는 순간** 터졌고, jsonb `null` 은 적재를 지나 어댑터에서 NPE 가 났다(H).
     * JPA 대역은 그 층을 거치지 않는다. 앱 롤은 INSERT 만 가지므로 깨진 행은 INSERT 로 만든다.
     */
    @Test
    fun `모양이 깨진 옛 스냅숏 행은 통째로 빠지고 타임라인은 200 으로 나머지를 돌려준다`() {
        val (accountId, token) = newAccount()
        val trip = tripWithItinerary(token)
        val poi = poiId(token)
        changeLog.append(AppendChangeLog(UUID.fromString(trip), "system", ChangeSourceType.PLAN_B, "성한 행", snapshot(poi, "10:00"), snapshot(poi, "14:00")))
        changeLog.append(AppendChangeLog(UUID.fromString(trip), "system", ChangeSourceType.MANUAL, "생성", ItinerarySnapshotView(emptyList()), snapshot(poi, "10:00")))
        val good = """{"poiId":"$poi","startAt":"10:00","endAt":"11:00","isFixed":false,"endsNextDay":false}"""
        val goodDay = """{"days":[{"date":"2026-08-01","slots":[$good]}]}"""
        fun insertRaw(reason: String, before: String, after: String, at: String) = jdbc.update(
            "INSERT INTO change_log_entry (trip_id, actor, source_type, reason, before_snapshot, after_snapshot, at) " +
                "VALUES (?::uuid, 'system', 'MANUAL', ?, ?::jsonb, ?::jsonb, ?)",
            trip, reason, before, after, Timestamp.from(Instant.parse(at)),
        )
        insertRaw("최상위가 객체 아님", "[]", "\"x\"", "2000-01-04T00:00:00Z")
        insertRaw("jsonb null", goodDay, "null", "2000-01-03T00:00:00Z")
        insertRaw("날이 객체 아님", """{"days":["x"]}""", goodDay, "2000-01-02T00:00:00Z")
        // 한쪽 슬롯만 못 읽는 행 — 반쯤 읽으면 "그날 뺀 곳 = poi" 라는 없던 변경이 된다.
        insertRaw("슬롯이 객체 아님", goodDay, """{"days":[{"date":"2026-08-01","slots":[1]}]}""", "2000-01-01T00:00:00Z")

        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$trip/change-log", token)
        rc shouldBe 200
        body["entries"].map { it["reason"].asText() } shouldBe listOf("생성", "성한 행")
        body["entries"][1]["after"]["days"][0]["slots"][0]["startAt"].asText() shouldBe "14:00:00"
        body["entries"][0]["before"]["days"].size() shouldBe 0

        // 아카이브(U5 TripRecordService)·재계획(ReplanFacadeService.changesOn)이 읽는 모듈 경계 조회도 같은 읽기를 지난다.
        val entries = changeLog.findTimeline(accountId, UUID.fromString(trip), 100)
        entries.map { it.reason } shouldBe listOf("생성", "성한 행")
        entries[0].before.days shouldBe emptyList()
        entries[0].after.days.single().slots.single().poiId shouldBe UUID.fromString(poi)
    }
}
