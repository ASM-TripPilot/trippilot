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

    "서로게이트 페어 한가운데서 자르지 않는다(이모지가 깨지지 않게)" {
        // 자를 위치(max-1)가 이모지 페어 한가운데가 되도록 구성
        val text = "가".repeat(BoundedText.DISTANCE_RANGE_MAX - 2) + "\uD83C\uDFD6" + "나".repeat(20)
        val clamped = BoundedText.clamp(text, BoundedText.DISTANCE_RANGE_MAX)!!

        (clamped.length <= BoundedText.DISTANCE_RANGE_MAX) shouldBe true
        // 마지막이 고아 서로게이트로 끝나면 UTF-8 인코딩에서 문자가 깨진다
        clamped.dropLast(1).lastOrNull()?.isHighSurrogate() shouldBe false
    }

    "경계값(상한과 같은 길이)은 자르지 않는다" {
        val exact = "가".repeat(BoundedText.DISTANCE_RANGE_MAX)
        BoundedText.clamp(exact, BoundedText.DISTANCE_RANGE_MAX) shouldBe exact
    }
})
