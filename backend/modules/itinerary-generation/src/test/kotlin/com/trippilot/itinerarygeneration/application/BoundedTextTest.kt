package com.trippilot.itinerarygeneration.application

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * AI 문자열 상한(TRIP-306·308). 컬럼 상한을 넘기면 22001 로 **정상 생성된 일정이 통째로 롤백**된다 —
 * 사용자가 고칠 수 있는 값이 아니므로 거부가 아니라 자르는 것이 맞다.
 */
class BoundedTextTest : StringSpec({

    "상한 이하면 그대로 둔다" {
        BoundedText.clamp("약 1.2km · 도보 추정", BoundedText.DISTANCE_RANGE_MAX) shouldBe "약 1.2km · 도보 추정"
    }

    "null 은 null" { BoundedText.clamp(null, 60) shouldBe null }

    "상한을 넘으면 잘리고 길이가 상한을 넘지 않는다" {
        val long = "가".repeat(700)
        val clamped = BoundedText.clamp(long, BoundedText.PLACEMENT_REASON_MAX)!!
        clamped.length shouldBe BoundedText.PLACEMENT_REASON_MAX
        clamped.endsWith("…") shouldBe true // 잘렸다는 사실이 드러난다
    }

    "경계값(상한과 같은 길이)은 자르지 않는다" {
        val exact = "가".repeat(BoundedText.DISTANCE_RANGE_MAX)
        BoundedText.clamp(exact, BoundedText.DISTANCE_RANGE_MAX) shouldBe exact
    }
})
