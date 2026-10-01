package com.trippilot.app.observability

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.io.File

/**
 * **요약 줄이 실제 설정과 같은 것을 말하는가.**
 *
 * 이 줄은 프로퍼티 경로를 **문자열로** 들고 있다. 경로를 틀리면 예외가 나지 않고 **기본값이
 * 그대로 찍힌다** — 즉 `stay=stub` 이라고 말하는데 실제로는 `db` 로 도는 상태가 되고, 그건
 * 요약이 없는 것보다 나쁘다(틀린 것을 믿게 만든다).
 *
 * 그래서 두 가지를 센다:
 *
 * 1. **경로가 실재하는가** — `application.yml` 이나 코드의 `@Value`/`@ConditionalOnProperty` 중
 *    한 곳에는 그 경로가 있어야 한다. 셋(`ai.schedule.mode`·`ai.reflection.mode`·`push.mode`)은
 *    yml 에 없고 환경변수로 직접 바인딩되므로 **코드 쪽도 함께 본다**.
 * 2. **기본값이 같은가** — 요약이 든 기본값과 실제 선언의 기본값이 다르면, 아무 설정이 없는
 *    환경에서 요약만 딴소리를 한다.
 *
 * 리포 밖 파일을 읽는 검사라 `:app:test` 의 입력 선언이 함께 필요하다 — 없으면 그 파일을
 * 고쳐도 `UP-TO-DATE` 로 가드가 안 돈다(anti-patterns, TRIP-858).
 */
class RuntimeModeSummaryTest : StringSpec({

    fun repoFile(rel: String): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            val f = File(dir, rel)
            if (f.isFile) return f
            dir = dir.parentFile
        }
        error("파일을 찾지 못했습니다: $rel")
    }

    /**
     * yml 을 **전체 경로**로 펴서 읽는다.
     *
     * 잎 이름(`mode`)으로 찾으면 안 된다 — 일곱 스위치가 전부 `mode` 로 끝나서 **첫 번째
     * `mode:` 한 줄이 전부의 답이 된다**(이 테스트를 처음 쓸 때 실제로 그렇게 짜서, 다섯 개가
     * 한꺼번에 `off` 로 읽히는 거짓 실패를 봤다).
     */
    fun flattenYml(text: String): Map<String, String> {
        val out = mutableMapOf<String, String>()
        val stack = mutableListOf<String>()
        text.lineSequence().forEach { raw ->
            if (raw.isBlank() || raw.trimStart().startsWith("#")) return@forEach
            val m = Regex("""^(\s*)([A-Za-z][\w.-]*):\s*(.*)$""").find(raw) ?: return@forEach
            val depth = m.groupValues[1].length / 2
            while (stack.size > depth) stack.removeLast()
            stack.add(m.groupValues[2])
            val v = m.groupValues[3].substringBefore('#').trim()
            if (v.isNotEmpty()) out[stack.joinToString(".")] = v
        }
        return out
    }

    /** `${'$'}{ENV:기본값}` 에서 기본값만. 선언이 없으면 null. */
    fun declaredDefault(path: String): String? {
        val yml = repoFile("backend/app/src/main/resources/application.yml").readText()
        flattenYml(yml)[path]?.let { decl ->
            return Regex("""^\$\{[A-Z_]+:(.*)}$""").find(decl)?.groupValues?.get(1) ?: decl
        }
        val srcRoots = listOf("backend/modules", "backend/app/src/main", "backend/common")
        val hit = srcRoots.asSequence()
            .map { File(repoFile("backend/settings.gradle.kts").parentFile.parentFile, it) }
            .filter { it.isDirectory }
            .flatMap { it.walkTopDown().filter { f -> f.extension == "kt" } }
            .mapNotNull {
                Regex("""\$\{${Regex.escape(path)}:([^}]*)}""").find(it.readText())?.groupValues?.get(1)
            }
            .firstOrNull()
        return hit
    }

    "요약이 든 프로퍼티 경로가 전부 실재한다" {
        val missing = (RuntimeModeSummary.switchPaths() + RuntimeModeSummary.secretPaths())
            .filter { declaredDefault(it) == null }

        // 경로를 틀리면 예외 없이 기본값이 찍혀 **요약이 조용히 거짓말한다** — 그래서 여기서 센다.
        missing shouldContainExactly emptyList()
    }

    "요약의 기본값이 실제 선언과 같다" {
        val mismatched = RuntimeModeSummary.switchDefaults()
            .filter { (path, mine) -> declaredDefault(path) != mine }
            .map { (path, mine) -> "$path: 요약=$mine 선언=${declaredDefault(path)}" }

        mismatched shouldContainExactly emptyList()
    }

    /**
     * **비밀은 값이 아니라 유무만 찍는다**(SECURITY-12). 이 규칙이 깨지면 기동 로그에 서명키가
     * 그대로 남고, 로그는 수집기로 흘러가 되돌릴 수 없다.
     */
    "비밀 항목은 값을 찍지 않는다" {
        val src = repoFile("backend/app/src/main/kotlin/com/trippilot/app/observability/RuntimeModeSummary.kt")
            .readText()

        src.contains("""if (env.getProperty(key).isNullOrBlank()) "없음" else "있음"""") shouldBe true
    }
})
