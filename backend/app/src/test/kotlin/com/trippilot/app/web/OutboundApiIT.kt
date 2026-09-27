package com.trippilot.app.web

import com.trippilot.affiliatelink.adapter.out.persistence.AffiliateClickJpaRepository
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldStartWith
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.ResponseEntity
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.UUID

/**
 * 아웃바운드 302 E2E (칸 1). 스텁 콘텐츠(제주 5) 기준.
 *
 * JDK HttpClient 는 기본으로 리다이렉트를 **따라가지 않는다** — 302 와 Location 을 그대로
 * 관찰한다(구글로 실호출이 나가지 않는다 — CI 외부호출 0 정책 준수).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OutboundApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var clicks: AffiliateClickJpaRepository

    private val now = Instant.parse("2026-09-27T00:00:00Z")

    private fun get(path: String, bearer: String?): ResponseEntity<String> {
        val spec = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .method(HttpMethod.GET).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        return spec.retrieve()
            .onStatus({ it.is3xxRedirection || it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
    }

    private fun newAccount(): Pair<UUID, String> {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return account.id.value to accessTokenIssuer.issue(account.id.value.toString()).value
    }

    /**
     * 인증 선택 — 브라우저·커스텀탭이 여는 경로라 Authorization 을 못 싣는다.
     * 익명이어도 302 는 나가고, 클릭은 계정 없이(null) 남는다.
     */
    @Test
    fun `무토큰도 302 — 익명 클릭이 남는다`() {
        val before = clicks.findAll().count { it.accountId == null }

        val res = get("/api/v1/stays/STUB:jeju-001/outbound", null)

        res.statusCode.value() shouldBe 302
        res.headers.location.toString() shouldStartWith "https://www.google.com/search?q="
        clicks.findAll().count { it.accountId == null } shouldBe before + 1
    }

    @Test
    fun `302 + Location 웹검색 폴백 + 클릭 행이 남는다`() {
        val (accountId, token) = newAccount()

        val res = get("/api/v1/stays/STUB:jeju-001/outbound?checkin=2026-10-01&checkout=2026-10-03&adults=2", token)

        res.statusCode.value() shouldBe 302
        res.headers.location.toString() shouldBe "https://www.google.com/search?q=" +
            URLEncoder.encode("제주 오션 리조트 예약", StandardCharsets.UTF_8)
        // 본문 없음 — 클릭·전환 지표는 내부 전용(BR-U1-32), 사용자 대면 응답에 싣지 않는다.
        (res.body ?: "") shouldBe ""

        val mine = clicks.findAll().filter { it.accountId == accountId }
        mine.size shouldBe 1
        with(mine.single()) {
            stayId shouldBe "STUB:jeju-001"
            vendor shouldBe "WEBSEARCH"
            checkIn.toString() shouldBe "2026-10-01"
            checkOut.toString() shouldBe "2026-10-03"
            adults shouldBe 2
            postbackStatus shouldBe "NONE"
        }
    }

    @Test
    fun `형식 오류는 400 · 없는 숙소는 404 — 같은 응답으로 접지 않는다`() {
        val (_, token) = newAccount()

        get("/api/v1/stays/콜론없음/outbound", token).statusCode.value() shouldBe 400
        get("/api/v1/stays/STUB:no-such/outbound", token).statusCode.value() shouldBe 404
    }

    /**
     * 쓰레기 파라미터(음수 인원)는 DB CHECK 가 행째 거르고, fail-open 이라 302 는 그대로 나간다.
     * 이 테스트가 지키는 것은 둘의 **결합**이다 — CHECK 만 있고 fail-open 이 없으면 사용자가
     * 500 을 보고, fail-open 만 있으면 협상 지표에 음수 인원이 쌓인다.
     */
    @Test
    fun `음수 인원은 클릭만 버려지고 302 는 산다`() {
        val (accountId, token) = newAccount()

        val res = get("/api/v1/stays/STUB:jeju-001/outbound?adults=-1", token)

        res.statusCode.value() shouldBe 302
        clicks.findAll().count { it.accountId == accountId } shouldBe 0
    }

    /** 리터럴 경로 형제들이 계속 사는지 — `/{stayId}/outbound` 추가가 기존 라우팅을 삼키지 않는다. */
    @Test
    fun `기존 stays 경로 무회귀 — search 는 200 이다`() {
        val (_, token) = newAccount()
        get("/api/v1/stays/search", token).statusCode.value() shouldBe 200
    }
}
