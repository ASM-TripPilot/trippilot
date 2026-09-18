package com.trippilot.profile.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.checkAll
import kotlin.random.Random

/** 닉네임 규칙(길이) + 생성 폴백 수렴(재추첨→자릿수 확장, INV-P1). */
class NicknameTest : StringSpec({

    "길이 규칙 — 2~20자" {
        NicknameRules.lengthViolation("가") shouldBe NicknameCheckReason.TOO_SHORT
        NicknameRules.lengthViolation("여행자") shouldBe null
        NicknameRules.lengthViolation("가".repeat(21)) shouldBe NicknameCheckReason.TOO_LONG
    }

    "생성 — 수용 조건이 참이면 형용사+명사+숫자 후보 반환" {
        val nickname = NicknameGenerator.generate(Random(42)) { true }
        nickname.shouldNotBeNull()
        NicknameRules.lengthViolation(nickname) shouldBe null // 생성값은 길이 규칙 충족
    }

    "PBT — 앞선 후보를 거부해도 수렴한다(재추첨 10회 → 자릿수 확장)" {
        checkAll(Arb.int(0..18)) { rejectFirst ->
            var seen = 0
            val nickname = NicknameGenerator.generate(Random(7)) { seen++ >= rejectFirst } // 처음 rejectFirst 개 거부
            nickname.shouldNotBeNull() // 총 20회 시도 내 수렴
        }
    }

    "모든 후보가 거부되면 null(수렴 실패 신호)" {
        NicknameGenerator.generate(Random(1)) { false }.shouldBeNull()
    }
})
