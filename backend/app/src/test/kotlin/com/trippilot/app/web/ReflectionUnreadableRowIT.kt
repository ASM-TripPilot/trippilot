package com.trippilot.app.web

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.archive.application.VisitCheckService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.consent.ConsentAction
import com.trippilot.auth.domain.consent.ConsentChannel
import com.trippilot.auth.domain.consent.ConsentRecord
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.ConsentRecordRepository
import com.trippilot.core.event.EventEnvelope
import com.trippilot.reflection.adapter.`in`.event.ActualRouteStoredSubscriber
import com.trippilot.reflection.adapter.out.persistence.ReflectionRepositoryAdapter
import com.trippilot.reflection.adapter.out.persistence.StyleAnalysisRepositoryAdapter
import com.trippilot.reflection.adapter.out.persistence.TripSummaryRepositoryAdapter
import com.trippilot.reflection.api.PersonalizationFacade
import com.trippilot.reflection.application.ReflectionService
import com.trippilot.reflection.application.StyleAnalysisService
import com.trippilot.reflection.application.TripSummaryService
import com.trippilot.reflection.domain.CategoryShare
import com.trippilot.reflection.domain.StyleAnalysis
import com.trippilot.reflection.domain.StyleAnalysisRepository
import com.trippilot.reflection.domain.StyleOutcome
import com.trippilot.reflection.domain.ReflectionRepository
import com.trippilot.reflection.domain.TraitGauges
import com.trippilot.reflection.domain.TripSummaryRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.client.RestClient
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import javax.sql.DataSource

