package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource
import org.springframework.http.MediaType
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant

/**
 * 팀 공유 수집본(`ai/data/collected_pois.json`)이 **실제로 들어가는지**.
 *
 * 손으로 만든 픽스처는 내가 이해한 스키마만 검증한다 — 상대가 실제로 떨구는 문서에는 내가 모르는 칸이 있고,
 * 값의 분포도 다르다(1,100여 건 · 전국 17개 지역 · 영업시간 미보유 160건). 그 차이가 수신을 막는지는
 * **실 문서로만** 드러난다.
 *
 * 외부 호출은 0이다 — 파일을 읽어 우리 경계에 태울 뿐이다(CI 정책 유지).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = ["trippilot.service-auth.token=" + SERVICE_TOKEN])
class PoiProposalRealDocumentIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    /**
     * **넣은 것을 치운다.** Testcontainers 는 전 IT 가 공유하는 싱글톤이고 이 테스트는 HTTP 로 서버에
     * 쓰기 때문에 트랜잭션 롤백이 닿지 않는다. 치우지 않으면 ACTIVE POI 1,100여 건이 뒤에 도는 모든 IT 의
     * **후보풀에 그대로 남는다** — 일정 생성이 고르는 장소가 달라지고, 실패가 테스트 순서에 따라 갈린다.
     *
     * 수동 등록분(source_ref IS NULL)은 시드라 건드리지 않는다.
     */
    @AfterEach
    fun cleanUpIngested() {
        jdbc.update("DELETE FROM poi WHERE source_ref IS NOT NULL")
    }

    private val json = ObjectMapper()

    private fun post(path: String, token: String, body: String): Pair<Int, JsonNode> {
        val res = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .post().uri(path)
            .header("X-Service-Token", token)   // /internal 은 서비스 토큰만 받는다(TRIP-393)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        return res.statusCode.value() to (res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode())
    }

    private fun newToken(): String =
        accessTokenIssuer.issue(
            accounts.save(
                Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z")),
            ).id.value.toString(),
        ).value

    /**
     * 리포 루트를 위로 걸어 찾는다 — Gradle 테스트의 작업 디렉토리는 모듈마다 다르다.
     * **없으면 실패시킨다.** 건너뛰면 공유본이 사라져도 아무도 모른다(조용한 통과 금지).
     */
    private fun sharedDocument(): Path {
        var dir: Path? = Path.of("").toAbsolutePath()
        while (dir != null) {
            val candidate = dir.resolve("ai/data/collected_pois.json")
            if (Files.exists(candidate)) return candidate
            dir = dir.parent
        }
        error("팀 공유 수집본을 찾지 못했습니다: ai/data/collected_pois.json")
    }

    @Test
    fun `실 수집본이 그대로 들어가고 다시 넣어도 행이 늘지 않는다`() {
        val token = SERVICE_TOKEN
        val document = Files.readString(sharedDocument())

        val (rc, first) = post("/internal/pois/proposals", token, document)

        rc shouldBe 200
        val received = first["received"].asInt()
        received shouldBeGreaterThan 500       // 전국 수집분이라 수백 건이다 — 한 자리 수면 문서가 잘린 것이다
        first["registered"].asInt() shouldBeGreaterThan 500

        // 상대 문서의 모든 칸을 우리가 소화한다 — 하나라도 못 읽으면 여기서 탈락으로 드러난다.
        // (탈락이 0이어야 한다는 뜻은 아니다. 아래는 "전부 탈락"이라는 최악을 막는 하한이다.)
        first["registered"].asInt() + first["updated"].asInt() shouldBeGreaterThan received / 2

        // 같은 문서를 다시 — 수집은 매일 돈다. 여기서 늘면 후보풀에 중복이 쌓인다.
        val (_, second) = post("/internal/pois/proposals", token, document)
        second["registered"].asInt() shouldBe 0
        second["updated"].asInt() shouldBe first["registered"].asInt()
    }
}
