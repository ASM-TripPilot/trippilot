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
 * Plan-B 상황 감시 스위치 4종이 앱까지 닿는 통로(situation-awareness 설계서 §7). 형태는 [KakaoAppIdWiringTest] 와 같다.
 *
 * 통로가 끊겨도 **아무것도 빨개지지 않는다** — 앱은 기본(off·today·전원·off)으로 정상 기동하고, 켰다고 믿는 스윕이
 * 꺼진 채 돈다. 그래서 구간을 하나씩 잠근다. 허용목록·차트 구간은 배포 테스트(`deploy/eks/tests/test_runtime.py`)가 본다.
 */
class SituationSweepWiringTest : StringSpec({

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

    "application.yml 이 스위치를 스윕·재계획 경로로 잇는다 — 지평 하나가 두 곳을 연다" {
        val env = mapOf(
            "PLANB_SITUATION_SWEEP" to "dry-run",
            "PLANB_SITUATION_HORIZON" to "pre-trip",
            "PLANB_SITUATION_SWEEP_ACCOUNT_IDS" to "0d7f17ab-5c4b-4d6d-a7f7-484ba11dda46",
            "PLANB_PREPARED_REPLAN" to "on",
        )
        resolve("trippilot.planb.situation-sweep.mode", env) shouldBe "dry-run"
        resolve("trippilot.planb.situation-sweep.horizon", env) shouldBe "pre-trip"
        // 저녁 점검과 전날 진입 창이 따로 켜지면 알림 탭이 막다른 길(409)이 된다 — 같은 키 하나다(CD12).
        resolve("trippilot.replan.horizon", env) shouldBe "pre-trip"
        resolve("trippilot.planb.situation-sweep.account-ids", env) shouldBe "0d7f17ab-5c4b-4d6d-a7f7-484ba11dda46"
        resolve("trippilot.replan.prepared.mode", env) shouldBe "on"
    }

    "스위치가 없으면 꺼짐 · 오늘 · 전원 · 선계산 꺼짐이다" {
        resolve("trippilot.planb.situation-sweep.mode", emptyMap()) shouldBe "off"
        resolve("trippilot.planb.situation-sweep.horizon", emptyMap()) shouldBe "today"
        resolve("trippilot.replan.horizon", emptyMap()) shouldBe "today"
        resolve("trippilot.planb.situation-sweep.account-ids", emptyMap()) shouldBe ""
        resolve("trippilot.replan.prepared.mode", emptyMap()) shouldBe "off"
    }

    "compose 가 backend 서비스에 네 스위치를 넘긴다 — 모드·지평은 값을 보장하는 꼴(빈 값 금지)" {
        val lines = repoFile("docker-compose.yml").readLines()
        val backendStart = lines.indexOfFirst { it.trimEnd() == "  backend:" }
        backendStart shouldBeGreaterThan -1
        val backendEnd = lines.drop(backendStart + 1)
            .indexOfFirst { it.matches(Regex("^ {2}\\S.*:\\s*$")) }
            .let { if (it < 0) lines.size else backendStart + 1 + it }
        val backend = lines.subList(backendStart, backendEnd).map { it.trim() }

        backend.contains("PLANB_SITUATION_SWEEP: \${PLANB_SITUATION_SWEEP:-off}") shouldBe true
        backend.contains("PLANB_SITUATION_HORIZON: \${PLANB_SITUATION_HORIZON:-today}") shouldBe true
        backend.contains("PLANB_SITUATION_SWEEP_ACCOUNT_IDS: \${PLANB_SITUATION_SWEEP_ACCOUNT_IDS:-}") shouldBe true
        backend.contains("PLANB_PREPARED_REPLAN: \${PLANB_PREPARED_REPLAN:-off}") shouldBe true
    }

    ".env.example 이 네 스위치를 기본값으로 안내한다" {
        val lines = repoFile(".env.example").readLines().map { it.trim() }

        listOf(
            "PLANB_SITUATION_SWEEP=off", "PLANB_SITUATION_HORIZON=today",
            "PLANB_SITUATION_SWEEP_ACCOUNT_IDS=", "PLANB_PREPARED_REPLAN=off",
        ).filterNot { it in lines } shouldBe emptyList()
    }
})
