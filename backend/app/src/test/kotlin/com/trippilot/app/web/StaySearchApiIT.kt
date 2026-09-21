package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.collections.shouldContainExactly
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Instant

/**
 * TRIP-175 — 숙소 탐색 API E2E. 스텁 콘텐츠(제주 5) + R__ 시드 최저가 → 최저가순·필터·가격 결합.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class StaySearchApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-07-26T00:00:00Z")

    private fun get(path: String, bearer: String?): Pair<Int, JsonNode> {
        val spec = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .method(HttpMethod.GET).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        val res = spec.retrieve()
            .onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun newToken(): String {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun ids(body: JsonNode) = body["items"].map { it["externalId"].asText() }

    @Test
    fun `인증 없으면 401`() {
        get("/api/v1/stays/search", null).first shouldBe 401
    }

    @Test
    fun `탐색은 최저가순 · 모든 항목 가격 결합(시드)`() {
        val (status, body) = get("/api/v1/stays/search", newToken())
        status shouldBe 200
        // 시드 최저가: 002=45k < 005=95k < 004=130k < 003=180k < 001=220k
        ids(body) shouldContainExactly listOf("jeju-002", "jeju-005", "jeju-004", "jeju-003", "jeju-001")
        body["items"].all { it["price"]["amount"].asLong() > 0 } shouldBe true
        body["degraded"].asBoolean() shouldBe false
    }

    @Test
    fun `amenity 필터 AND — 오션뷰는 리조트·비치호텔만`() {
        val (status, body) = get("/api/v1/stays/search?amenity=오션뷰", newToken())
        status shouldBe 200
        ids(body) shouldContainExactly listOf("jeju-003", "jeju-001") // 180k, 220k
    }

    @Test
    fun `stayType 필터 — 게스트하우스`() {
        val (_, body) = get("/api/v1/stays/search?stayType=게스트하우스", newToken())
        ids(body) shouldContainExactly listOf("jeju-002")
    }

    @Test
    fun `필터로 0건이면 완화 후보 반환(BR-U1-16)`() {
        val (_, body) = get("/api/v1/stays/search?amenity=닌텐도", newToken())
        body["items"].size() shouldBe 0
        body["filterZeroReasons"].map { it.asText() } shouldContainExactly listOf("amenity:닌텐도")
    }

    // ── TRIP-202 '내 주변' 좌표 스코프 (US-STAY-01 정상 · BR-U1-11) ──
    // 스텁 5곳의 제주시 시티 호텔(jeju-005, 33.4990/126.5310) 기준 실거리:
    //   004 애월 20.9km · 001 오션 28.3km · 003 중문 30.5km · 002 성산 38.5km

    @Test
    fun `좌표 반경 안의 숙소만 반환한다`() {
        val (status, body) = get("/api/v1/stays/search?lat=33.4990&lng=126.5310&radiusKm=10", newToken())
        status shouldBe 200
        ids(body) shouldContainExactly listOf("jeju-005")
    }

    @Test
    fun `반경을 넓히면 더 들어오고 정렬은 최저가순을 유지한다`() {
        val (_, body) = get("/api/v1/stays/search?lat=33.4990&lng=126.5310&radiusKm=25", newToken())
        // 거리순이면 005(0km)·004(20.9km) 지만 가격순도 005(95k)·004(130k) 라 같다 —
        // 여기서 보는 것은 "반경 확대가 004 를 들여보낸다"이고, 정렬 뒤바뀜은 단위 테스트가 본다.
        ids(body) shouldContainExactly listOf("jeju-005", "jeju-004")
    }

    @Test
    fun `radiusKm 을 안 주면 서버 기본 반경(5km)을 적용한다`() {
        val (status, body) = get("/api/v1/stays/search?lat=33.4990&lng=126.5310", newToken())
        status shouldBe 200
        ids(body) shouldContainExactly listOf("jeju-005")
    }

    @Test
    fun `좌표와 amenity 는 AND`() {
        // 반경 35km 안에 004·001·003 이 들어오지만 오션뷰는 001·003 뿐이다
        val (_, body) = get("/api/v1/stays/search?lat=33.4990&lng=126.5310&radiusKm=35&amenity=오션뷰", newToken())
        ids(body) shouldContainExactly listOf("jeju-003", "jeju-001") // 180k, 220k
    }

    @Test
    fun `lat 만 오면 400 — 부분 좌표를 무시하고 전체 조회로 넘어가지 않는다`() {
        val (status, body) = get("/api/v1/stays/search?lat=33.4990", newToken())
        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
    }

    @Test
    fun `lng 만 와도 400`() {
        get("/api/v1/stays/search?lng=126.5310", newToken()).first shouldBe 400
    }

    @Test
    fun `반경이 0 이하면 400`() {
        get("/api/v1/stays/search?lat=33.4990&lng=126.5310&radiusKm=0", newToken()).first shouldBe 400
    }

    @Test
    fun `위경도 범위를 벗어나면 400`() {
        get("/api/v1/stays/search?lat=91&lng=126.5310", newToken()).first shouldBe 400
        get("/api/v1/stays/search?lat=33.4990&lng=181", newToken()).first shouldBe 400
    }

    // ───────── 상세(US-STAY-03) ─────────

    @Test
    fun `상세는 합성 식별자로 연다 — 목록이 그 값을 그대로 실어 준다`() {
        val token = newToken()
        val (_, list) = get("/api/v1/stays/search?stayType=게스트하우스", token)
        val item = list["items"].single()
        val stayId = "${item["externalSource"].asText()}:${item["externalId"].asText()}"

        val (status, body) = get("/api/v1/stays/$stayId", token)

        status shouldBe 200
        body["stayId"].asText() shouldBe stayId          // 클라이언트가 다시 조립하지 않게 되돌려 준다
        body["name"].asText() shouldBe item["name"].asText()
        body["price"]["amount"].asLong() shouldBe 45_000L
        body["amenities"].map { it.asText() } shouldContainExactly listOf("공용주방", "와이파이")
    }

    /**
     * **템플릿 경로가 기존 리터럴 경로를 삼키지 않는가.** `/stays/{stayId}` 는 `/stays/search`
     * 와 **같은 기저 경로**이고 `/stays/geocode`·`/stays/reverse-geocode` 는 **다른 컨트롤러**에
     * 있다. Spring 이 리터럴을 먼저 잡는다는 규칙에 기대는 것과 그것을 확인하는 것은 다르다 —
     * 삼켜지면 증상이 "숙소 검색이 통째로 404" 라 사용자 영향이 가장 크다.
     */
    @Test
    fun `상세 경로를 더해도 검색·지오코딩이 살아 있다`() {
        val token = newToken()

        get("/api/v1/stays/search", token).first shouldBe 200
        // 지오코딩은 스텁 모드라 빈 결과가 정상 — 여기서 보는 것은 **라우팅이 닿는가**다.
        get("/api/v1/stays/geocode?q=제주", token).first shouldBe 200
        get("/api/v1/stays/reverse-geocode?lat=33.4&lng=126.5", token).first shouldBe 200
    }

    @Test
    fun `없는 숙소는 404`() {
        get("/api/v1/stays/STUB:없는곳", newToken()).first shouldBe 404
    }

    /** 형식 오류와 부재를 같은 응답으로 접지 않는다 — 접으면 조립 실수를 영영 못 본다. */
    @Test
    fun `식별자 형식이 틀리면 400`() {
        get("/api/v1/stays/콜론없음", newToken()).first shouldBe 400
    }

    @Test
    fun `상세도 인증이 필요하다`() {
        get("/api/v1/stays/STUB:jeju-001", null).first shouldBe 401
    }

    /**
     * INV-3 — 소요시간 비표시. US-STAY-03 — 리뷰·평점은 앱 안에 두지 않는다(외부 OTA 위임).
     * 필드가 생기는 순간 화면이 그것을 그리므로, 계약 단에서 막는다.
     */
    @Test
    fun `상세에 소요시간·리뷰·평점 필드가 없다`() {
        val (_, body) = get("/api/v1/stays/STUB:jeju-001", newToken())
        val keys = body.fieldNames().asSequence().toList()   // Jackson 2 — 이 IT 의 매퍼다

        keys.none { k ->
            listOf("duration", "eta", "travel", "review", "rating", "score")
                .any { k.contains(it, ignoreCase = true) }
        } shouldBe true
    }
}
