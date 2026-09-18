package com.trippilot.app.moderation

import com.trippilot.moderation.api.TextModerationFacade
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest

/**
 * TRIP-157 — 금칙어 사전 로드 IT. 시드(R__) 활성 사전의 jsonb entries 파싱 + 매칭을 실 DB 로 검증.
 */
@SpringBootTest
class ModerationDictionaryIT : AbstractPostgresIntegrationTest() {

    @Autowired lateinit var moderation: TextModerationFacade

    @Test
    fun `시드 활성 사전으로 금칙어를 검출한다`() {
        moderation.inspect("깨끗한닉네임").let {
            it.clean shouldBe true
            it.category.shouldBeNull()
        }
        // 시드 금칙어 '비속어예시1' 포함
        moderation.inspect("이건비속어예시1이다").let {
            it.clean shouldBe false
            it.category shouldBe "PROFANITY"
        }
    }
}
