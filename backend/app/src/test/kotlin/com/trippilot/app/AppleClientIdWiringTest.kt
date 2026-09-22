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
 * **애플 로그인은 코드가 맞아도 값이 안 오면 통째로 죽어 있다** — 그리고 죽은 상태가 초록이다.
 *
 * `AppleOAuthClient` 는 `client-id`(= iOS 번들 ID, id_token 의 `aud` 기대값)가 비면 `ProviderNotSupported`
 * 501 로 나간다. 검증 로직 전체가 도달 불가인데 **단위 테스트는 손으로 만든 `SocialProviderProperties`
 * 를 쓰므로 하나도 안 빨개진다**. 실제로 TRIP-858 구현 직후 이 상태였다 — 적대적 리뷰가 잡았다:
 * `application.yml` 에는 키를 넣었는데 **컨테이너·Helm·시크릿 동기화 셋 다 명시 화이트리스트**라
 * 값이 앱까지 오지 못했다. 배포해도 TRIP-858 이전과 거동이 같았다.
 *
 * 그래서 여기서는 **통로 네 구간을 각각** 재고, 구현은 재지 않는다(그건 `AppleOAuthClientTest` 몫).
 * "값이 붙는가"와 "구현이 바뀌는가"를 따로 본다는 anti-patterns 규칙의 앞쪽이다.
 */
