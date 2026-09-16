package com.trippilot.app

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.springframework.core.env.MapPropertySource
import org.springframework.core.env.StandardEnvironment
import org.springframework.core.io.FileSystemResource
import java.io.File
import org.springframework.boot.env.YamlPropertySourceLoader

/**
 * **설정 통로가 값을 실제로 나르는가** — 코드가 맞아도 `application.yml` 에 키가 없으면
 * 앱은 기본값(빈 키 → 기동 시 생성)으로 **조용히 뜬다**. 그 상태는 복제본을 못 늘리는데
 * 증상이 복제본을 늘린 뒤에야 나온다.
 *
 * 이 리포가 같은 함정을 이미 두 번 겪었다(`trippilot.stay.content.mode`, `TRIPPILOT_EMBEDDING_PROVIDER`)
 * — "값이 붙는가"와 "구현이 바뀌는가"를 따로 본다는 규칙이 anti-patterns 에 있다. 여기는 앞쪽이다.
 */
class JwtSigningKeyWiringTest : StringSpec({

    /**
     * **클래스패스로 읽지 않는다.** `app/src/test/resources/application.yml` 이 본 파일을 통째로
     * 가리기 때문이다(실측 2026-09-16: `@SpringBootTest` 안에서 `trippilot.social.*`·
     * `stay.content.mode` 가 전부 null). 그래서 **어떤 IT 도 본 `application.yml` 을 검증한 적이 없다** —
     * 거기 오타가 나도 아무것도 안 빨개진다. 그 자체가 따로 다룰 문제라 노드로 남겼고,
     * 여기서는 파일을 경로로 직접 읽어 가림을 우회한다.
     */
    fun resolve(key: String, env: Map<String, Any>): String? {
        val file = File("src/main/resources/application.yml")
        check(file.exists()) {
            "본 application.yml 을 못 찾았습니다(작업 디렉토리=${File(".").absolutePath}). " +
                "이 테스트는 app 모듈 디렉토리에서 실행되는 것을 전제합니다."
        }
        val environment = StandardEnvironment()
        // **`systemProperties` 에 넣지 않는다** — 그것은 `System.getProperties()` 라 JVM 전역이고,
        // 앞 테스트가 넣은 값이 뒤 테스트로 샌다(실측: 두 번째 단언이 앞의 값을 보고 깨졌다).
        // 전용 소스를 맨 앞에 두면 이 호출 안에서만 산다.
        environment.propertySources.addFirst(MapPropertySource("주입", env))
        YamlPropertySourceLoader().load("main-application", FileSystemResource(file))
            .forEach { environment.propertySources.addLast(it) }
        return environment.getProperty(key)
    }

    "application.yml 이 JWT_SIGNING_KEY 를 signing-key 로 잇는다" {
        resolve("trippilot.jwt.signing-key", mapOf("JWT_SIGNING_KEY" to "주입된값")) shouldBe "주입된값"
    }

    "환경변수가 없으면 빈 문자열이다 — 기동은 되고 경고가 남는다" {
        resolve("trippilot.jwt.signing-key", emptyMap()) shouldBe ""
    }

    /** 배포에서 켜는 스위치. 통로가 없으면 켤 방법이 없어 강제 자체가 무의미해진다. */
    "application.yml 이 JWT_REQUIRE_CONFIGURED_KEY 를 require-configured-key 로 잇는다" {
        resolve("trippilot.jwt.require-configured-key", mapOf("JWT_REQUIRE_CONFIGURED_KEY" to "true")) shouldBe "true"
        resolve("trippilot.jwt.require-configured-key", emptyMap()) shouldBe "false"
    }

    /**
     * **빈 문자열은 Boolean 으로 바인딩되지 않는다 — 기동이 깨진다**(실측 2026-09-16: `BindException`).
     *
     * `${'$'}{VAR:false}` 는 "변수가 없을 때"만 기본값을 쓴다. compose 가 `${'$'}{VAR:-}` 로 넘기면
     * 변수는 **존재하고 값이 빈** 상태라 기본값이 안 먹고 `""` 가 그대로 바인딩 대상이 된다.
     * `.env.example` 을 그대로 복사한 사람의 컨테이너가 안 뜨는 경로였다.
     *
     * 그래서 compose 는 `${'$'}{VAR:-false}` 로 **값을 보장**한다(기존 `AI_SCHEDULE_DEADLINE_ENFORCED`
     * 선례와 같다). 이 테스트는 그 보장이 사라지면 깨진다.
     */
    "compose 가 불리언 스위치에 빈 값을 넘기지 않는다" {
        val compose = File("../../docker-compose.yml").takeIf { it.exists() }
            ?: File("../docker-compose.yml")
        val line = compose.readLines().first { it.contains("JWT_REQUIRE_CONFIGURED_KEY:") }

        // `:-}` 로 끝나면 빈 문자열을 넘긴다 — 그 순간 기동이 깨진다.
        line.contains(":-}") shouldBe false
        line.contains(":-false}") shouldBe true
    }
})