/**
 * 저장된 회고·요약·스타일 행이 깨졌을 때(TRIP-1476 · 정본 Jira 댓글 10910).
 *
 * 수동 변경·손상·옛 버전이 남긴 행을 jdbc `UPDATE` 로 만든 뒤 **실 Postgres·실 MVC 컨버터**로 본다 —
 * 모양이 틀린 jsonb 는 Hibernate 가 엔티티를 싣는 순간 실패하므로(층 1) JPA 대역으로는 원리적으로 안 보인다.
 * GET 만 보지 않는다: 같은 읽기를 지나는 생성·수정·경로 갱신·재분석·일정 생성도 함께 본다.
 *
 * 규칙은 둘이다.
 * - **고칠 수 있는 칸은 칸 단위로 읽히는 만큼 돌려준다** — 모양이 틀린 jsonb 는 비었다고 보고, 범위 밖 수치는
 *   범위 끝으로 붙인다. 이 칸들은 다음 생성·갱신이 다시 계산해 덮는다.
 * - **카드·본문·출처를 못 읽는 행은 행 단위다.** 요약은 사용자가 쓴 것이 없어 조회·경로 갱신이 통째로 다시 만든다.
 *   회고는 목록에서 빼고, 초안·출처만 못 읽으면 생성·수정이 초안을 다시 만들어 고친다(수정본·기분·메모는 그대로).
 *   **수정본을 못 읽으면 그 하루에는 쓰지 않는다**(409) — 덮어쓰면 사용자가 쓴 것이 사라진다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ReflectionUnreadableRowIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var consents: ConsentRecordRepository
    @Autowired private lateinit var summaries: TripSummaryService
    @Autowired private lateinit var reflections: ReflectionService
    @Autowired private lateinit var styles: StyleAnalysisService
    @Autowired private lateinit var analyses: StyleAnalysisRepository
    @Autowired private lateinit var visits: VisitCheckService
    @Autowired private lateinit var routeStored: ActualRouteStoredSubscriber
    @Autowired private lateinit var personalization: PersonalizationFacade
    @Autowired private lateinit var summaryRepo: TripSummaryRepository
    @Autowired private lateinit var reflectionRepo: ReflectionRepository
    @Autowired private lateinit var txManager: PlatformTransactionManager
    @Autowired private lateinit var dataSource: DataSource
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-08-01T00:00:00Z")
    private val day1 = LocalDate.parse("2026-08-01")
    private val day2 = LocalDate.parse("2026-08-02")

    private fun call(method: HttpMethod, path: String, bearer: String, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build().method(method).uri(path)
        spec.header("Authorization", "Bearer $bearer")
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

    private fun newTrip(token: String, endDate: LocalDate = day2): UUID {
        val nights = if (endDate == day1) 0 else 1
        val body = """{"startDate":"$day1","endDate":"$endDate","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":$nights}],"preferenceSnapshot":{}}""".trimIndent()
        return UUID.fromString(call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText())
    }

    /** 깨진 행을 만든다 — 앱을 거치지 않은 변경(수동 수정·손상·옛 버전)이 남긴 모양이다. */
    private fun corrupt(table: String, set: String, where: String, vararg args: Any) {
        jdbc.update("UPDATE $table SET $set WHERE $where", *args) shouldBe 1
    }

    /**
     * 이 PR 이 로그를 남기는 자리 전부(저장소 셋 + 회고 서비스)를 함께 받는다 — 줄 수를 **한 로거만** 세면 다른 자리의 줄이 새도 모른다.
     * 단정은 [levels] 로 WARN·ERROR 수를 함께 본다.
     */
    private fun <T> logsOf(block: () -> T): Pair<T, List<ILoggingEvent>> {
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val loggers = listOf(
            ReflectionRepositoryAdapter::class.java, ReflectionService::class.java,
            TripSummaryRepositoryAdapter::class.java, StyleAnalysisRepositoryAdapter::class.java,
        ).map { LoggerFactory.getLogger(it) as Logger }
        loggers.forEach { it.addAppender(appender) }
        try {
            return block() to synchronized(appender) { appender.list.toList() }
        } finally {
            loggers.forEach { it.detachAppender(appender) }
        }
    }

    /** (WARN 수, ERROR 수). */
    private val List<ILoggingEvent>.levels get() = count { it.level == Level.WARN } to count { it.level == Level.ERROR }

    private fun routeStoredEvent(tripId: UUID, day: LocalDate) = EventEnvelope(
        UUID.randomUUID(), "archive.ActualRouteStored", 1, "trip", tripId.toString(), null, now,
        """{"tripId":"$tripId","localDate":"$day"}""",
    )

    // ── trip_summary ────────────────────────────────────────────────

    @Test
    fun `요약 jsonb 모양이 틀려도 요약은 읽히는 만큼 나가고 생성·경로 갱신이 그 행을 덮어 고친다`() {
        val (_, token) = newAccount()
        val tripId = newTrip(token)
        summaries.generate(tripId)
        // 하이라이트 원소 하나는 객체가 아니고, 장소 이름 하나는 숫자다. 수치는 객체가 아니라 배열이다.
        corrupt(
            "trip_summary",
            """highlights = '[{"date":"2026-08-01","places":["성산",1]},"x"]'::jsonb, stats = '[]'::jsonb""",
            "trip_id = ?", tripId,
        )

        val (warned, logs) = logsOf {
            call(HttpMethod.GET, "/api/v1/trips/$tripId/summary", token)
        }
        val (status, body) = warned

        status shouldBe 200
        body["ready"].asBoolean() shouldBe true
        body["summary"]["highlights"].map { it["places"].map(JsonNode::asText) } shouldBe listOf(listOf("성산"))
        body["summary"]["stats"]["totalVisits"].asInt() shouldBe 0
        // 조용히 고치지 않는다(INV-4) — 무엇을 버렸는지 남는다.
        logs.levels shouldBe (1 to 0)
        logs.filter { it.level == Level.WARN }.map { it.formattedMessage }.single().let {
            it.contains(tripId.toString()) shouldBe true
            it.contains("stats") shouldBe true
            it.contains("highlights") shouldBe true
        }

        // 경로 갱신(이벤트)이 같은 읽기를 지난다 — 던지면 릴레이가 재시도하다 포기한다. 경고는 잠근 뒤 읽기 한 번이다.
        logsOf { routeStored.handle(routeStoredEvent(tripId, day1)) }.second.levels shouldBe (1 to 0)
        jdbc.queryForObject("SELECT jsonb_typeof(stats) FROM trip_summary WHERE trip_id = ?", String::class.java, tripId) shouldBe "object"

        corrupt("trip_summary", """highlights = '{"a":1}'::jsonb""", "trip_id = ?", tripId)
        logsOf { call(HttpMethod.GET, "/api/v1/trips/$tripId/summary", token) }.let { (got, logs) ->
            got.first shouldBe 200
            got.second["summary"]["highlights"].size() shouldBe 0
            logs.levels shouldBe (1 to 0)
        }
        // 덮어쓴 뒤의 다시 읽기는 새 값이다 — 경고는 덮기 전 읽기의 한 번뿐이다(옛 모양을 새 값에 붙여 남기지 않는다).
        val (_, healLogs) = logsOf { summaries.generate(tripId) }
        healLogs.levels shouldBe (1 to 0)
        jdbc.queryForObject("SELECT jsonb_typeof(highlights) FROM trip_summary WHERE trip_id = ?", String::class.java, tripId) shouldBe "array"
    }

    @Test
    fun `요약 수치가 음수면 0 으로 붙여 읽는다`() {
        val (_, token) = newAccount()
        val tripId = newTrip(token)
        summaries.generate(tripId)
        corrupt(
            "trip_summary",
            """stats = '{"totalVisits":-1,"totalDistanceKm":-2.5,"distanceSource":"ROUTE","totalPhotos":-3,"hasLocationData":true}'::jsonb""",
            "trip_id = ?", tripId,
        )

        val (got, logs) = logsOf { call(HttpMethod.GET, "/api/v1/trips/$tripId/summary", token) }
        val (status, body) = got

        status shouldBe 200
        logs.levels shouldBe (1 to 0)
        val stats = body["summary"]["stats"]
        listOf(stats["totalVisits"].asInt(), stats["totalPhotos"].asInt()) shouldBe listOf(0, 0)
        stats["totalDistanceKm"].asDouble() shouldBe 0.0
        // 범위만 고친다 — 읽히는 다른 칸은 그대로다.
        stats["distanceSource"].asText() shouldBe "ROUTE"
        stats["hasLocationData"].asBoolean() shouldBe true
    }

    /**
     * 생성(`TripEnded`)은 여행당 한 번이라 다시 오지 않는다 — **실제로 다시 도는 경로**(조회·경로 갱신 이벤트)가 고쳐야 낫는다.
     * 고칠 때 알림 이벤트는 내지 않는다(이미 한 번 알렸다).
     */
    @Test
    fun `요약 본문이 비었거나 모르는 출처면 — 조회와 경로 갱신이 다시 만들어 낫는다`() {
        listOf("narrative = ' '", "source = 'ROBOT'").forEach { broken ->
            val (_, token) = newAccount()
            val tripId = newTrip(token)
            summaries.generate(tripId) // 여행 종료 때의 한 번(준비) — 아래의 고침은 이것을 다시 부르지 않는다
            val announced = { jdbc.queryForObject("SELECT count(*) FROM outbox_event WHERE event_type = 'reflection.ReflectionReady' AND aggregate_id = ?", Int::class.java, tripId.toString()) }
            val healed = {
                jdbc.queryForMap("SELECT narrative, source FROM trip_summary WHERE trip_id = ?", tripId).let {
                    (it["narrative"] as String).isNotBlank() && it["source"] in setOf("RULE", "BASIC")
                }
            }
            announced() shouldBe 1

            corrupt("trip_summary", broken, "trip_id = ?", tripId)
            val (got, logs) = logsOf {
                call(HttpMethod.GET, "/api/v1/trips/$tripId/summary", token)
            }
            got.first shouldBe 200
            got.second["ready"].asBoolean() shouldBe true
            healed() shouldBe true
            // 조회는 잠그지 않고 읽은 뒤 잠그고 다시 본다 — 못 읽은 채라 두 줄이다. 고친 뒤 다시 읽기는 새 값이라 더 없다.
            logs.levels shouldBe (0 to 2)
            logs.all { it.formattedMessage.contains(tripId.toString()) } shouldBe true

            // 경로 갱신은 이미 잠그고 읽었으므로 다시 읽지 않고 만든다 — 한 줄이다.
            corrupt("trip_summary", broken, "trip_id = ?", tripId)
            val (_, routeLogs) = logsOf { routeStored.handle(routeStoredEvent(tripId, day1)) }
            routeLogs.levels shouldBe (0 to 1)
            healed() shouldBe true
            announced() shouldBe 1
        }
    }

    // ── reflection ──────────────────────────────────────────────────

    @Test
    fun `회고 수치 모양·범위가 틀려도 목록·수정·경로 갱신이 된다`() {
        val (_, token) = newAccount()
        val tripId = newTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$tripId/reflections/$day1", token).first shouldBe 200
        corrupt("reflection", "stats = '[]'::jsonb", "trip_id = ? AND day_date = ?", tripId, day1)

        logsOf { call(HttpMethod.GET, "/api/v1/trips/$tripId/reflections", token) }.let { (got, logs) ->
            got.first shouldBe 200
            got.second["items"].single()["stats"]["visitCount"].asInt() shouldBe 0
            logs.levels shouldBe (1 to 0)
        }
        val (edited, editLogs) = logsOf {
            call(HttpMethod.PUT, "/api/v1/trips/$tripId/reflections/$day1", token, """{"mood":"GOOD"}""")
        }
        edited.first shouldBe 200
        editLogs.levels shouldBe (1 to 0) // 고치기 전 읽기 한 번 — 저장 뒤 다시 읽기는 새 값이다
        jdbc.queryForObject(
            "SELECT jsonb_typeof(stats) FROM reflection WHERE trip_id = ? AND day_date = ?", String::class.java, tripId, day1,
        ) shouldBe "object"

        corrupt(
            "reflection", """stats = '{"visitCount":-1,"distanceKm":-1.5,"distanceSource":"ROUTE","photoCount":-2}'::jsonb""",
            "trip_id = ? AND day_date = ?", tripId, day1,
        )
        logsOf { call(HttpMethod.GET, "/api/v1/trips/$tripId/reflections", token) }.let { (got, logs) ->
            got.first shouldBe 200
            logs.levels shouldBe (1 to 0)
            val stats = got.second["items"].single()["stats"]
            listOf(stats["visitCount"].asInt(), stats["photoCount"].asInt()) shouldBe listOf(0, 0)
            stats["distanceKm"].asDouble() shouldBe 0.0
            stats["distanceSource"].asText() shouldBe "ROUTE"
        }
        // 경로 갱신은 잠근 뒤 한 번 읽는다 — 경고 한 줄.
        logsOf { routeStored.handle(routeStoredEvent(tripId, day1)) }.second.levels shouldBe (1 to 0)

        // 생성은 AI 전 판정 읽기와 잠근 뒤 읽기가 둘 다 근거 수치를 읽는다 — 경고 두 줄(수정은 위처럼 한 줄).
        corrupt("reflection", "stats = '[]'::jsonb", "trip_id = ? AND day_date = ?", tripId, day1)
        val (generated, genLogs) = logsOf {
            call(HttpMethod.POST, "/api/v1/trips/$tripId/reflections/$day1", token)
        }
        generated.first shouldBe 200
        genLogs.levels shouldBe (2 to 0)
    }

    private fun writeMine(tripId: UUID, token: String) {
        call(HttpMethod.POST, "/api/v1/trips/$tripId/reflections/$day1", token).first shouldBe 200
        call(HttpMethod.POST, "/api/v1/trips/$tripId/reflections/$day2", token).first shouldBe 200
        val mine = """{"template_id":"user.edit.v1","format":"CARD","cover":{"title":"내가 쓴 제목"}}"""
        val body = json.writeValueAsString(mapOf("card" to mine, "mood" to "HAPPY", "shortMemo" to "좋았다"))
        call(HttpMethod.PUT, "/api/v1/trips/$tripId/reflections/$day1", token, body).first shouldBe 200
        summaries.generate(tripId)
    }

    private fun stored(tripId: UUID) = jdbc.queryForMap(
        "SELECT draft_card::text d, edited_card::text e, source, stats::text s, mood, short_memo, generated_at FROM reflection WHERE trip_id = ? AND day_date = ?",
        tripId, day1,
    )

    /** 목록에서 그 하루만 빠지고, 경로 갱신은 그 하루를 건너뛰되(던지지 않는다) 같은 이벤트의 요약 갱신까지 간다. */
    private fun listSkipsAndRouteSkips(tripId: UUID, token: String, reason: String) {
        val (listed, logs) = logsOf {
            call(HttpMethod.GET, "/api/v1/trips/$tripId/reflections", token)
        }
        listed.first shouldBe 200
        listed.second["items"].map { it["dayDate"].asText() } shouldContainExactly listOf(day2.toString())
        logs.levels shouldBe (0 to 1)
        logs.filter { it.level == Level.ERROR }.single().formattedMessage.let {
            it.contains(tripId.toString()) shouldBe true
            it.contains(day1.toString()) shouldBe true
            // 사유가 실제 원인을 말한다 — 배열 카드를 "제목이 비었다"로 남기면 운영자가 엉뚱한 곳을 본다.
            it.contains(reason) shouldBe true
        }
        val before = stored(tripId)
        jdbc.update("UPDATE trip_summary SET stats = '{}'::jsonb WHERE trip_id = ?", tripId)
        // 저장소가 못 읽은 사유(ERROR)와 서비스가 그 하루를 건너뛴 사실(WARN)이 한 줄씩이다.
        logsOf { routeStored.handle(routeStoredEvent(tripId, day1)) }.second.levels shouldBe (1 to 1)
        jdbc.queryForObject("SELECT jsonb_exists(stats, 'totalVisits') FROM trip_summary WHERE trip_id = ?", Boolean::class.java, tripId) shouldBe true
        stored(tripId) shouldBe before
    }

    /**
     * 초안·출처만 못 읽는 하루 — 초안은 다시 만들 수 있다. 생성(POST)·수정(PUT) 모두 **초안·출처만 갈아끼워** 고치고,
     * 사용자가 쓴 수정본·기분·메모와 최초 생성 시각은 그대로다(TRIP-553 · BR-U5-36).
     */
    @Test
    fun `초안·출처를 못 읽는 하루는 목록에서 빠지고 — 생성·수정이 수정본을 지키며 초안을 다시 만들어 고친다`() {
        mapOf("draft_card = '[]'::jsonb" to "객체가 아닙니다(jsonb array)", "source = 'ROBOT'" to "ROBOT").forEach { (broken, reason) ->
            val (_, token) = newAccount()
            val tripId = newTrip(token)
            writeMine(tripId, token)
            val original = stored(tripId)

            corrupt("reflection", broken, "trip_id = ? AND day_date = ?", tripId, day1)
            listSkipsAndRouteSkips(tripId, token, reason)

            // 수정 — 기분만 고치는 요청이 망가진 초안을 다시 만들고, 수정본·메모는 남는다.
            // 못 읽은 초안은 잠근 뒤 읽기에서 한 번 남고, 초안을 다시 만드는 읽기는 저장된 초안을 읽지 않는다.
            logsOf { call(HttpMethod.PUT, "/api/v1/trips/$tripId/reflections/$day1", token, """{"mood":"GOOD"}""") }.let { (got, logs) ->
                got.first shouldBe 200
                got.second["card"]["title"].asText() shouldBe "내가 쓴 제목"
                logs.levels shouldBe (0 to 1)
            }
            stored(tripId).let {
                it["e"] shouldBe original["e"]
                it["short_memo"] shouldBe "좋았다"
                it["mood"] shouldBe "GOOD"
                it["generated_at"] shouldBe original["generated_at"]
                it["d"] shouldBe original["d"]
                it["source"] shouldBe original["source"]
            }

            // 재생성 — 같은 망가짐을 다시 만들고 POST 로 고친다.
            corrupt("reflection", broken, "trip_id = ? AND day_date = ?", tripId, day1)
            // AI 전 판정 읽기에서 한 번 — 잠근 뒤 읽기(findForRedraft)는 저장된 초안을 읽지 않는다.
            logsOf { call(HttpMethod.POST, "/api/v1/trips/$tripId/reflections/$day1", token) }.let { (got, logs) ->
                got.first shouldBe 200
                logs.levels shouldBe (0 to 1)
            }
            stored(tripId).let {
                it["e"] shouldBe original["e"]
                it["short_memo"] shouldBe "좋았다"
                it["mood"] shouldBe "GOOD"
                it["generated_at"] shouldBe original["generated_at"]
                it["d"] shouldBe original["d"]
                it["source"] shouldBe original["source"]
            }
            logsOf { call(HttpMethod.GET, "/api/v1/trips/$tripId/reflections", token) }.let { (got, logs) ->
                got.second["items"].size() shouldBe 2
                logs.levels shouldBe (0 to 0)
            }
        }
    }

    /** 수정본을 못 읽는 하루 — 사용자가 쓴 것이다. **어떤 쓰기도 그 행을 바꾸지 않고**, 생성·수정은 409 로 거절한다(500 이 아니다). */
    @Test
    fun `수정본을 못 읽는 하루는 목록에서 빠지고 — 생성·수정은 409 로 거절하며 행을 바꾸지 않는다`() {
        val (_, token) = newAccount()
        val tripId = newTrip(token)
        writeMine(tripId, token)
        corrupt("reflection", "edited_card = '[]'::jsonb", "trip_id = ? AND day_date = ?", tripId, day1)
        val before = stored(tripId)

        listSkipsAndRouteSkips(tripId, token, "객체가 아닙니다(jsonb array)")

        listOf(HttpMethod.PUT to """{"mood":"GOOD"}""", HttpMethod.POST to null).forEach { (method, body) ->
            val (got, logs) = logsOf {
                call(method, "/api/v1/trips/$tripId/reflections/$day1", token, body)
            }
            got.first shouldBe 409
            got.second["error"]["code"].asText() shouldBe "REFLECTION_UNREADABLE"
            logs.levels shouldBe (0 to 1)
            logs.filter { it.level == Level.ERROR }.single().formattedMessage.let {
                it.contains(tripId.toString()) shouldBe true
                it.contains(day1.toString()) shouldBe true
            }
        }
        stored(tripId) shouldBe before
    }

    // ── style_analysis ──────────────────────────────────────────────

    private fun grantPersonalization(accountId: UUID) {
        consents.append(ConsentRecord.of(AccountId(accountId), TermsType.PERSONALIZATION, "1.0", ConsentAction.GRANT, ConsentChannel.SETTINGS, now))
    }

    private fun seedAnalysis(accountId: UUID) {
        analyses.upsert(
            StyleAnalysis(
                accountId, listOf("#카페"), TraitGauges(easygoing = 5, foodAffinity = 3, activeness = 1),
                listOf(CategoryShare("카페", 0.6), CategoryShare("맛집", 0.4)), 2.0, 1.2, 72, 2, 11, now,
            ),
        )
    }

    @Test
    fun `스타일 행이 깨져도 개인화 조회와 일정 생성이 500 이 되지 않는다 — 읽히는 만큼 쓴다`() {
        val (accountId, token) = newAccount()
        grantPersonalization(accountId)
        seedAnalysis(accountId)
        corrupt(
            "style_analysis",
            """descriptors = '{}'::jsonb, trait_gauges = '{"easygoing":9,"foodAffinity":-1,"activeness":2}'::jsonb,
               category_breakdown = '[3, {"category":"카페","ratio":1.5}]'::jsonb,
               avg_places_per_day = -1, avg_radius_km = -2, avg_dwell_minutes = -5""".trimIndent(),
            "account_id = ?", accountId,
        )

        // 일정 생성은 개인화 힌트를 묻는다(PersonalizationPort.hintsFor) — 저장된 스타일 행 하나로 생성 전체가 막히면 안 된다.
        val tripId = newTrip(token, endDate = day1)
        logsOf { call(HttpMethod.POST, "/api/v1/trips/$tripId/itinerary", token) }.let { (got, logs) ->
            got.first shouldBe 201
            // 하루짜리 여행이라 생성은 응답 전에 끝난다 — 개인화 힌트를 한 번 묻고, 그 읽기가 한 줄 남긴다.
            logs.levels shouldBe (1 to 0)
        }

        val (got, logs) = logsOf {
            call(HttpMethod.GET, "/api/v1/me/personalization", token)
        }
        got.first shouldBe 200
        got.second["applied"].asBoolean() shouldBe true
        // 범위 밖 게이지는 끝값으로 붙는다 — 9 는 5(여유롭다)라서 속도는 "느긋하게"다.
        personalization.deriveFor(accountId).pace shouldBe "느긋하게"
        logs.levels shouldBe (1 to 0)
        logs.single().formattedMessage.contains(accountId.toString()) shouldBe true
        analyses.find(accountId)!!.let {
            it.descriptors shouldBe emptyList()
            it.traitGauges shouldBe TraitGauges(easygoing = 5, foodAffinity = 0, activeness = 2)
            it.categoryBreakdown shouldBe listOf(CategoryShare("카페", 1.0))
            listOf(it.avgPlacesPerDay, it.avgRadiusKm) shouldBe listOf(0.0, 0.0)
            it.avgDwellMinutes shouldBe null
        }

        corrupt(
            "style_analysis", """descriptors = '["#카페", 1]'::jsonb, trait_gauges = '[]'::jsonb, category_breakdown = '{}'::jsonb""",
            "account_id = ?", accountId,
        )
        val (_, shapeLogs) = logsOf {
            call(HttpMethod.GET, "/api/v1/me/personalization", token).first shouldBe 200
        }
        // 모양이 틀린 칸은 SQL 이 비워서 읽어 온다 — 어댑터가 따로 읽은 원래 모양으로 그 사실을 남긴다.
        shapeLogs.levels shouldBe (1 to 0)
        shapeLogs.single().formattedMessage.let { m ->
            listOf("descriptors[]", "trait_gauges", "category_breakdown").forEach { m.contains(it) shouldBe true }
        }
        analyses.find(accountId)!!.let {
            it.descriptors shouldBe listOf("#카페")
            it.traitGauges shouldBe TraitGauges(0, 0, 0)
            it.traitGaugesRead shouldBe false
            it.categoryBreakdown shouldBe emptyList()
        }
        // 게이지 자리값 0 은 속도의 근거가 아니고(아래), 활동도 비었다 — 넘길 것이 없으니 개인화는 적용되지 않는다.
        personalization.deriveFor(accountId).let {
            it.applied shouldBe false
            it.pace shouldBe null
        }
    }

    /**
     * 게이지 칸의 모양이 틀리면 0 으로 채워 읽는데, 그 0 을 속도로 옮기면 "알차게"다 — 사용자가 고른 적 없는 속도가 일정 생성에
     * 들어간다(`PersonalizationService` 주석). 그래서 그 분석으로는 **속도만 내지 않는다**. 읽히는 활동은 그대로 넘긴다.
     */
    @Test
    fun `게이지를 못 읽은 스타일 분석은 개인화 속도를 내지 않는다 — 읽히는 활동만 넘긴다`() {
        val (accountId, token) = newAccount()
        grantPersonalization(accountId)
        seedAnalysis(accountId)
        // 모양이 틀린 칸, 객체지만 속도 축이 없는 칸, 속도 축이 숫자가 아닌 칸 — 셋 다 여유로움을 0 으로 채워 읽는다.
        listOf("'[]'", "'{}'", """'{"easygoing":"x","foodAffinity":3,"activeness":2}'""").forEach { gauges ->
            corrupt("style_analysis", "trait_gauges = $gauges::jsonb", "account_id = ?", accountId)

            analyses.find(accountId)!!.traitGauges.easygoing shouldBe 0
            // 속도를 빼는 이유가 남는다(INV-4) — 모양이 틀리면 칸 이름, 객체면 그 축 이름.
            val (view, logs) = logsOf { personalization.deriveFor(accountId) }
            logs.levels shouldBe (1 to 0)
            logs.single().formattedMessage.contains(if (gauges == "'[]'") "trait_gauges" else "trait_gauges.easygoing") shouldBe true
            view.let {
                it.applied shouldBe true
                it.pace shouldBe null
                it.activities shouldContainExactly listOf("카페", "맛집투어")
            }
            call(HttpMethod.GET, "/api/v1/me/personalization", token).second["sharedItems"].map { it["item"].asText() } shouldBe
                listOf("자주 방문한 장소 유형")
        }
    }

    @Test
    fun `재분석은 깨진 스타일 행을 덮어 고친다`() {
        val (accountId, token) = newAccount()
        val tripId = newTrip(token)
        repeat(StyleAnalysis.MIN_VISITS) { i ->
            val poi = UUID.randomUUID()
            jdbc.update(
                "INSERT INTO poi (poi_id, name_ko, lat, lng, category, data_status, source, created_at, updated_at) " +
                    "VALUES (?, ?, ?, ?, '카페', 'ACTIVE', 'MANUAL', now(), now())",
                poi, "장소$i", 33.40 + i * 0.01, 126.50 + i * 0.01,
            )
            val arrived = visits.arrive(accountId, tripId, "$day1#$poi", poi, CheckSource.MANUAL)
            visits.complete(accountId, tripId, arrived.visitCheckId)
        }
        val first = styles.analyze(accountId).shouldBeInstanceOf<StyleOutcome.Official>().analysis
        corrupt("style_analysis", "trait_gauges = '[]'::jsonb, category_breakdown = '{}'::jsonb, descriptors = '{}'::jsonb", "account_id = ?", accountId)

        // 화면(`GET /me/style`)은 저장된 행을 그리지 않는다 — 조회가 다시 분석해 덮은 값을 낸다. 깨진 행의 자리값 0 이 그려지지 않는다(BR-U5-31).
        val (shown, logs) = logsOf {
            call(HttpMethod.GET, "/api/v1/me/style", token)
        }
        shown.first shouldBe 200
        shown.second["official"].asBoolean() shouldBe true
        shown.second["analysis"]["traitGauges"].let { g ->
            listOf(g["easygoing"].asInt(), g["foodAffinity"].asInt(), g["activeness"].asInt()) shouldBe
                listOf(first.traitGauges.easygoing, first.traitGauges.foodAffinity, first.traitGauges.activeness)
        }
        shown.second["analysis"]["categoryBreakdown"].map { it["category"].asText() } shouldBe first.categoryBreakdown.map { it.category }

        // 재분석은 옛 행을 도메인으로 읽지 않고 덮는다 — 방금 만든 분석을 "못 읽었다"고 남기면 경보가 거짓이 된다.
        logs.levels shouldBe (0 to 0)
        jdbc.queryForMap(
            "SELECT jsonb_typeof(trait_gauges) g, jsonb_typeof(category_breakdown) c, jsonb_typeof(descriptors) d FROM style_analysis WHERE account_id = ?",
            accountId,
        ) shouldBe mapOf("g" to "object", "c" to "array", "d" to "array")
    }

    @Test
    fun `깨지지 않은 행은 그대로 읽힌다 — 경고도 없다`() {
        val (accountId, token) = newAccount()
        grantPersonalization(accountId)
        seedAnalysis(accountId)
        val tripId = newTrip(token)
        summaries.generate(tripId)

        val (summary, summaryLogs) = logsOf {
            call(HttpMethod.GET, "/api/v1/trips/$tripId/summary", token)
        }
        val (_, styleLogs) = logsOf {
            call(HttpMethod.GET, "/api/v1/me/personalization", token).first shouldBe 200
        }

        summary.second["ready"].asBoolean() shouldBe true
        analyses.find(accountId)!!.traitGauges shouldBe TraitGauges(easygoing = 5, foodAffinity = 3, activeness = 1)
        summaryLogs.levels shouldBe (0 to 0)
        styleLogs.levels shouldBe (0 to 0)
    }

    // ── 잠근 뒤 읽기 ────────────────────────────────────────────────

    /** 다른 연결에서 바로 커밋한다 — 겹친 요청이 먼저 끝낸 것과 같다(테스트 트랜잭션의 연결을 쓰지 않는다). */
    private fun commitElsewhere(sql: String, vararg args: Any) {
        dataSource.connection.use { c ->
            c.autoCommit = true
            c.prepareStatement(sql).use { ps ->
                args.forEachIndexed { i, a -> ps.setObject(i + 1, a) }
                ps.executeUpdate() shouldBe 1
            }
        }
    }

    /**
     * 같은 트랜잭션이 잠그기 전에 행을 실어 뒀어도 잠근 뒤 읽기는 DB 를 본다. 조회가 못 읽는 요약을 고칠 때(먼저 읽고 → 잠그고 다시 본다),
     * 회고 생성이 AI 전에 그 하루를 먼저 볼 때가 이 모양이다 — 영속성 컨텍스트의 옛 값을 쓰면 겹친 요청의 결과를 못 보고 덮는다.
     */
    @Test
    fun `잠근 뒤 읽기는 잠그기 전에 실어 둔 옛 값이 아니라 DB 를 본다`() {
        val (_, token) = newAccount()
        val tripId = newTrip(token)
        summaries.generate(tripId)
        call(HttpMethod.POST, "/api/v1/trips/$tripId/reflections/$day1", token).first shouldBe 200
        corrupt("trip_summary", "narrative = ' '", "trip_id = ?", tripId)

        logsOf {
            TransactionTemplate(txManager).executeWithoutResult {
                summaryRepo.find(tripId) shouldBe null
                commitElsewhere("UPDATE trip_summary SET narrative = '겹친 요청이 고친 요약' WHERE trip_id = ?", tripId)
                summaryRepo.findForUpdate(tripId)!!.narrative shouldBe "겹친 요청이 고친 요약"
            }
        }.second.levels shouldBe (0 to 1) // 잠그기 전의 못 읽은 읽기 한 줄 — 잠근 뒤에는 고친 값을 읽는다
        TransactionTemplate(txManager).executeWithoutResult {
            reflectionRepo.find(tripId, day1)!!.mood shouldBe null
            commitElsewhere("UPDATE reflection SET mood = 'GOOD' WHERE trip_id = ? AND day_date = ?", tripId, day1)
            reflectionRepo.findForUpdate(tripId, day1)!!.mood shouldBe "GOOD"
        }
        TransactionTemplate(txManager).executeWithoutResult {
            val before = reflectionRepo.find(tripId, day1)!!
            commitElsewhere("UPDATE reflection SET short_memo = '겹친 메모' WHERE trip_id = ? AND day_date = ?", tripId, day1)
            reflectionRepo.findForRedraft(tripId, day1, before.draftCard, before.source)!!.shortMemo shouldBe "겹친 메모"
        }
    }
}
