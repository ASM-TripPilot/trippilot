package com.trippilot.app.architecture

import com.lemonappdev.konsist.api.Konsist
import com.lemonappdev.konsist.api.verify.assertFalse
import org.junit.jupiter.api.Test

/**
 * TRIP-150 — 소스 레벨 규칙(Konsist). R2: domain 레이어는 순수 Kotlin.
 * domain 패키지가 아직 없어 현재는 대상 0(코드 생기면 발동).
 */
class KonsistRulesTest {

    @Test
    fun `R2 domain 레이어는 프레임워크(Spring·JPA·Jackson)에 의존하지 않는다`() {
        val domainFiles = Konsist.scopeFromProject().files.filter { "/domain/" in it.path }
        if (domainFiles.isEmpty()) return // domain 레이어 미도입 — 규칙은 코드 추가 시 발동

        domainFiles.assertFalse(additionalMessage = "R2: domain 은 순수 Kotlin") { file ->
            file.imports.any { import ->
                import.name.startsWith("org.springframework") ||
                    import.name.startsWith("jakarta.persistence") ||
                    import.name.startsWith("com.fasterxml.jackson")
            }
        }
    }
}
