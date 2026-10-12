package com.trippilot.app

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.springframework.boot.env.YamlPropertySourceLoader
import org.springframework.core.env.MapPropertySource
import org.springframework.core.env.StandardEnvironment
import org.springframework.core.io.FileSystemResource
import java.io.File

/**
 * `KAKAO_APP_ID` 가 앱까지 닿는 통로(TRIP-1317). 형태는 [AppleClientIdWiringTest] 와 같다.
 *
 * 이 값이 중간에 사라지면 **아무것도 빨개지지 않는다** — 발급 앱 대조가 조용히 꺼진 채(기동 경고 한 줄만
 * 남기고) 카카오 로그인은 정상으로 돈다. 그래서 통로 네 구간을 하나씩 잠근다.
 */
class KakaoAppIdWiringTest : StringSpec({

    fun resolve(key: String, env: Map<String, Any>): String? {
        val file = File("src/main/resources/application.yml")
        check(file.exists()) { "본 application.yml 을 못 찾았습니다(작업 디렉토리=${File(".").absolutePath})." }
        val environment = StandardEnvironment()
        environment.propertySources.addFirst(MapPropertySource("주입", env))
        YamlPropertySourceLoader().load("main-application", FileSystemResource(file))
            .forEach { environment.propertySources.addLast(it) }
        return environment.getProperty(key)
    }

    fun repoFile(name: String): File = File("../../$name").takeIf { it.exists() } ?: File("../$name")

    "application.yml 이 KAKAO_APP_ID 를 app-id 로 잇고, 없으면 빈 값이다" {
        resolve("trippilot.social.kakao.app-id", mapOf("KAKAO_APP_ID" to "1519823")) shouldBe "1519823"
        resolve("trippilot.social.kakao.app-id", emptyMap()) shouldBe ""
    }

    // 대조 주소는 환경변수가 아니다. 비면 대조 호출이 빈 주소로 나가 카카오 로그인이 전부 실패한다.
    "토큰 정보 주소가 카카오 실주소로 박혀 있다" {
        resolve("trippilot.social.kakao.token-info-uri", emptyMap()) shouldBe
            "https://kapi.kakao.com/v1/user/access_token_info"
    }

    "compose 가 backend 서비스에 KAKAO_APP_ID 를 넘긴다" {
        val lines = repoFile("docker-compose.yml").readLines()
        val backendStart = lines.indexOfFirst { it.trimEnd() == "  backend:" }
        backendStart shouldBeGreaterThan -1
        val backendEnd = lines.drop(backendStart + 1)
            .indexOfFirst { it.matches(Regex("^ {2}\\S.*:\\s*$")) }
            .let { if (it < 0) lines.size else backendStart + 1 + it }

        lines.subList(backendStart, backendEnd).firstOrNull { it.trim().startsWith("KAKAO_APP_ID:") }?.trim() shouldBe
            "KAKAO_APP_ID: \${KAKAO_APP_ID:-}"
    }

    ".env.example 이 KAKAO_APP_ID 를 안내한다" {
        repoFile(".env.example").readLines().any { it.trim() == "KAKAO_APP_ID=" } shouldBe true
    }

    "Helm 차트가 KAKAO_APP_ID 를 시크릿 env 목록에 싣는다" {
        val rangeLine = repoFile("deploy/eks/chart/templates/backend.yaml").readLines()
            .firstOrNull { it.contains("range list") && it.contains("\"GOOGLE_CLIENT_ID\"") }

        rangeLine.orEmpty() shouldContain "\"KAKAO_APP_ID\""
    }

    "시크릿 동기화가 KAKAO_APP_ID 를 백엔드 키로 인정한다" {
        val script = repoFile("deploy/eks/runtime_secrets.py").readText()
        val backendKeys = script.substringAfter("BACKEND_KEYS = frozenset(\"\"\"").substringBefore("\"\"\"")

        backendKeys.split(Regex("\\s+")).contains("KAKAO_APP_ID") shouldBe true
    }
})
