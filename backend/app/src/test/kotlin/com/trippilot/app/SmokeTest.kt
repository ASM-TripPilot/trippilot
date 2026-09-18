package com.trippilot.app

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * 걷는 뼈대 스모크 테스트 — 빌드/테스트 하네스가 도는지 확인한다.
 * Spring 컨텍스트 로딩·통합 테스트는 TRIP-149(테스트 하네스)에서 도입한다.
 */
class SmokeTest : StringSpec({
    "빌드·테스트 하네스가 동작한다" {
        (1 + 1) shouldBe 2
    }
})