class AppleClientIdWiringTest : StringSpec({

    /**
     * 클래스패스로 읽지 않는 이유는 [JwtSigningKeyWiringTest] 와 같다 —
     * `app/src/test/resources/application.yml` 이 본 파일을 통째로 가려서, 어떤 IT 도 본
     * `application.yml` 을 검증한 적이 없다. 파일을 경로로 직접 읽어 그 가림을 우회한다.
     */
    fun resolve(key: String, env: Map<String, Any>): String? {
        val file = File("src/main/resources/application.yml")
        check(file.exists()) {
            "본 application.yml 을 못 찾았습니다(작업 디렉토리=${File(".").absolutePath})."
        }
        val environment = StandardEnvironment()
        environment.propertySources.addFirst(MapPropertySource("주입", env))
        YamlPropertySourceLoader().load("main-application", FileSystemResource(file))
            .forEach { environment.propertySources.addLast(it) }
        return environment.getProperty(key)
    }

    fun repoFile(name: String): File =
        File("../../$name").takeIf { it.exists() } ?: File("../$name")

    "application.yml 이 APPLE_CLIENT_ID 를 client-id 로 잇는다" {
        resolve("trippilot.social.apple.client-id", mapOf("APPLE_CLIENT_ID" to "com.trippilot.travel")) shouldBe
            "com.trippilot.travel"
    }

    "환경변수가 없으면 빈 문자열이다 — 기동은 되고 애플 로그인만 501 이 된다" {
        resolve("trippilot.social.apple.client-id", emptyMap()) shouldBe ""
    }

    /**
     * issuer·jwks-uri 는 Apple 이 정한 고정 주소라 환경변수가 아니다. 다만 **비면 검증기가
     * 서지 않으므로**(그리고 그때도 501 로 조용히 나가므로) 값이 있는지는 봐야 한다.
     */
    "issuer·jwks-uri 가 Apple 실주소로 박혀 있다" {
        resolve("trippilot.social.apple.issuer", emptyMap()) shouldBe "https://appleid.apple.com"
        resolve("trippilot.social.apple.jwks-uri", emptyMap()) shouldBe "https://appleid.apple.com/auth/keys"
    }

    // ── 배포 통로 3구간 ──────────────────────────────────────────────────────────
    // 셋 다 **명시 화이트리스트**다. 목록에 없는 변수는 조용히 사라진다 — 오타도 누락도 안 빨개진다.

    /**
     * **`backend:` 서비스 블록 안**에 있는지까지 본다. compose 의 모든 서비스가 `environment:` 를 같은
     * 들여쓰기로 쓰므로 파일 전체를 훑으면 **줄이 `ai:` 블록에 있어도 통과한다**(실측 — 그 상태에서
     * 백엔드 컨테이너는 값을 못 받아 애플 로그인이 501 인데 테스트는 초록이었다).
     */
    "compose 가 backend 서비스에 APPLE_CLIENT_ID 를 넘긴다" {
        val lines = repoFile("docker-compose.yml").readLines()
        val backendStart = lines.indexOfFirst { it.trimEnd() == "  backend:" }
        backendStart shouldBeGreaterThan -1
        // 다음 최상위 서비스(들여쓰기 2칸 + `:`)가 나오기 전까지가 backend 블록이다.
        val backendEnd = lines.drop(backendStart + 1)
            .indexOfFirst { it.matches(Regex("^ {2}\\S.*:\\s*$")) }
            .let { if (it < 0) lines.size else backendStart + 1 + it }

        val line = lines.subList(backendStart, backendEnd)
            .firstOrNull { it.trim().startsWith("APPLE_CLIENT_ID:") }

        line?.trim() shouldBe "APPLE_CLIENT_ID: \${APPLE_CLIENT_ID:-}"
    }

    /**
     * 통로는 아니지만 **여기가 비면 아무도 값이 필요한 줄 모른다** — `.env.example` 을 복사해 `.env` 를
     * 만드는 것이 이 리포의 로컬 셋업이다. 실제로 1차 수정에서 이 파일만 빠뜨려, 종전의
     * "apple 은 …구현 후 추가 예정" 주석이 구현 뒤에도 남아 있었다.
     */
    ".env.example 이 APPLE_CLIENT_ID 를 안내한다" {
        val lines = repoFile(".env.example").readLines()

        lines.any { it.trim() == "APPLE_CLIENT_ID=" } shouldBe true
        // 구현 전 상태를 가리키는 낡은 안내가 남아 있으면 안 된다.
        // **대소문자를 무시한다** — 소문자 `apple` 로만 물으면 이 단언이 죽는다(파일에 `Apple`·`APPLE_`
        // 는 있어도 소문자는 한 줄도 없고, 사람이 새로 쓰는 안내문도 보통 `Apple` 이다).
        lines.none { it.contains("apple", ignoreCase = true) && it.contains("추가 예정") } shouldBe true
    }

    /**
     * **`range list` 줄 자체**를 집는다. 파일 전체 부분문자열로 물으면 `range list` 에서 빼고 바로 위에
     * `# 잠시 뺀다` 주석으로 이름을 남겨도 통과한다(실측 — Pod env 에서 완전히 사라졌는데 초록이었다).
     * "잠시 빼면서 이유를 주석으로 남긴다"는 사람이 실제로 하는 동작이라 가공의 시나리오가 아니다.
     */
    "Helm 차트가 APPLE_CLIENT_ID 를 시크릿 env 목록에 싣는다" {
        val rangeLine = repoFile("deploy/eks/chart/templates/backend.yaml").readLines()
            .firstOrNull { it.contains("range list") && it.contains("\"GOOGLE_CLIENT_ID\"") }

        rangeLine.orEmpty() shouldContain "\"APPLE_CLIENT_ID\""
    }

    "시크릿 동기화가 APPLE_CLIENT_ID 를 백엔드 키로 인정한다" {
        // 목록에 없으면 시크릿에 넣어도 동기화 단계에서 걸러져 클러스터까지 가지 못한다.
        val script = repoFile("deploy/eks/runtime_secrets.py").readText()
        val backendKeys = script.substringAfter("BACKEND_KEYS = frozenset(\"\"\"").substringBefore("\"\"\"")

        // 부분문자열이 아니라 **토큰**으로 본다 — 다른 키의 일부에 걸려 통과하지 않도록.
        backendKeys.split(Regex("\\s+")).contains("APPLE_CLIENT_ID") shouldBe true
    }
})
