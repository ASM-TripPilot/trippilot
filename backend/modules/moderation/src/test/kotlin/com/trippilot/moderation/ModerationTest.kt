package com.trippilot.moderation

import com.trippilot.core.error.ModerationUnavailable
import com.trippilot.moderation.application.TextModerationService
import com.trippilot.moderation.domain.BannedWord
import com.trippilot.moderation.domain.BannedWordDictionary
import com.trippilot.moderation.domain.BannedWordDictionaryRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe

private class FakeDictRepo(private val dict: BannedWordDictionary?) : BannedWordDictionaryRepository {
    override fun findActive() = dict
}

class ModerationTest : StringSpec({

    val dict = BannedWordDictionary(
        "v1",
        listOf(BannedWord("비속어", "PROFANITY"), BannedWord("hate", "HATE")),
        active = true,
    )

    "정규화 부분일치 — 공백·대소문자 무시" {
        dict.match("이건 비 속 어 다")?.category shouldBe "PROFANITY" // "이건비속어다" ⊇ "비속어"
        dict.match("I HATE it")?.category shouldBe "HATE"             // "ihateit" ⊇ "hate"
    }

    "금칙어 없으면 null" {
        dict.match("깨끗한닉네임").shouldBeNull()
    }

    "빈 단어는 매칭하지 않는다" {
        BannedWordDictionary("v", listOf(BannedWord("", "X")), true).match("아무거나").shouldBeNull()
    }

    "서비스 — 금칙어 포함이면 clean=false + 범주(원문 미포함)" {
        val svc = TextModerationService(FakeDictRepo(dict))
        svc.inspect("나쁜비속어닉").let {
            it.clean shouldBe false
            it.category shouldBe "PROFANITY"
        }
        svc.inspect("멋진닉네임").let {
            it.clean shouldBe true
            it.category.shouldBeNull()
        }
    }

    "서비스 — 활성 사전 없으면 ModerationUnavailable(fail-closed, INV-B2)" {
        shouldThrow<ModerationUnavailable> { TextModerationService(FakeDictRepo(null)).inspect("x") }
    }
})
