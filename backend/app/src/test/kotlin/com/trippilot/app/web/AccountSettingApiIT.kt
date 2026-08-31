package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.profile.domain.AccountSettingKey
import com.trippilot.profile.domain.AccountSettingRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import java.time.Instant
import java.util.UUID

/**
 * 계정 단위 앱 설정(TRIP-614 · BR-U6-33).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **복합 PK upsert** — 같은 계정·같은 키를 두 번 저장하면 행이 하나여야 한다. Map 대역은 언제나
 *   덮어써서 "두 행이 생길 수 있다"는 성질 자체가 재현되지 않는다
 * - **계정 파기 CASCADE** — 실제 파기 배치는 아직 없다(auth 이벤트 주석 실측). AC 를 만족시키는 것은
 *   FK 이고, 그것이 실제로 걸렸는지는 계정 행을 지워 봐야만 안다
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AccountSettingApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var settings: AccountSettingRepository

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-07-26T00:00:00Z")

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .method(method).uri(path)
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

    private fun rowCount(accountId: UUID): Int =
        jdbc.queryForObject("SELECT count(*) FROM account_setting WHERE account_id = ?", Int::class.java, accountId)!!

    @Test
    fun `저장한 적 없으면 기본값이 온다 — 404 가 아니다`() {
        val (_, token) = newAccount()

        val (rc, body) = call(HttpMethod.GET, "/api/v1/me/settings", token)

        rc shouldBe 200
        // 404 였다면 첫 진입에서 화면이 설정 목록을 못 그린다.
        body["affiliateNoticeDismissed"].asBoolean() shouldBe false
    }

    @Test
    fun `끄면 저장되고 다시 조회해도 남는다 — 기기가 달라도 같은 값이다`() {
        val (accountId, token) = newAccount()

        call(HttpMethod.PATCH, "/api/v1/me/settings", token, """{"affiliateNoticeDismissed":true}""")
            .first shouldBe 200

        // 다른 기기 = 다른 요청. 계정 단위라 같은 값이어야 한다(BR-U6-33).
        call(HttpMethod.GET, "/api/v1/me/settings", token).second["affiliateNoticeDismissed"].asBoolean() shouldBe true
        rowCount(accountId) shouldBe 1
    }

    @Test
    fun `다시 보기로 되돌릴 수 있다 — l05 토글이 단방향이 아니다`() {
        val (_, token) = newAccount()
        call(HttpMethod.PATCH, "/api/v1/me/settings", token, """{"affiliateNoticeDismissed":true}""")

        val body = call(
            HttpMethod.PATCH, "/api/v1/me/settings", token, """{"affiliateNoticeDismissed":false}""",
        ).second

        body["affiliateNoticeDismissed"].asBoolean() shouldBe false
    }

    @Test
    fun `필드를 생략하면 값이 바뀌지 않는다 — null 은 끄기가 아니다`() {
        val (accountId, token) = newAccount()
        call(HttpMethod.PATCH, "/api/v1/me/settings", token, """{"affiliateNoticeDismissed":true}""")

        val body = call(HttpMethod.PATCH, "/api/v1/me/settings", token, """{}""").second

        // null 을 "false 로 바꿔라"로 읽으면 화면이 한 토글을 만질 때 다른 토글이 조용히 꺼진다.
        body["affiliateNoticeDismissed"].asBoolean() shouldBe true
        rowCount(accountId) shouldBe 1
    }

    @Test
    fun `같은 키를 두 번 저장해도 행은 하나다 — 복합 PK 가 보장한다`() {
        val (accountId, token) = newAccount()

        repeat(3) {
            call(HttpMethod.PATCH, "/api/v1/me/settings", token, """{"affiliateNoticeDismissed":true}""")
        }

        rowCount(accountId) shouldBe 1
    }

    @Test
    fun `계정이 지워지면 설정도 함께 지워진다 — 파기 배치가 없어도 FK 가 보장한다`() {
        val (accountId, token) = newAccount()
        call(HttpMethod.PATCH, "/api/v1/me/settings", token, """{"affiliateNoticeDismissed":true}""")
        rowCount(accountId) shouldBe 1

        // 실제 30일 파기 배치는 아직 없다 — AC 를 지키는 것은 CASCADE 다.
        jdbc.update("DELETE FROM account WHERE account_id = ?", accountId) shouldBe 1

        rowCount(accountId) shouldBe 0
    }

    @Test
    fun `남의 설정은 보이지 않는다`() {
        val (_, mine) = newAccount()
        val (_, other) = newAccount()
        call(HttpMethod.PATCH, "/api/v1/me/settings", mine, """{"affiliateNoticeDismissed":true}""")

        call(HttpMethod.GET, "/api/v1/me/settings", other).second["affiliateNoticeDismissed"].asBoolean() shouldBe false
    }

    @Test
    fun `어휘 밖 키는 응답에 새지 않는다 — 옛 키가 남아도 화면이 모르는 설정을 그리지 않는다`() {
        val (accountId, token) = newAccount()
        call(HttpMethod.PATCH, "/api/v1/me/settings", token, """{"affiliateNoticeDismissed":true}""")

        // 어휘가 바뀌면 옛 키가 행으로 남는다(DB 에 CHECK 를 걸지 않기로 한 대가다).
        // 코드로는 만들 수 없는 상태라 직접 넣는다 — 이 상태를 안 만들면 그 가드가 도는지 알 수 없다.
        jdbc.update(
            "INSERT INTO account_setting (account_id, key, value) VALUES (?, 'legacyDroppedSetting', 'true')",
            accountId,
        ) shouldBe 1

        // **저장소를 직접 묻는다.** 응답만 보면 모르는 키가 아는 키로 잘못 매핑돼도 값이 우연히
        // 같으면 통과한다(실측으로 그렇게 놓쳤다). 게다가 그 판정은 행 순서에 기대 flaky 해진다.
        val kept = settings.findAll(accountId)

        kept.map { it.key } shouldBe listOf(AccountSettingKey.AFFILIATE_NOTICE_DISMISSED)
        // 행 자체는 남는다 — 읽기가 거르는 것이지 지우는 것이 아니다.
        rowCount(accountId) shouldBe 2
        // 표면도 아는 값만 낸다.
        val body = call(HttpMethod.GET, "/api/v1/me/settings", token).second
        body["affiliateNoticeDismissed"].asBoolean() shouldBe true
        body.fieldNames().asSequence().toList() shouldBe listOf("affiliateNoticeDismissed")
    }

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/api/v1/me/settings", null).first shouldBe 401
    }
}
