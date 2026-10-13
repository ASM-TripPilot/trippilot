package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.TestPropertySource
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import java.time.Instant

/**
 * TRIP-265 — 리버스 POI read 포트 E2E. AI(M7) 경계용 `/internal/pois`(인증 필요, snake_case).
 * 시드 제주 POI(성산일출봉=자연/NATURE, image·영업시간 미보유→PARTIAL) 사용.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = ["trippilot.service-auth.token=" + SERVICE_TOKEN])
class PoiInternalApiIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var cleanupJdbc: JdbcTemplate

    /**
     * **넣은 것을 치운다.** Testcontainers 는 전 IT 가 공유하는 싱글톤이고, 여기 쓰기는 트랜잭션
     * 롤백이 닿지 않는다. 남기면 수집분 집계를 묻는 IT 가 내 문서와 무관한 행을 세게 된다.
     *
     * 무서운 점은 발현 시점이다 — 테스트를 **추가하기만 해도** 실행 순서가 바뀌어 몇 달 잠복하던
     * 오염이 무관한 PR 에서 터진다(PR #241 실측).
     */
    @AfterEach
    fun cleanUpOwnRows() {
        cleanupJdbc.update("DELETE FROM poi WHERE source_ref LIKE 'E2E-%'")
    }

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()
    private val seongsan = "e0000000-0000-4000-8000-000000000001" // 성산일출봉 33.4587,126.9427 자연

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build().method(method).uri(path)
        bearer?.let { spec.header("X-Service-Token", it) }   // /internal 은 서비스 토큰만 받는다(TRIP-393)
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun newToken(): String {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z")))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    /**
     * TRIP-393 — 서비스 경계는 **사용자 토큰으로 열리지 않는다**. 계정 스코프가 없는 호출이라
     * 사용자 토큰을 흉내 내면 감사 로그의 "누가 했나"가 거짓이 된다.
     */
    @Test
    fun `사용자 JWT 로는 서비스 경계를 통과할 수 없다`() {
        val userJwt = newToken()
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build()
            .get().uri("/internal/pois?centerLat=33.4587&centerLng=126.9427&radiusKm=3")
            .header("Authorization", "Bearer $userJwt")
        val rc = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java).statusCode.value()

        rc shouldBe 403   // 인증은 됐으나 권한이 없다 — 401(무인증)과 구분된다
    }

    // 토큰 비교가 무력화돼도(항상 참) 위 테스트들은 전부 통과한다 — 그래서 **틀린 토큰**을 따로 밀어 본다.
    @Test
    fun `틀린 서비스 토큰은 거부된다`() {
        call(HttpMethod.GET, "/internal/pois?centerLat=33.4587&centerLng=126.9427&radiusKm=3", "wrong-token")
            .first shouldBe 401

        call(HttpMethod.POST, "/internal/pois/proposals", "wrong-token", """{"source":"TOURAPI","proposals":[]}""")
            .first shouldBe 401
    }

    // 길이가 다른 토큰도 같은 경로로 거부된다(상수 시간 비교가 길이 차이에서 일찍 빠지지 않게).
    @Test
    fun `길이가 다른 토큰도 거부된다`() {
        call(HttpMethod.GET, "/internal/pois?centerLat=33.4587&centerLng=126.9427&radiusKm=3", "x")
            .first shouldBe 401
    }

    /**
     * **서비스 토큰은 사용자 API 를 열지 않는다.** 필터가 경로를 안 가리면 계정을 쓰지 않는 엔드포인트
     * (`/stays/search`·`geocode`·`reverse-geocode`)가 그대로 통과하고, 셋 다 벤더를 부르므로
     * 토큰이 새면 쿼터를 태우는 무인증 프록시가 된다. 나머지가 401 로 끝나는 것은
     * `accountId()` 가 "service" 를 UUID 로 못 읽어서일 뿐 — 방어가 아니라 우연이다.
     */
    @Test
    fun `서비스 토큰으로 사용자 API 를 부를 수 없다`() {
        listOf(
            "/api/v1/stays/geocode?q=제주",
            "/api/v1/stays/reverse-geocode?lat=33.5&lng=126.5",
            "/api/v1/stays/search?region=제주",
        ).forEach { path ->
            val rc = RestClient.builder().baseUrl("http://localhost:$port").build()
                .get().uri(path)
                .header("X-Service-Token", SERVICE_TOKEN)
                .retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
                .toEntity(String::class.java).statusCode.value()

            rc shouldBe 401   // 서비스 인증이 아예 성립하지 않는다
        }
    }

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/internal/pois?centerLat=33.4587&centerLng=126.9427&radiusKm=5", null).first shouldBe 401
    }

    @Test
    fun `batch-get — 정본 snake_case + 경계코드 + dataQuality`() {
        val token = SERVICE_TOKEN
        val (rc, body) = call(HttpMethod.POST, "/internal/pois/batch-get", token, """{"poi_ids":["$seongsan"]}""")
        rc shouldBe 200
        val poi = body[0]
        poi["poi_id"].asText() shouldBe seongsan
        poi["name_ko"].asText() shouldBe "성산일출봉"
        poi["category"].asText() shouldBe "NATURE"        // 자연 → NATURE
        poi["data_status"].asText() shouldBe "ACTIVE"
        poi["data_quality"].asText() shouldBe "PARTIAL"   // 사진·영업시간 미보유
        poi.has("saved_count") shouldBe true
        poi.has("duration") shouldBe false                // INV-3
    }

    @Test
    fun `radius — 중심 반경 내 ACTIVE 정본`() {
        val token = SERVICE_TOKEN
        val (rc, body) = call(HttpMethod.GET, "/internal/pois?centerLat=33.4587&centerLng=126.9427&radiusKm=3", token)
        rc shouldBe 200
        val names = (0 until body.size()).map { body[it]["name_ko"].asText() }
        names.contains("성산일출봉") shouldBe true          // 중심점
        body[0].has("distance_m") shouldBe true
    }

    /**
     * 수집 등록 제안 수신 — **AI 산출 `collected_pois.json` 의 모양 그대로**를 태운다.
     *
     * 아래 본문은 `ai/.../sourcing/pipeline.py` 의 `to_output_document`(schema_version 1)에서 그대로 옮긴 것이다.
     * 상대가 스키마를 바꾸면 이 테스트가 먼저 깨져야 한다 — 실 파일로 넣어 보고 나서야 아는 것보다 낫다.
     */
    @Test
    fun `등록 제안을 받아 게이트를 태우고 저장한다 · 재수신은 행을 늘리지 않는다`() {
        val token = SERVICE_TOKEN
        val doc = """
            {"schema_version":1,"source":"TOURAPI","collected_at":"2026-08-18T04:00:00+09:00",
             "area_code":"39","content_types":["12"],"stats":{"passed":1},
             "proposals":[
               {"provisional_id":"11111111-1111-4111-8111-111111111111","source":"TOURAPI",
                "poi":{"poi_id":"11111111-1111-4111-8111-111111111111","name":"수신테스트폭포",
                       "category":"NATURE","coord":{"lat":33.2447,"lng":126.5590},
                       "open_hours":[],"avg_cost":null,"rating":null},
                "tags":["폭포","산책"],"region":"서귀포시","opening_hours_raw":"09:00~22:00",
                "provenance":{"content_id":"E2E-126508","content_type_id":"12",
                              "address":"제주특별자치도 서귀포시","image_url":null,
                              "modified_time":"20260818000000"}}]}
        """.trimIndent()

        val (rc, first) = call(HttpMethod.POST, "/internal/pois/proposals", token, doc)
        rc shouldBe 200
        first["registered"].asInt() shouldBe 1
        first["updated"].asInt() shouldBe 0

        // 실제로 후보풀에 들어갔는지 — 조회 경로로 확인한다(응답 숫자만 믿지 않는다).
        val (_, nearby) = call(
            HttpMethod.GET,
            "/internal/pois?centerLat=33.2447&centerLng=126.5590&radiusKm=1",
            token,
        )
        nearby.any { it["name_ko"].asText() == "수신테스트폭포" } shouldBe true

        // 수집이 실어 보낸 태그와 출처 식별자가 **읽는 경계까지 살아 나오는지**(TRIP-870).
        // 저장까지만 확인하면 못 본다 — 값은 예전부터 DB 에 있었고 이 경계에서만 빠져 있었다.
        val ingested = nearby.first { it["name_ko"].asText() == "수신테스트폭포" }
        ingested["tags"].map { it.asText() } shouldBe listOf("폭포", "산책")
        // **키 이름을 못 박는다.** snake_case 전략이 빠지거나 필드명이 바뀌면 `sourceRef` 로 나가고,
        // 상대의 content_id 조인은 예외 없이 **0건 매칭**이 된다 — 조용히 틀리는 쪽이다.
        ingested["source_ref"].asText() shouldBe "E2E-126508"

        // 같은 문서를 다시 넣어도 늘지 않는다 — 수집은 매일 돈다.
        val (_, second) = call(HttpMethod.POST, "/internal/pois/proposals", token, doc)
        second["registered"].asInt() shouldBe 0
        second["updated"].asInt() shouldBe 1
    }

    @Test
    fun `우리 어휘에 없는 카테고리는 사유와 함께 탈락한다`() {
        val token = SERVICE_TOKEN
        // STAY 는 AI 내부 전용이라 우리 8종에 없다 — 가까운 값으로 밀어 넣지 않는다.
        val doc = """
            {"schema_version":1,"source":"TOURAPI","proposals":[
              {"poi":{"name":"어떤숙소","category":"STAY","coord":{"lat":33.5,"lng":126.5}},
               "provenance":{"content_id":"E2E-STAY-1"}}]}
        """.trimIndent()

        val (rc, body) = call(HttpMethod.POST, "/internal/pois/proposals", token, doc)

        rc shouldBe 200
        body["registered"].asInt() shouldBe 0
        body["dropped"]["unknown_category"].asInt() shouldBe 1
    }

    @Test
    fun `모르는 출처는 400 — 임의로 가정하지 않는다`() {
        val token = SERVICE_TOKEN
        val doc = """{"schema_version":1,"source":"NAVER_MAP","proposals":[]}"""

        call(HttpMethod.POST, "/internal/pois/proposals", token, doc).first shouldBe 400
    }

    @Test
    fun `제안 수신도 인증이 필요하다`() {
        call(HttpMethod.POST, "/internal/pois/proposals", null, """{"source":"TOURAPI","proposals":[]}""")
            .first shouldBe 401
    }

    // ── 미포함 정리(TRIP-1227) ───────────────────────────────────────────────────────────────
    // 출처는 LOCALDATA 로 둔다 — 다른 IT 가 거의 쓰지 않는 출처다. 그래도 공유 컨테이너라 남의 행이 있을 수
    // 있어, 목록에는 **지금 DB 의 같은 출처 ACTIVE 전부**를 넣고 내 행만 빼서 보낸다(행수 단언 대신 기준선 대비).

    private val closeMissing = "/internal/pois/close-missing"

    /** 울릉도 한 점 — 다른 IT 의 POI 와 반경이 겹치지 않는다. */
    private fun ingestAtUlleung(vararg refs: String, source: String = "LOCALDATA", registered: Int = refs.size) {
        val proposals = refs.joinToString(",") { ref ->
            """{"poi":{"name":"미포함정리-$ref","category":"FOOD","coord":{"lat":37.4844,"lng":130.9057}},
               "region":"울릉군","provenance":{"content_id":"$ref","address":"경상북도 울릉군 울릉읍 도동리 1"}}"""
        }
        val (rc, body) = call(
            HttpMethod.POST, "/internal/pois/proposals", SERVICE_TOKEN,
            """{"schema_version":1,"source":"$source","proposals":[$proposals]}""",
        )
        rc shouldBe 200
        body["registered"].asInt() shouldBe registered
    }

    private fun activeLocaldataRefs(): Set<String> = cleanupJdbc.queryForList(
        "SELECT source_ref FROM poi WHERE source = 'LOCALDATA' AND data_status = 'ACTIVE' AND source_ref IS NOT NULL",
        String::class.java,
    ).toSet()

    private fun status(ref: String, source: String = "LOCALDATA"): String = cleanupJdbc.queryForObject(
        "SELECT data_status FROM poi WHERE source = ? AND source_ref = ?", String::class.java, source, ref,
    )!!

    private fun closeBody(refs: Collection<String>, allowMassClose: Boolean = false, dryRun: Boolean = false) =
        """{"source":"LOCALDATA","present_source_refs":[${refs.joinToString(",") { "\"$it\"" }}],""" +
            """"allow_mass_close":$allowMassClose,"dry_run":$dryRun}"""

    /** 가장 위험한 쓰기라 세 문을 다 확인한다 — 무인증·틀린 토큰·사용자 JWT. */
    @Test
    fun `미포함 정리도 서비스 토큰만 받는다`() {
        val body = closeBody(emptyList())
        call(HttpMethod.POST, closeMissing, null, body).first shouldBe 401
        call(HttpMethod.POST, closeMissing, "wrong-token", body).first shouldBe 401

        val rc = RestClient.builder().baseUrl("http://localhost:$port").build()
            .post().uri(closeMissing)
            .header("Authorization", "Bearer ${newToken()}")
            .contentType(MediaType.APPLICATION_JSON).body(body)
            .retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java).statusCode.value()
        rc shouldBe 403
    }

    /**
     * 수신은 upsert 뿐이라 원본에서 빠진 수집분이 ACTIVE 로 남는다 — 그 출처의 식별자 전부를 받아(스크립트는
     * 그 문서를 적재하기 전에 보낸다) 목록에 없는 ACTIVE 만 LOST 로 닫는다. 응답 숫자만 믿지 않고 DB 상태와 읽기 경계(후보풀 쪽)까지
     * 보고, 다음 문서에 다시 나오면 적재가 되살리는 것까지 실 DB 로 잇는다.
     */
    @Test
    fun `미포함 정리 — 문서에 없는 수집분만 LOST 로 내리고 숫자로 알린다 · 다시 나오면 되살아난다`() {
        ingestAtUlleung("E2E-CM-1", "E2E-CM-2", "E2E-CM-3", "E2E-CM-9")
        ingestAtUlleung("E2E-CM-T1", source = "TOURAPI")   // 같은 반경의 다른 출처 — 이 문서와 무관하다
        // 폐업 판정(CLOSED) 행 — 목록에 없어도 손대지 않는다(시각이 그대로 남는다).
        cleanupJdbc.update(
            "UPDATE poi SET data_status = 'CLOSED', updated_at = '2026-01-01T00:00:00Z' " +
                "WHERE source = 'LOCALDATA' AND source_ref = 'E2E-CM-9'",
        )
        val before = activeLocaldataRefs()

        // 드라이런(스크립트의 --dry-run --close-missing) — 같은 숫자를 돌려주되 아무것도 바꾸지 않는다.
        val (drc, dry) = call(HttpMethod.POST, closeMissing, SERVICE_TOKEN, closeBody(before - "E2E-CM-3", dryRun = true))
        drc shouldBe 200
        dry["closed"].asInt() shouldBe 1
        dry["closedSourceRefs"].map { it.asText() } shouldBe listOf("E2E-CM-3")
        status("E2E-CM-3") shouldBe "ACTIVE"

        val (rc, res) = call(HttpMethod.POST, closeMissing, SERVICE_TOKEN, closeBody(before - "E2E-CM-3"))

        rc shouldBe 200
        res["source"].asText() shouldBe "LOCALDATA"
        res["activeBefore"].asInt() shouldBe before.size
        res["present"].asInt() shouldBe before.size - 1
        res["closed"].asInt() shouldBe 1
        // 되돌리기 열쇠 — 다시 부을 문서가 없을 때 이 식별자로 LOST → ACTIVE 를 되돌린다(스크립트가 되돌리기 SQL 로 남긴다).
        res["closedSourceRefs"].map { it.asText() } shouldBe listOf("E2E-CM-3")
        status("E2E-CM-3") shouldBe "LOST"
        status("E2E-CM-1") shouldBe "ACTIVE"
        status("E2E-CM-T1", source = "TOURAPI") shouldBe "ACTIVE"
        cleanupJdbc.queryForObject(
            "SELECT updated_at = '2026-01-01T00:00:00Z' FROM poi WHERE source = 'LOCALDATA' AND source_ref = 'E2E-CM-9'",
            Boolean::class.java,
        ) shouldBe true

        // 후보풀이 읽는 경계에서 사라졌는가 — LOST 를 세는 것과 "추천에 안 나온다"는 다른 확인이다.
        val (_, nearby) = call(HttpMethod.GET, "/internal/pois?centerLat=37.4844&centerLng=130.9057&radiusKm=1", SERVICE_TOKEN)
        val names = nearby.map { it["name_ko"].asText() }
        names.contains("미포함정리-E2E-CM-1") shouldBe true
        names.contains("미포함정리-E2E-CM-3") shouldBe false

        // 같은 요청을 다시 보내도 더 닫히지 않는다 — 적재가 중간에 끊기면 같은 명령을 다시 돈다.
        val (_, again) = call(HttpMethod.POST, closeMissing, SERVICE_TOKEN, closeBody(before - "E2E-CM-3"))
        again["closed"].asInt() shouldBe 0
        again["activeBefore"].asInt() shouldBe before.size - 1

        // 다음 문서에 다시 나오면 적재가 되살린다 — 빠지는 이유 대부분은 폐업이 아니다. 폐업 판정(CLOSED)은 그대로다.
        ingestAtUlleung("E2E-CM-3", "E2E-CM-9", registered = 0)
        status("E2E-CM-3") shouldBe "ACTIVE"
        status("E2E-CM-9") shouldBe "CLOSED"
    }

    /**
     * 부분 문서(청크 하나·회차 한 장·다른 출처 목록)를 "전부"로 받으면 출처가 통째로 닫힌다 — 409 로 막고 아무것도
     * 바꾸지 않는다. 의도한 대량 정리는 `allow_mass_close` 로만 통과한다(와이어 키 이름까지 여기서 못 박는다).
     *
     * 남의 행이 몇 개든 비율이 절반 미만이 되도록 내 행을 그 두 배보다 많이 만든다.
     */
    @Test
    fun `미포함 정리 — 목록이 절반 미만이면 409 로 아무것도 닫지 않고 allow_mass_close 로만 통과한다`() {
        val others = activeLocaldataRefs().size
        val mine = (1..2 * others + 4).map { "E2E-CM-MASS-$it" }
        ingestAtUlleung(*mine.toTypedArray())
        val listed = activeLocaldataRefs() - mine.drop(1).toSet()   // 남의 행 + 내 첫 행만

        val (rc, err) = call(HttpMethod.POST, closeMissing, SERVICE_TOKEN, closeBody(listed))

        rc shouldBe 409
        err["error"]["code"].asText() shouldBe "CONFLICT"
        call(HttpMethod.POST, closeMissing, SERVICE_TOKEN, closeBody(listed, dryRun = true)).first shouldBe 409
        mine.forEach { status(it) shouldBe "ACTIVE" }

        val (ok, res) = call(HttpMethod.POST, closeMissing, SERVICE_TOKEN, closeBody(listed, allowMassClose = true))

        ok shouldBe 200
        res["closed"].asInt() shouldBe mine.size - 1
        status(mine.first()) shouldBe "ACTIVE"
        mine.drop(1).forEach { status(it) shouldBe "LOST" }
    }

    @Test
    fun `미포함 정리 — MANUAL·모르는 출처·목록 누락은 400 이고 아무것도 닫지 않는다`() {
        ingestAtUlleung("E2E-CM-BAD-1")

        // 시드(수동 등록분)는 문서에서 온 것이 아니다 — 플래그를 붙여도 받지 않는다.
        call(HttpMethod.POST, closeMissing, SERVICE_TOKEN, """{"source":"MANUAL","present_source_refs":[],"allow_mass_close":true}""")
            .first shouldBe 400
        call(HttpMethod.POST, closeMissing, SERVICE_TOKEN, """{"source":"NAVER_MAP","present_source_refs":[]}""")
            .first shouldBe 400
        // 목록이 빠진 요청이 "빈 목록"으로 읽히면 출처 전량이 닫힌다 — 기본값을 두지 않았다.
        // (키를 **틀리게** 적은 경우는 MVC 매퍼가 모르는 키를 거부해 따로 막힌다 — 여기서 재는 것은 "빠진" 경우다.)
        call(HttpMethod.POST, closeMissing, SERVICE_TOKEN, """{"source":"LOCALDATA","allow_mass_close":true}""")
            .first shouldBe 400

        status("E2E-CM-BAD-1") shouldBe "ACTIVE"
        cleanupJdbc.queryForObject("SELECT data_status FROM poi WHERE poi_id = ?::uuid", String::class.java, seongsan) shouldBe "ACTIVE"
    }

}
