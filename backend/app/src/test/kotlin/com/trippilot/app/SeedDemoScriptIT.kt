package com.trippilot.app

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.web.client.RestClient
import java.io.File
import java.time.Instant
import java.util.concurrent.TimeUnit

/**
 * 데모 시더(`backend/scripts/seed_demo.py`)를 **실제로 실행한다**.
 *
 * 왜 테스트로 도나: 시더는 로그인 토큰을 인자로 받는데, JWT 서명 키가 **기동마다 새로 생성**되어
 * (`JwtSecurityConfig.rsaKey`) 밖에서 토큰을 만들 수 없다. 실 소셜 로그인은 브라우저 OAuth 라
 * 자동화가 안 된다. 여기서는 **앱을 띄운 그 컨텍스트가 토큰을 발급**하므로 그 벽이 사라진다.
 *
 * 여기서만 드러나는 것: 정적 대조(경로·요청 필드가 openapi 에 있는가)는 **응답을 파싱하는 코드**를
 * 검증하지 못한다. `trip["tripId"]` 같은 응답 필드 이름이 틀렸거나, 여행 생성 시 날짜·박수 검증에
 * 걸리는 것은 실행해야 드러난다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SeedDemoScriptIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()

    @Test
    fun `시더가 끝까지 돌고 시나리오만큼 여행이 생긴다`() {
        val script = repoFile("backend/scripts/seed_demo.py")
        assumeTrue(python3() != null, "python3 가 없어 건너뜁니다")

        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.now()))
        val token = accessTokenIssuer.issue(account.id.value.toString()).value

        val process = ProcessBuilder(
            python3()!!, script.absolutePath,
            "--token", token,
            "--base-url", "http://localhost:$port/api/v1",
        ).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        val finished = process.waitFor(SCRIPT_TIMEOUT_SEC, TimeUnit.SECONDS)

        println(output)
        finished shouldBe true
        // 실패를 삼키지 않는다 — 시더가 반쪽만 만들고 0 으로 끝나면 데모에서야 드러난다.
        process.exitValue() shouldBe 0

        // 시나리오 수만큼 여행이 생겼는지 — 스크립트의 자기 보고가 아니라 **서버 상태**로 확인한다.
        val trips = RestClient.create().method(HttpMethod.GET)
            .uri("http://localhost:$port/api/v1/trips")
            .header("Authorization", "Bearer $token")
            .retrieve().body(String::class.java)
        val created = json.readTree(trips)
        assertThat(created.map { it["title"].asText() }).hasSize(SCENARIO_COUNT)
        assertThat(created.map { it["title"].asText() }).allMatch { it.startsWith("[데모]") }

        // 시나리오가 **약속한 상태**까지 도달했는지 — 여행이 생겼다는 것만으로는 화면이 열리지 않는다.
        fun tripOf(marker: String) = created.first { it["title"].asText().contains(marker) }["tripId"].asText()

        // s2 겹침 미해소 — 해소 시트를 띄울 수 있어야 한다(차단 + 후보 목록).
        val blocked = get("/trips/${tripOf("겹침 미해소")}/coverage", token)
        blocked["blocked"].asBoolean() shouldBe true
        assertThat(blocked["days"][0]["candidates"]).hasSize(2)

        // s4 확정 — 읽기전용 화면의 전제.
        get("/trips/${tripOf("확정 완료")}/itinerary", token)["status"].asText() shouldBe "CONFIRMED"

        // s5 여행 중 — 오늘이 기간 안이고 방문 실적이 남아야 Plan-B 화면이 열린다.
        val onTrip = tripOf("여행 중")
        val today = java.time.LocalDate.now().toString()
        assertThat(get("/trips/$onTrip/visits/days/$today", token)["visits"]).isNotEmpty()

        // s7 해소 후 생성 — 겹쳤지만 사용자가 골라 차단이 풀린 상태(TRIP-190 결말).
        val resolved = get("/trips/${tripOf("해소 후 생성")}/coverage", token)
        resolved["blocked"].asBoolean() shouldBe false
        resolved["days"][0]["resolution"].asText() shouldBe "USER_PICK"
    }

    private fun get(path: String, token: String) = json.readTree(
        RestClient.create().method(HttpMethod.GET)
            .uri("http://localhost:$port/api/v1$path")
            .header("Authorization", "Bearer $token")
            .retrieve().body(String::class.java),
    )

    private fun python3(): String? = listOf("/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3")
        .firstOrNull { File(it).canExecute() }

    /** 리포 안 파일 — 모듈 위치가 바뀌어도 견디도록 위로 올라가며 찾는다. */
    private fun repoFile(relative: String): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.isFile) return candidate
            dir = dir.parentFile
        }
        error("파일을 찾지 못했습니다: $relative")
    }

    private companion object {
        /** s1~s7 — 시나리오를 늘리면 여기도 함께 늘린다(개수가 조용히 줄면 이 테스트가 잡는다). */
        private const val SCENARIO_COUNT = 7
        private const val SCRIPT_TIMEOUT_SEC = 180L
    }
}
