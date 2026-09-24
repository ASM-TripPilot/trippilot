package com.trippilot.app

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.io.File

/**
 * **AI 경계 두 개는 같은 꼴이어야 한다**(DEC-U5-5) — 그런데 회고 쪽만 로컬 통로가 없었다.
 *
 * 일정 경계는 `TRIPPILOT_AI_SCHEDULE_MODE`·`_BASE_URL` 이 compose 에 있어 `.env` 한 줄로 켜지는데,
 * 회고 경계는 **Helm 만** `http` 를 박고 있었다. 결과는 "운영에서만 항상 켜져 있고 로컬에서는 한 번도
 * 켤 수 없는 경로" — compose 파일을 직접 편집하지 않는 한 검증이 불가능했다.
 *
 * `base-url` 을 함께 보는 이유가 따로 있다. 코드 기본값이 `http://localhost:8000` 이라
 * **mode 만 켜면 컨테이너가 자기 자신을 부른다** — 켠 것처럼 보이고 규칙 카드로 조용히 폴백한다.
 * 둘 중 하나만 있는 것은 없는 것보다 나쁘다.
 *
 * compose 는 `:app:test` 의 선언된 입력이다(`app/build.gradle.kts`) — 그 선언이 없으면 이 테스트는
 * compose 가 바뀐 순간에 돌지 않아 가드 구실을 못 한다.
 */
class AiBoundaryComposeWiringTest : StringSpec({

    fun repoFile(name: String): File =
        File("../../$name").takeIf { it.exists() } ?: File("../$name")

    /** compose 의 `backend:` 서비스 블록만 잘라낸다 — 다른 서비스에 같은 줄이 있어도 통과하지 않게. */
    fun backendBlock(): List<String> {
        val lines = repoFile("docker-compose.yml").readLines()
        val start = lines.indexOfFirst { it.trimEnd() == "  backend:" }
        check(start >= 0) { "docker-compose.yml 에서 backend 서비스를 못 찾았습니다." }
        val end = lines.drop(start + 1)
            .indexOfFirst { it.matches(Regex("^ {2}\\S.*:\\s*$")) }
            .let { if (it < 0) lines.size else start + 1 + it }
        return lines.subList(start, end)
    }

    fun valueOf(block: List<String>, key: String): String? =
        block.firstOrNull { it.trim().startsWith("$key:") }?.substringAfter(':')?.trim()

    listOf("SCHEDULE", "REFLECTION").forEach { boundary ->
        "compose 가 $boundary 경계의 mode 를 .env 로 넘긴다" {
            val value = valueOf(backendBlock(), "TRIPPILOT_AI_${boundary}_MODE")

            // `${...:-기본값}` 형태여야 .env 한 줄로 켤 수 있다. 하드코딩이면 파일을 고쳐야 켜진다.
            (value != null && value.startsWith("\${") && value.contains(":-")) shouldBe true
        }

        "compose 가 $boundary 경계의 base-url 을 컨테이너 주소로 준다" {
            val value = valueOf(backendBlock(), "TRIPPILOT_AI_${boundary}_BASE_URL")

            value shouldBe "\${AI_URL:-http://ai:8000}"
            // 코드 기본값이 localhost 라, 여기가 비거나 localhost 면 컨테이너가 자기 자신을 부른다.
            (value?.contains("localhost") ?: true) shouldBe false
        }
    }

    "`.env.example` 이 회고 스위치를 안내한다" {
        // 통로가 있어도 안내가 없으면 아무도 켤 줄 모른다 — 그게 이 경계가 방치된 이유였다.
        val lines = repoFile(".env.example").readLines()

        lines.any { it.trim().startsWith("AI_REFLECTION_MODE=") } shouldBe true
    }
})
