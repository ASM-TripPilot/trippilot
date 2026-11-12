package com.trippilot.notification.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.property.Arb
import io.kotest.property.PropTestConfig
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.string
import io.kotest.property.checkAll

/**
 * 문구의 근거 지문 — 발화가 "문구를 만들 때 본 일정 그대로인가"를 가르는 값. 지켜져야 하는 것:
 * 같은 목록은 늘 같은 값(결정적) · **순서가 바뀌면 다른 값**("A 에서 시작"이 거짓이 된다) · 이름 경계가 달라지면 다른 값 · 길이가 컬럼(32) 안.
 */
class CopyBasisTest : StringSpec({

    "같은 이름 목록은 늘 같은 지문이다" {
        checkAll(PropTestConfig(iterations = 100), Arb.list(Arb.string(0..12), 0..6)) { names ->
            CopyBasis.of(names) shouldBe CopyBasis.of(names.toList())
        }
    }

    "순서가 바뀌면 지문이 달라진다 — 그날 첫 곳이 바뀐 일정에 옛 문구가 나가면 안 된다" {
        CopyBasis.of(listOf("성산일출봉", "섭지코지")) shouldNotBe CopyBasis.of(listOf("섭지코지", "성산일출봉"))
    }

    "이름을 바꾸거나 더하거나 빼면 지문이 달라진다" {
        val base = listOf("성산일출봉", "섭지코지")
        CopyBasis.of(base) shouldNotBe CopyBasis.of(listOf("성산일출봉", "우도"))        // 교체
        CopyBasis.of(base) shouldNotBe CopyBasis.of(base + "우도")                        // 추가
        CopyBasis.of(base) shouldNotBe CopyBasis.of(base.drop(1))                         // 삭제
        CopyBasis.of(base) shouldNotBe CopyBasis.of(emptyList())                          // 그날 일정이 비었다
    }

    "이름 사이 경계가 다르면 다른 지문이다 — 맞붙인 글자가 같아도" {
        CopyBasis.of(listOf("가나", "다")) shouldNotBe CopyBasis.of(listOf("가", "나다"))
        CopyBasis.of(listOf("가나다")) shouldNotBe CopyBasis.of(listOf("가나", "다"))
    }

    "지문은 항상 컬럼 폭(32) 안의 소문자 16진수다" {
        checkAll(PropTestConfig(iterations = 100), Arb.list(Arb.string(0..20), 0..8)) { names ->
            val basis = CopyBasis.of(names)
            (basis.length <= 32 && basis.matches(Regex("[0-9a-f]+"))) shouldBe true
        }
    }
})
