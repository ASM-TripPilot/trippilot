package com.trippilot.app

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import java.io.File

/**
 * **빈 문자열이 Boolean·숫자 설정으로 흘러드는 길을 막는다.**
 *
 * ## 왜 있나 — 같은 함정을 두 번 밟았다
 *
 * `application.yml` 의 `${'$'}{VAR:false}` 는 **변수가 없을 때만** 기본값을 쓴다. compose 가
 * `${'$'}{VAR:-}` 로 넘기면 변수는 **존재하고 값이 빈** 상태라 기본값이 안 먹고 `""` 가 그대로
 * 바인딩 대상이 되어 **기동이 깨진다**.
 *
 * - 2026-09-16: `JWT_REQUIRE_CONFIGURED_KEY` 를 `:-` 로 넘겨 `BindException`. 리뷰에서 잡았다.
 * - 같은 날: AI 쪽 `EXISTENCE_MAX_CALLS` 가 같은 이유로 `int('')` 폭발 — **컨테이너가 아예 안 떴다.**
 *   그쪽은 리뷰가 없어 실행해 보고서야 알았다.
 *
 * `.env.example` 을 그대로 복사한 사람의 컨테이너가 안 뜨는 경로다. 문자열 설정에서는 같은 표기가
 * 무해해서 **더 안 보인다** — 그래서 사람 눈이 아니라 그물이 필요하다.
 *
 * ## 무엇을 재나
 *
 * compose 가 **빈 값으로 넘기는** 환경변수를 모으고, 그 변수를 읽는 `application.yml` 항목의
 * 기본값이 **Boolean·숫자면** 실패로 본다. 기본값의 생김새를 타입의 대리로 쓴다 — 코틀린 쪽
 * 프로퍼티 타입을 읽으려면 리플렉션이 필요한데, 그러려면 컨텍스트를 띄워야 하고 그 컨텍스트는
 * 테스트 리소스 `application.yml` 이 본 파일을 **가려 버린다**(그 가림이 이 파일이 경로로 읽는 이유다).
 *
 * ## 유지 판정
 *
 * 이 검사가 **한 번도 실적을 못 내고** Boolean·숫자 스위치가 6개월간 늘지 않으면 뗀다.
 * 지금은 스위치가 계속 느는 국면이라(실사용 전환) 둔다.
 */
class EmptyEnvBindingTest : StringSpec({

    "compose 가 빈 값으로 넘기는 변수는 Boolean·숫자 설정에 닿지 않는다" {
        val compose = repoFile("docker-compose.yml").readText()
        val yml = repoFile("backend/app/src/main/resources/application.yml").readText()

        // compose 가 `${VAR:-}` 로 **빈 문자열을 보장**하는 변수들.
        val passedEmpty = Regex("""\$\{([A-Z_]+):-}""").findAll(compose).map { it.groupValues[1] }.toSet()

        val offenders = passedEmpty.flatMap { variable ->
            Regex("""^\s*([a-z0-9-]+):\s*\$\{$variable(?::([^}]*))?}""", RegexOption.MULTILINE)
                .findAll(yml)
                .filter { looksNonString(it.groupValues[2]) }
                .map { "$variable → ${it.groupValues[1]}(기본 '${it.groupValues[2]}')" }
        }.sorted()

        // 빈 문자열은 Boolean·숫자로 바인딩되지 않는다 — compose 쪽을 `:-false`·`:-60` 처럼
        // **값을 보장하는 형태**로 바꾼다(빈 기본값을 허용하려면 프로퍼티를 String 으로 받는다).
        offenders shouldContainExactly emptyList()
    }
})

/** 기본값 생김새로 타입을 가늠한다. 빈 값·따옴표 문자열은 String 으로 본다. */
private fun looksNonString(default: String): Boolean {
    val v = default.trim()
    return v == "true" || v == "false" || (v.isNotEmpty() && v.all { it.isDigit() })
}

/** 모듈 위치가 바뀌어도 견디도록 상대 깊이를 세지 않고 위로 올라가며 찾는다. */
private fun repoFile(relative: String): File {
    var dir: File? = File(System.getProperty("user.dir"))
    while (dir != null) {
        val candidate = File(dir, relative)
        if (candidate.isFile) return candidate
        dir = dir.parentFile
    }
    error("$relative 을 찾지 못했습니다. user.dir=${System.getProperty("user.dir")}")
}
