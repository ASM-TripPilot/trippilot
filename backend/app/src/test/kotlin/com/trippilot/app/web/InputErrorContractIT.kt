package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.withClue
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotBeBlank
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.context.TestPropertySource
import org.springframework.web.client.RestClient
import java.net.URI
import java.time.Instant
import java.util.UUID

/**
 * 클라이언트 입력 오류가 **4xx 로 나가는가**(UUID-PATH-400).
 *
 * 실측(2026-09-01, 수정 전): 아래 셋이 전부 `500 INTERNAL` 이었다.
 * - `GET /api/v1/trips/not-a-uuid` — 경로변수 타입 변환 실패
 * - `GET /internal/pois?centerLat=abc…` — 쿼리 타입 변환 실패
 * - `GET /internal/pois` 에서 `radiusKm` 누락 — 필수 파라미터 누락
 *
 * 왜 중요한가: 프론트·AI 의 재시도·폴백 판단이 5xx 기준으로 갈린다. 자기 입력이 틀린 것을
 * 서버 장애로 읽으면 **잘못된 갈래를 탄다** — TRIP-249 3번(미매핑 경로 500)과 같은 실패 형태다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = ["trippilot.service-auth.token=" + SERVICE_TOKEN])
class InputErrorContractIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()

    private fun newToken(): String {
        val account = accounts.save(
            Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z")),
        )
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    /** 사용자 JWT 로 부르는 공개 표면. */
    private fun asUser(path: String): Pair<Int, JsonNode> = call(path, "Authorization" to "Bearer ${newToken()}")

    /** 서비스 토큰으로 부르는 내부 경계. */
    private fun asService(path: String): Pair<Int, JsonNode> = call(path, "X-Service-Token" to SERVICE_TOKEN)

    private fun call(path: String, header: Pair<String, String>): Pair<Int, JsonNode> {
        val res = RestClient.builder().baseUrl("http://localhost:$port").build()
            .get().uri(path).header(header.first, header.second)
            .retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        return res.statusCode.value() to parse(res.body)
    }

    /** 본문을 싣는 사용자 호출. [body] 는 손으로 쓴 JSON 이다 — `\u0000` 이스케이프를 그대로 보내려고 직렬화를 거치지 않는다. */
    private fun send(method: HttpMethod, path: String, body: String, token: String = newToken()): Pair<Int, JsonNode> {
        val res = RestClient.builder().baseUrl("http://localhost:$port").build()
            .method(method).uri(path).header("Authorization", "Bearer $token")
            .contentType(MediaType.APPLICATION_JSON).body(body)
            .retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        return res.statusCode.value() to parse(res.body)
    }

    /** 경로·질의에 퍼센트 인코딩을 **그대로** 싣는다 — 문자열 uri 는 `%` 를 다시 인코딩해 `%2500` 이 된다. */
    private fun rawGet(rawPathAndQuery: String): Pair<Int, JsonNode> {
        val res = RestClient.builder().build()
            .get().uri(URI.create("http://localhost:$port$rawPathAndQuery")).header("Authorization", "Bearer ${newToken()}")
            .retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        return res.statusCode.value() to parse(res.body)
    }

    private fun parse(body: String?): JsonNode =
        body?.takeIf { it.isNotBlank() }?.let { runCatching { json.readTree(it) }.getOrNull() } ?: json.createObjectNode()

    @Test
    fun `UUID 경로변수가 형식에 안 맞으면 400 이다`() {
        val (status, body) = asUser("/api/v1/trips/not-a-uuid")

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
        // 어느 파라미터가 문제인지 알려야 클라이언트가 고칠 수 있다.
        body["error"]["fields"][0]["field"].asText() shouldBe "tripId"
        // ADR-0011 — 봉투는 어떤 갈래로 가든 지킨다.
        body["error"]["traceId"].asText().shouldNotBeBlank()
    }

    @Test
    fun `숫자 쿼리가 형식에 안 맞으면 400 이다`() {
        val (status, body) = asService("/internal/pois?centerLat=abc&centerLng=126.9&radiusKm=3")

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
        body["error"]["fields"][0]["field"].asText() shouldBe "centerLat"
    }

    @Test
    fun `필수 쿼리가 없으면 400 이다`() {
        val (status, body) = asService("/internal/pois?centerLat=33.4&centerLng=126.9")

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
        body["error"]["fields"][0]["field"].asText() shouldBe "radiusKm"
    }

    /**
     * 보낸 값을 응답에 되비추지 않는다(SECURITY-15). 어느 파라미터인지만 알리면 고칠 수 있고,
     * 임의 문자열을 그대로 반사하면 응답이 입력의 통로가 된다.
     */
    @Test
    fun `틀린 값 자체는 응답에 실리지 않는다`() {
        val marker = "probe-${UUID.randomUUID()}"

        val body = asUser("/api/v1/trips/$marker").second

        body.toString().contains(marker) shouldBe false
    }

    /**
     * 대조군 — 이 변경이 **정상 요청**이나 다른 4xx 갈래를 건드리지 않았다.
     * 형식이 맞는 UUID 는 타입변환을 통과하므로 여기 오지 않고 도메인 판정(404)으로 간다.
     */
    @Test
    fun `형식이 맞는 UUID 는 400 이 아니라 도메인 판정으로 간다`() {
        val (status, _) = asUser("/api/v1/trips/${UUID.randomUUID()}")

        (status == 400) shouldBe false
    }

    /** 대조군 — 매핑 없는 경로의 404 는 그대로다(TRIP-249 3번 회귀 금지). */
    @Test
    fun `매핑 없는 경로는 여전히 404 다`() {
        val (status, body) = call(
            "/api/v1/auth/social/does-not-exist-${UUID.randomUUID()}/nope",
            "X-Service-Token" to SERVICE_TOKEN,
        )

        status shouldBe 404
        body["error"]["code"].asText() shouldBe "RESOURCE_NOT_FOUND"
    }


    // ── TRIP-1473 · NUL(U+0000) — 요청을 읽는 자리에서 400 ──────────────────────────────────────
    //
    // 실측(수정 전): 값·키·질의의 NUL 이 전부 500 INTERNAL 이었다 — PostgreSQL 이 text 에 NUL 을 못 넣고 jsonb 도
    // `\u0000` 을 못 받는다. 요청 본문·질의의 NUL 은 언제나 클라이언트가 보낸 값이다.

    @Test
    fun `본문 문자열 값에 NUL 이 있으면 400 이다`() {
        val (status, body) = send(HttpMethod.POST, "/api/v1/trips", trip(""""title":"a\u0000b","""))

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
        body["error"]["traceId"].asText().shouldNotBeBlank()
    }

    /** `Map` 의 키는 String 역직렬화기를 지나지 않는다 — 값만 보는 방식이면 여기서 샌다. */
    @Test
    fun `본문 객체의 키에 NUL 이 있어도 400 이다`() {
        val (status, body) = send(HttpMethod.POST, "/api/v1/trips", trip(""""preferenceSnapshot":{"k\u0000":1},"""))

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
    }

    /**
     * `JsonNode` 로 받는 본문도 같은 관문을 지난다. 수정 전에도 400 이었지만 어휘 판정이 받은 값을 **NUL 째 되비췄다**
     * (`허용되지 않은 값: a\u0000`) — 이제는 값을 해석하기 전에 막혀 되비출 것이 없다.
     */
    @Test
    fun `JsonNode 본문의 NUL 도 읽는 자리에서 막혀 응답에 되비치지 않는다`() {
        val (status, body) = send(HttpMethod.PUT, "/api/v1/me/preferences", """{"styles":["a\u0000"]}""")

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
        body.toString().contains("\\u0000") shouldBe false
    }

    @Test
    fun `질의 파라미터에 NUL 이 있으면 400 이다`() {
        val (status, body) = rawGet("/api/v1/regions?q=a%00b")

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
        body["error"]["traceId"].asText().shouldNotBeBlank()
    }

    /**
     * 파라미터 **이름**의 NUL 은 보안 방화벽이 이름을 읽는 순간 거부한다. 수정 전에는 그 예외가 미처리 갈래로 떨어져
     * **500** 이었고, 예외 메시지에 실린 이름 원문이 error 로그에 남았다.
     */
    @Test
    fun `질의 파라미터 이름에 NUL 이 있으면 400 이고 이름을 되비추지 않는다`() {
        val (status, body) = rawGet("/api/v1/regions?probe%00name=a")

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
        body["error"]["traceId"].asText().shouldNotBeBlank()
        body.toString().contains("probe") shouldBe false
    }

    /**
     * 필터 체인에서 방화벽이 거부하는 경로(`;`)도 같은 400 봉투다. 수정 전에는 기본 처리의 오류 디스패치가 인증 필터를
     * 다시 타지 않아 **유효한 토큰을 실어도 401**(본문 없음)이었다 — 클라이언트가 토큰 만료로 읽는다.
     */
    @Test
    fun `방화벽이 거부한 경로는 401 이 아니라 400 봉투다`() {
        // 세미콜론·이중 슬래시·인코딩된 퍼센트·상위 경로 — 수정 전에는 넷 다 401 이었다.
        listOf("/api/v1/regions;probe=1", "/api/v1//probe/regions", "/api/v1/stays/probe%25b", "/api/v1/probe/../regions")
            .forEach { path ->
                val (status, body) = rawGet(path)

                withClue(path) {
                    status shouldBe 400
                    body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
                    body["error"]["traceId"].asText().shouldNotBeBlank()
                    body.toString().contains("probe") shouldBe false
                }
            }
    }

    /** 대조군 — 경로의 `%00` 은 Tomcat 이 스프링 앞에서 400 으로 막는다(봉투 없이). 이 변경이 닿지 않는 갈래다. */
    @Test
    fun `경로의 NUL 은 Tomcat 이 막는다 — 대조군`() {
        rawGet("/api/v1/stays/a%00b").first shouldBe 400
    }

    /**
     * 장소 목록 커서는 base64 다 — 풀린 정렬 키가 SQL 인자로 간다. 요청 관문은 base64 속 NUL 을 볼 수 없어
     * 수정 전에는 500(invalid byte sequence)이었다.
     */
    @Test
    fun `커서를 풀었을 때 NUL 이 있으면 400 이다`() {
        val raw = "0\u001Fa\u0000b\u001F${UUID.randomUUID()}"
        val cursor = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(raw.toByteArray())

        val (status, body) = rawGet("/api/v1/places?region=%EC%A0%9C%EC%A3%BC&cursor=$cursor")

        status shouldBe 400
        body["error"]["fields"].map { it["field"].asText() } shouldBe listOf("cursor")
    }

    /**
     * 회고 카드는 **문자열 속 JSON** 이다 — 바깥 본문에는 `\\u0000`(글자 여섯 개)으로 와서 관문을 지나고, 카드를 다시
     * 읽을 때 진짜 NUL 로 풀린다. 수정 전에는 jsonb 가 거부해 500 이었다.
     */
    @Test
    fun `회고 카드 속 JSON 의 NUL 도 400 이다`() {
        val token = newToken()
        val tripId = send(HttpMethod.POST, "/api/v1/trips", trip(""), token).second["tripId"].asText()

        val (status, body) = send(
            HttpMethod.PUT, "/api/v1/trips/$tripId/reflections/2026-12-01",
            """{"card":"{\"cover\":{\"title\":\"a\\u0000b\"}}"}""", token,
        )

        status shouldBe 400
        body["error"]["fields"].map { it["field"].asText() } shouldBe listOf("card")
    }

    /**
     * 회고 카드 상한 20000자(코드 포인트) — openapi 가 약속해 온 값이다. 수정 전에는 검사가 없어 20001자도 받았다.
     * 카드는 JSON 원문 전체 길이로 센다.
     */
    @Test
    fun `회고 카드는 20000자까지 받고 20001자는 400 이다`() {
        val token = newToken()
        val tripId = send(HttpMethod.POST, "/api/v1/trips", trip(""), token).second["tripId"].asText()
        fun card(length: Int): String {
            val shell = """{"cover":{"title":"t"},"pad":""}"""
            return shell.replace("\"pad\":\"\"", "\"pad\":\"${"가".repeat(length - shell.length)}\"")
        }
        fun put(card: String) = send(
            HttpMethod.PUT, "/api/v1/trips/$tripId/reflections/2026-12-01", json.writeValueAsString(mapOf("card" to card)), token,
        )

        put(card(20000)).first shouldBe 200
        val over = put(card(20001))
        over.first shouldBe 400
        over.second["error"]["fields"].map { it["field"].asText() } shouldBe listOf("card")
    }

    /**
     * 대조군 — 과잉 거부가 아니다. 유니코드 이스케이프(`é`)·제어 문자 이스케이프(`\n`·`\t`)는 그대로 통과하고,
     * `\\u0000`(역슬래시가 이스케이프된 **글자** 여섯 개)은 NUL 이 아니다. 본문은 raw 문자열이라 이스케이프가 JSON 에 그대로 실린다.
     */
    @Test
    fun `NUL 이 아닌 이스케이프와 글자 그대로의 백슬래시 u0000 은 통과한다 — 대조군`() {
        val (status, body) = send(HttpMethod.POST, "/api/v1/trips", trip(""""title":"café\n\t\\u0000","""))

        status shouldBe 201
        body["title"].asText() shouldBe "café\n\t\\u0000"
    }

    // ── TRIP-1473 · 길이 초과(22001) — 전역 매핑하지 않고 요청 필드마다 컬럼 폭으로 막는다 ─────────────────
    //
    // 실측(수정 전): 저장 숙소 등록만 409("이미 저장한 숙소입니다" — 서비스의 경합 처리가 22001 을 중복으로 읽었다)이고
    // 나머지는 전부 500 INTERNAL 이었다. 사진·메모·푸시 토큰은 `@Size` 가 달려 있었지만 본문에 `@Valid` 가 없어
    // 검사되지 않았고, 도메인 require 나 저장에서 터졌다.
    // 상한이 빠진 필드를 새로 만들면 RequestStringBoundGateTest 가 멈춘다.

    @Test
    fun `여행 제목이 컬럼 폭을 넘으면 400 이고 폭까지는 받는다`() {
        val over = send(HttpMethod.POST, "/api/v1/trips", trip(""""title":"${"가".repeat(121)}","""))
        val atCap = send(HttpMethod.POST, "/api/v1/trips", trip(""""title":"${"가".repeat(120)}","""))

        over.first shouldBe 400
        over.second["error"]["fields"].map { it["field"].asText() } shouldBe listOf("title")
        atCap.first shouldBe 201
    }

    /**
     * 상한은 **문자(코드 포인트)** 로 센다 — `varchar(120)` 과 openapi `maxLength` 의 단위다. UTF-16 으로 세면 이모지 61개
     * 제목이 122 로 세어져 400 이었다.
     */
    @Test
    fun `제목 상한은 이모지도 한 글자로 센다`() {
        val wave = "🌊" // 🌊 — UTF-16 으로는 두 단위

        send(HttpMethod.POST, "/api/v1/trips", trip(""""title":"${wave.repeat(120)}",""")).first shouldBe 201
        send(HttpMethod.POST, "/api/v1/trips", trip(""""title":"${wave.repeat(121)}",""")).first shouldBe 400
    }

    /** 생성은 카탈로그 판정이 모르는 이름을 막지만 편집은 그 판정을 거치지 않는다 — 상한이 유일한 관문이다. */
    @Test
    fun `여행 편집의 목적지 이름이 컬럼 폭을 넘으면 400 이다`() {
        val token = newToken()
        val tripId = send(HttpMethod.POST, "/api/v1/trips", trip(""), token).second["tripId"].asText()

        val (status, body) = send(
            HttpMethod.PATCH, "/api/v1/trips/$tripId",
            """{"startDate":"2026-12-01","endDate":"2026-12-03","party":2,"destinations":[{"seq":0,"region":"${"가".repeat(61)}","nights":2}]}""",
            token,
        )

        status shouldBe 400
        body["error"]["fields"].map { it["field"].asText() } shouldBe listOf("destinations[0].region")
    }

    @Test
    fun `저장 숙소의 이름·메모·외부 출처·외부 식별자가 컬럼 폭을 넘으면 400 이고 폭까지는 받는다`() {
        fun register(name: Int, memo: Int, source: Int, id: Int) = send(
            HttpMethod.POST, "/api/v1/saved-stays",
            """{"name":"${"가".repeat(name)}","registerRoute":"PIN","memo":"${"가".repeat(memo)}",
                "externalSource":"${"s".repeat(source)}","externalId":"${"i".repeat(id)}"}""",
        )

        val over = register(201, 501, 41, 121)
        over.first shouldBe 400
        over.second["error"]["fields"].map { it["field"].asText() }.toSet() shouldBe
            setOf("name", "memo", "externalSource", "externalId")
        register(200, 500, 40, 120).first shouldBe 201
    }

    @Test
    fun `저장 숙소 편집도 같은 상한이다`() {
        val token = newToken()
        val id = send(HttpMethod.POST, "/api/v1/saved-stays", """{"name":"숙소","registerRoute":"PIN"}""", token)
            .second["savedStayId"].asText()

        val (status, body) = send(
            HttpMethod.PATCH, "/api/v1/saved-stays/$id",
            """{"name":"${"가".repeat(201)}","memo":"${"가".repeat(501)}"}""", token,
        )

        status shouldBe 400
        body["error"]["fields"].map { it["field"].asText() }.toSet() shouldBe setOf("name", "memo")
    }

    @Test
    fun `방문 체크의 슬롯 키가 컬럼 폭을 넘으면 도착·건너뛰기 모두 400 이다`() {
        val token = newToken()
        val tripId = send(HttpMethod.POST, "/api/v1/trips", trip(""), token).second["tripId"].asText()
        val longKey = "2026-12-01#" + "k".repeat(90) // 101자

        val arrive = send(
            HttpMethod.POST, "/api/v1/trips/$tripId/visits",
            """{"slotKey":"$longKey","poiId":"${UUID.randomUUID()}","source":"MANUAL"}""", token,
        )
        val skip = send(
            HttpMethod.POST, "/api/v1/trips/$tripId/visits/skip-planned",
            """{"slotKey":"$longKey","poiId":"${UUID.randomUUID()}"}""", token,
        )

        arrive.first shouldBe 400
        arrive.second["error"]["fields"].map { it["field"].asText() } shouldBe listOf("slotKey")
        skip.first shouldBe 400
        skip.second["error"]["fields"].map { it["field"].asText() } shouldBe listOf("slotKey")
    }

    @Test
    fun `방문 사진의 자산 식별자와 메모가 상한을 넘으면 400 이다`() {
        val token = newToken()
        val tripId = send(HttpMethod.POST, "/api/v1/trips", trip(""), token).second["tripId"].asText()
        val visitId = send(
            HttpMethod.POST, "/api/v1/trips/$tripId/visits",
            """{"poiId":"${UUID.randomUUID()}","source":"MANUAL"}""", token,
        ).second["visitCheckId"].asText()
        val base = "/api/v1/trips/$tripId/visits/$visitId"

        val photo = send(HttpMethod.POST, "$base/photos", """{"localAssetId":"${"a".repeat(201)}","deviceId":"d"}""", token)
        val memo = send(HttpMethod.PUT, "$base/memo", """{"text":"${"가".repeat(2001)}"}""", token)

        photo.first shouldBe 400
        photo.second["error"]["fields"].map { it["field"].asText() } shouldBe listOf("localAssetId")
        memo.first shouldBe 400
        memo.second["error"]["fields"].map { it["field"].asText() } shouldBe listOf("text")
    }

    @Test
    fun `푸시 토큰과 기기 식별자가 상한을 넘으면 400 이다`() {
        val (status, body) = send(
            HttpMethod.POST, "/api/v1/me/push-tokens",
            """{"token":"${"t".repeat(256)}","deviceId":"${"d".repeat(65)}","platform":"IOS"}""",
        )

        status shouldBe 400
        body["error"]["fields"].map { it["field"].asText() }.toSet() shouldBe setOf("token", "deviceId")
    }

    private fun trip(extra: String) =
        """{$extra"startDate":"2026-12-01","endDate":"2026-12-03","party":2,"destinations":[{"seq":0,"region":"제주","nights":2}]}"""
}
