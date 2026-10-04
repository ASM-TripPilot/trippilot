package com.trippilot.app

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldContain
import org.yaml.snakeyaml.Yaml
import java.io.File

/**
 * **로컬 POI 자동 적재(compose 의 `poi-ingest`, TRIP-1223)는 깨져도 아무 소리를 안 낸다.**
 *
 * 1회성 컨테이너라 `up -d` 는 그 결과를 출력하지 않는다. 토큰 변수가 백엔드와 어긋나면 매 `up` 이
 * "토큰이 비어 건너뜀"으로 **exit 0** 이 되고, 인자가 어긋나면 argparse 오류(exit 2)로 끝난다 —
 * 어느 쪽이든 DB 는 다시 "서울 맛집 0" 이고 CI 는 초록이다. 그래서 그 블록이 실제로 돌 조건을 잰다.
 *
 * 줄이 아니라 **YAML 로** 읽는다 — 줄 단위 검사는 주석 줄이나 다른 서비스의 같은 줄에 속는다
 * ([StayContentModeParityTest]·[AppleClientIdWiringTest] 의 실측).
 *
 * compose 와 적재 스크립트는 `:app:test` 의 선언된 입력이다(`app/build.gradle.kts`) — 둘 중 하나만
 * 바뀌어도 이 테스트가 다시 돈다.
 */
class PoiIngestComposeWiringTest : StringSpec({

    fun repoFile(rel: String): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            val f = File(dir, rel)
            if (f.isFile) return f
            dir = dir.parentFile
        }
        error("파일을 찾지 못했습니다: $rel (user.dir=${System.getProperty("user.dir")})")
    }

    val compose = repoFile("docker-compose.yml")

    @Suppress("UNCHECKED_CAST")
    val services = Yaml().load<Map<String, Any>>(compose.readText())["services"] as Map<String, Map<String, Any>>
    val ingest = services.getValue("poi-ingest")
    val backend = services.getValue("backend")

    /** `sh -c` 에 넘기는 셸 본문 — compose 치환 전 원문이라 `$$` 가 그대로 보인다. */
    val shell = (ingest["command"] as List<*>).last() as String

    /**
     * 스크립트를 부르는 줄. 인자는 **이 줄에** 있어야 넘어간다 — 셸 전체에서 찾으면 `"$$@"` 가 위의
     * `set --` 줄에도 있어서, 이 줄에서 빠져도 통과한다(실측 — 첫 판이 그 변이를 놓쳤다).
     */
    val call = shell.lines().single { it.contains("python3 ") }

    "토큰을 백엔드와 같은 변수에서 받는다 — 어긋나면 매 up 이 '건너뜀'으로 exit 0 이다" {
        val token = (ingest["environment"] as Map<*, *>)["SERVICE_AUTH_TOKEN"]

        token shouldNotBe null
        token shouldBe (backend["environment"] as Map<*, *>)["SERVICE_AUTH_TOKEN"]
    }

    "백엔드와 같은 프로파일에서 뜨고, 백엔드가 healthy 가 된 뒤에 붓는다" {
        ingest["profiles"] shouldBe backend["profiles"]
        ((ingest["depends_on"] as Map<*, *>)["backend"] as Map<*, *>)["condition"] shouldBe "service_healthy"
    }

    "백엔드 컨테이너 주소로 공유본과 추가 문서를 넘긴다" {
        call shouldContain "--base-url http://backend:8080"
        // 빠지면 경로 없이 호출돼 argparse 가 exit 2 로 끝난다 — `up -d` 에는 안 보인다.
        call shouldContain "\"\$\$@\""
        shell shouldContain "/data/collected_pois.json"
    }

    "토큰 값이 command 에 박히지 않는다 — 셸이 읽도록 `\$\$` 로만 쓴다" {
        // `$` 하나면 compose 가 .env 값으로 먼저 치환해 토큰이 command 에 그대로 남는다(config·inspect 에 노출).
        Regex("""(?<!\$)\$\{?SERVICE_AUTH_TOKEN""").containsMatchIn(shell) shouldBe false
    }

    "command 가 쓰는 옵션을 적재 스크립트가 받는다 — CLI 가 바뀌면 매 up 이 argparse 오류다" {
        // 컨테이너가 실제로 돌리는 파일 = volumes 에서 .py 를 붙인 호스트 쪽 파일.
        val (host, target) = (ingest["volumes"] as List<*>).map { (it as String).split(":") }
            .single { it[1].endsWith(".py") }
        call shouldContain "python3 $target "

        // compose 는 상대 경로를 **자기 파일 위치** 기준으로 푼다. 위로 훑어 찾으면 `./scripts/…` 가
        // `backend/scripts/…` 에 붙어, 스크립트를 잘못 가리켜도 통과한다(실측 — 첫 판이 놓쳤다).
        val cli = File(compose.parentFile, host).readText()
        Regex("""--[a-z][a-z-]*""").findAll(call).forEach { cli shouldContain "\"${it.value}\"" }
        cli shouldContain "\"SERVICE_AUTH_TOKEN\""
    }
})
