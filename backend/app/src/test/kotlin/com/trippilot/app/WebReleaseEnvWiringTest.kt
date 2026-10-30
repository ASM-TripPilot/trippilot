package com.trippilot.app

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldNotContain
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.springframework.boot.env.YamlPropertySourceLoader
import org.springframework.core.env.MapPropertySource
import org.springframework.core.env.StandardEnvironment
import org.springframework.core.io.FileSystemResource
import java.io.File

/**
 * 웹 출시 백엔드 키 3종(TRIP-1655·1656·1657)이 **통로 다섯 구간을 모두 지나는가**.
 *
 * `AppleClientIdWiringTest` 와 같은 이유다 — compose·Helm·시크릿 동기화는 명시 화이트리스트라 목록에 없는 키는
 * 조용히 사라지고, 단위 테스트는 손으로 만든 설정을 쓰므로 하나도 안 빨개진다. 빠지면 배포해도 CORS 가 꺼지고
 * 구글 웹 로그인이 401 인 채로 초록이다.
 */
class WebReleaseEnvWiringTest : StringSpec({

    fun repoFile(name: String): File =
        File("../../$name").takeIf { it.exists() } ?: File("../$name")

    fun resolve(key: String, env: Map<String, Any>): String? {
        val file = File("src/main/resources/application.yml")
        check(file.exists()) { "본 application.yml 을 못 찾았습니다(작업 디렉토리=${File(".").absolutePath})." }
        val environment = StandardEnvironment()
        environment.propertySources.addFirst(MapPropertySource("주입", env))
        YamlPropertySourceLoader().load("main-application", FileSystemResource(file))
            .forEach { environment.propertySources.addLast(it) }
        return environment.getProperty(key)
    }

    val keys = listOf("GOOGLE_WEB_CLIENT_ID", "GOOGLE_WEB_CLIENT_SECRET", "CORS_ALLOWED_ORIGINS")

    "application.yml 이 세 키를 설정으로 잇고, 없으면 빈 값이다(기동 무영향)" {
        val env = mapOf(
            "GOOGLE_WEB_CLIENT_ID" to "web-id",
            "GOOGLE_WEB_CLIENT_SECRET" to "web-secret",
            "CORS_ALLOWED_ORIGINS" to "https://app.example.test",
        )
        resolve("trippilot.social.google-web.client-id", env) shouldBe "web-id"
        resolve("trippilot.social.google-web.client-secret", env) shouldBe "web-secret"
        resolve("trippilot.social.google-web.redirect-origins", env) shouldBe "https://app.example.test"
        resolve("trippilot.web.cors-allowed-origins", env) shouldBe "https://app.example.test"
        resolve("trippilot.social.google-web.token-uri", emptyMap()) shouldBe "https://oauth2.googleapis.com/token"
        resolve("trippilot.social.google-web.client-id", emptyMap()) shouldBe ""
        resolve("trippilot.web.cors-allowed-origins", emptyMap()) shouldBe ""
    }

    "compose 의 backend 서비스 블록이 세 키를 빈 값 허용으로 넘긴다" {
        val lines = repoFile("docker-compose.yml").readLines()
        val start = lines.indexOfFirst { it.trimEnd() == "  backend:" }
        start shouldBeGreaterThan -1
        val end = lines.drop(start + 1).indexOfFirst { it.matches(Regex("^ {2}\\S.*:\\s*$")) }
            .let { if (it < 0) lines.size else start + 1 + it }
        val block = lines.subList(start, end).map { it.trim() }
        keys.forEach { block shouldContain "$it: \${$it:-}" }
    }

    ".env.example 이 세 키를 안내한다" {
        val lines = repoFile(".env.example").readLines().map { it.trim() }
        keys.forEach { lines shouldContain "$it=" }
    }

    "Helm 차트가 세 키를 시크릿 env 목록에 싣고, 공개 iOS 시크릿은 여전히 싣지 않는다" {
        val rangeLine = repoFile("deploy/eks/chart/templates/backend.yaml").readLines()
            .first { it.contains("range list") && it.contains("\"GOOGLE_CLIENT_ID\"") }
        val listed = Regex("\"([A-Z0-9_]+)\"").findAll(rangeLine).map { it.groupValues[1] }.toList()
        keys.forEach { listed shouldContain it }
        listed shouldNotContain "GOOGLE_CLIENT_SECRET"
    }

    "시크릿 동기화가 세 키를 백엔드 키로 인정한다" {
        val script = repoFile("deploy/eks/runtime_secrets.py").readText()
        val backendKeys = script.substringAfter("BACKEND_KEYS = frozenset(\"\"\"").substringBefore("\"\"\"")
            .split(Regex("\\s+"))
        keys.forEach { backendKeys shouldContain it }
    }
})
