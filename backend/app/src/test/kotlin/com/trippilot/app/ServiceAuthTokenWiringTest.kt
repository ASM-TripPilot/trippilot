package com.trippilot.app

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.springframework.boot.env.YamlPropertySourceLoader
import org.springframework.core.env.MapPropertySource
import org.springframework.core.env.StandardEnvironment
import org.springframework.core.io.FileSystemResource
import java.io.File

/**
 * 서비스 토큰 설정 통로(TRIP-856 후속).
 *
 * 스위치는 **켤 방법이 있어야 의미가 있다.** 검증 코드만 넣고 환경변수 통로가 없으면 배포에서
 * 켤 수 없어 강제 자체가 장식이 된다 — `JWT_REQUIRE_CONFIGURED_KEY` 때 같은 자리를 지켰다.
 */
class ServiceAuthTokenWiringTest : StringSpec({

    /**
     * **클래스패스로 읽지 않는다.** `app/src/test/resources/application.yml` 이 본 파일을 통째로
     * 가려서, `@SpringBootTest` 안에서는 본 파일의 값이 보이지 않는다(실측 2026-09-16).
     * 파일을 경로로 직접 읽어 가림을 우회한다.
     */
    fun resolve(key: String, env: Map<String, Any>): String? {
        val file = File("src/main/resources/application.yml")
        check(file.exists()) {
            "본 application.yml 을 못 찾았습니다(작업 디렉토리=${File(".").absolutePath}). " +
                "이 테스트는 app 모듈 디렉토리에서 실행되는 것을 전제합니다."
        }
        val environment = StandardEnvironment()
        // 전용 소스를 맨 앞에 — `systemProperties` 는 JVM 전역이라 앞 테스트의 값이 샌다.
        environment.propertySources.addFirst(MapPropertySource("주입", env))
        YamlPropertySourceLoader().load("main-application", FileSystemResource(file))
            .forEach { environment.propertySources.addLast(it) }
        return environment.getProperty(key)
    }

    "application.yml 이 SERVICE_AUTH_REQUIRE_TOKEN 을 require-token 으로 잇는다" {
        resolve("trippilot.service-auth.require-token", mapOf("SERVICE_AUTH_REQUIRE_TOKEN" to "true")) shouldBe "true"
        resolve("trippilot.service-auth.require-token", emptyMap()) shouldBe "false"
    }

    /**
     * **한 시크릿이 네 자리에 이어져 있다.** 갈라 두면 둘 중 하나만 세팅된 절반 설정이 생기고,
     * 그때 증상은 **한쪽 방향만 401** 이라 원인이 안 보인다. 하나라도 끊기면 여기서 깨진다.
     */
    "한 환경변수가 수신·발신 네 자리를 모두 채운다" {
        val env = mapOf<String, Any>("SERVICE_AUTH_TOKEN" to "한값")
        listOf(
            "trippilot.service-auth.token",          // 수신(/internal/**)
            "trippilot.ai.schedule.service-token",   // 발신 — 일정 생성·검증·수리·근거·슬롯 후보
            "trippilot.ai.reflection.service-token", // 발신 — 회고
            "trippilot.ai.reminder-copy.service-token", // 발신 — 리마인드 문구
        ).forEach { key -> resolve(key, env) shouldBe "한값" }
    }

    /**
     * **빈 문자열은 Boolean 으로 바인딩되지 않는다 — 기동이 깨진다**(실측 2026-09-16: `BindException`).
     *
     * `${'$'}{VAR:false}` 는 "변수가 없을 때"만 기본값을 쓴다. compose 가 `${'$'}{VAR:-}` 로 넘기면
     * 변수는 **존재하고 값이 빈** 상태라 기본값이 안 먹고 `""` 가 그대로 바인딩 대상이 된다.
     */
    "compose 가 이 불리언 스위치에 빈 값을 넘기지 않는다" {
        val compose = File("../../docker-compose.yml").takeIf { it.exists() }
            ?: File("../docker-compose.yml")
        val line = compose.readLines().first { it.contains("SERVICE_AUTH_REQUIRE_TOKEN:") }

        line.contains(":-}") shouldBe false
        line.contains(":-false}") shouldBe true
    }
})
