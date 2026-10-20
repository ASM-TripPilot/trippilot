package com.trippilot.app

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.springframework.boot.env.YamlPropertySourceLoader
import org.springframework.core.env.MapPropertySource
import org.springframework.core.env.StandardEnvironment
import org.springframework.core.io.FileSystemResource
import java.io.File

/**
 * 기회 카드 스위치(`AI_OPPORTUNITY_MODE` · situation-awareness DEC-SA-8)가 앱까지 닿는 통로. 형태는 [SituationSweepWiringTest] 와 같다.
 *
 * 통로가 끊겨도 **아무것도 빨개지지 않는다** — 앱은 기본(off)으로 정상 기동하고 카드만 조용히 빈다. 그래서 구간을 하나씩 잠근다.
 * 배포 차트의 고정 env 는 `deploy/eks/chart/tests/test_chart.py` 가 본다. `base-url` 을 함께 보는 이유: 기본값이 localhost 라
 * 모드만 켜면 컨테이너가 자기 자신을 부른다(켠 것처럼 보이고 늘 빈 목록).
 */
class OpportunityWiringTest : StringSpec({

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

    "application.yml 이 스위치·주소·서비스 토큰을 기회 경계로 잇는다" {
        val env = mapOf("AI_OPPORTUNITY_MODE" to "http", "AI_URL" to "http://ai:8000", "SERVICE_AUTH_TOKEN" to "s3cr3t")

        resolve("trippilot.ai.opportunity.mode", env) shouldBe "http"
        resolve("trippilot.ai.opportunity.base-url", env) shouldBe "http://ai:8000"
        resolve("trippilot.ai.opportunity.service-token", env) shouldBe "s3cr3t"
    }

    "스위치가 없으면 꺼짐이다" {
        resolve("trippilot.ai.opportunity.mode", emptyMap()) shouldBe "off"
    }

    "compose 가 backend 서비스에 스위치를 값을 보장하는 꼴로 넘긴다(빈 값 금지)" {
        val lines = repoFile("docker-compose.yml").readLines()
        val backendStart = lines.indexOfFirst { it.trimEnd() == "  backend:" }
        backendStart shouldBeGreaterThan -1
        val backendEnd = lines.drop(backendStart + 1)
            .indexOfFirst { it.matches(Regex("^ {2}\\S.*:\\s*$")) }
            .let { if (it < 0) lines.size else backendStart + 1 + it }
        val backend = lines.subList(backendStart, backendEnd).map { it.trim() }

        backend.contains("AI_OPPORTUNITY_MODE: \${AI_OPPORTUNITY_MODE:-off}") shouldBe true
        // 주소는 기존 AI_URL 이 컨테이너 주소로 이미 넘어간다 — 기회 경계는 그것을 읽는다(별도 통로가 없다).
        backend.any { it.startsWith("AI_URL: \${AI_URL:-http://ai:8000}") } shouldBe true
    }

    ".env.example 이 스위치를 기본값으로 안내한다" {
        repoFile(".env.example").readLines().map { it.trim() }.contains("AI_OPPORTUNITY_MODE=off") shouldBe true
    }
})
