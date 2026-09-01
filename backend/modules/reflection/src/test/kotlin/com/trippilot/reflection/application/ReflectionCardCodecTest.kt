package com.trippilot.reflection.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * 카드 읽기의 경계값.
 *
 * **왜 400 이어야 하는가.** 도메인 [com.trippilot.reflection.domain.ReflectionCard] 도 빈 제목을
 * 막지만 그것은 `require`(=500)다. 사용자가 보낸 카드가 잘못된 것을 서버 장애로 알리면 화면이
 * "잠시 후 다시" 를 띄우고 사용자는 같은 실패를 반복한다 — 재시도로 풀리지 않는다.
 *
 * 이 스펙이 없을 때 코덱의 검사를 지워도 **아무 테스트도 깨지지 않았다**(역검증 실측) — 빈 제목
 * 카드를 보내는 경로가 어디에도 없었기 때문이다.
 */
class ReflectionCardCodecTest : StringSpec({

    val codec = ReflectionCardCodec(ObjectMapper())

    fun card(title: String) =
        """{"template_id":"user.edit.v1","format":"CARD","cover":{"title":"$title","subtitle":"부제"},"scenes":[]}"""

    "정상 카드는 제목·부제를 뽑아 온다" {
        val read = codec.read(card("제주 하루"))

        read.title shouldBe "제주 하루"
        read.subtitle shouldBe "부제"
        read.templateId shouldBe "user.edit.v1"
    }

    "제목이 비면 400 이다 — 통과시키면 목록에 빈 줄이 그려진다(PBT-U5-F1)" {
        val ex = shouldThrow<ValidationFailed> { codec.read(card("")) }

        ex.fieldErrors.single().field shouldBe "card.cover.title"
    }

    "cover 가 아예 없어도 400 이다" {
        shouldThrow<ValidationFailed> { codec.read("""{"template_id":"x","scenes":[]}""") }
    }

    "공백뿐인 제목도 빈 것으로 본다" {
        shouldThrow<ValidationFailed> { codec.read(card("   ")) }
    }

    "JSON 이 아니면 400 이다 — 500 이면 사용자가 자기 입력 오류를 서버 장애로 읽는다" {
        shouldThrow<ValidationFailed> { codec.read("이건 JSON 이 아니다") }
    }

    "객체가 아닌 JSON 도 400 이다" {
        shouldThrow<ValidationFailed> { codec.read("""["카드가 아니라 배열"]""") }
    }

    /**
     * `scenes` 안쪽은 **통과시킨다**(DEC-U5-14). 우리가 재검증하면 상대가 템플릿을 하나 늘릴 때마다
     * 우리 마이그레이션이 된다 — 모르는 필드가 있어도 원문 그대로 보관한다.
     */
    "모르는 필드가 있어도 통과하고 원문에 남는다" {
        val read = codec.read(
            """{"template_id":"ai.v9","format":"CARD","cover":{"title":"제목","subtitle":""},""" +
                """"scenes":[{"layout":"PHOTO","caption":"c","source_event":"e"}],"미래필드":{"a":1}}""",
        )

        read.payload.contains("미래필드") shouldBe true
        read.payload.contains("source_event") shouldBe true
    }
})
