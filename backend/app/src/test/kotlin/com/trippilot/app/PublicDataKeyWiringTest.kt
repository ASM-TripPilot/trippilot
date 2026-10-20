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
 * 공공데이터포털 키(`PUBLIC_DATA_API_KEY` — 기상특보·에어코리아)가 백엔드 특보·대기질 어댑터까지 닿는 통로. 형태는 [SituationSweepWiringTest] 와 같다.
 *
 * 통로가 끊겨도 **아무것도 빨개지지 않는다** — 키가 비면 어댑터가 기상청 키(`WEATHER_API`)로 대신 물어(단기예보 계정은 특보·대기질
 * 미등록 30 — O-SA-1) 그 출처가 종일 모름으로 돈다. 배포 시크릿·차트 구간은 배포 테스트(`deploy/eks/tests/test_runtime.py`)가 본다.
 * 빈 값일 때 기상청 키로 대신하는 것은 `WeatherAlertWiringTest`(weather-context)가 실제 질의로 잰다.
 */
class PublicDataKeyWiringTest : StringSpec({

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

    "application.yml 이 PUBLIC_DATA_API_KEY 를 특보·대기질 키로 잇는다 — 없으면 빈 값(어댑터가 기상청 키로 대신한다)" {
        resolve("trippilot.weather.public-data-key", mapOf("PUBLIC_DATA_API_KEY" to "pd-key", "WEATHER_API" to "kma-key")) shouldBe "pd-key"
        resolve("trippilot.weather.public-data-key", mapOf("WEATHER_API" to "kma-key")) shouldBe ""
        resolve("trippilot.weather.service-key", mapOf("PUBLIC_DATA_API_KEY" to "pd-key", "WEATHER_API" to "kma-key")) shouldBe "kma-key"
    }

    "compose 가 backend 서비스에 PUBLIC_DATA_API_KEY 를 넘긴다" {
        val lines = repoFile("docker-compose.yml").readLines()
        val backendStart = lines.indexOfFirst { it.trimEnd() == "  backend:" }
        backendStart shouldBeGreaterThan -1
        val backendEnd = lines.drop(backendStart + 1)
            .indexOfFirst { it.matches(Regex("^ {2}\\S.*:\\s*$")) }
            .let { if (it < 0) lines.size else backendStart + 1 + it }

        lines.subList(backendStart, backendEnd).map { it.trim() }
            .contains("PUBLIC_DATA_API_KEY: \${PUBLIC_DATA_API_KEY:-}") shouldBe true
    }
})
