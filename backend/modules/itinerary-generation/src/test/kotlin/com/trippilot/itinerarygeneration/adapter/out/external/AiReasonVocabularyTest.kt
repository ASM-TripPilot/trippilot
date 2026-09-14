package com.trippilot.itinerarygeneration.adapter.out.external

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.string
import io.kotest.property.checkAll

/**
 * FE↔AI 사유 어휘 번역(연동 설계 §3).
 *
 * 여기서만 드러나는 것 — **상대가 어휘를 검사하지 않는다**는 사실의 결과다. `reason` 은 계약상
 * 그냥 `string` 이라 오타든 FE 신규 코드든 422 가 나지 않고 통과하며, KB 검색 질의만 조용히
 * 오염된다. 즉 이 번역표가 뚫리면 **아무 데서도 빨간불이 안 켜진 채** 후보 랭킹이 나빠진다.
 */
class AiReasonVocabularyTest : StringSpec({

    "FE 카탈로그 6종이 설계 §3 표대로 번역된다" {
        val translated = listOf(
            "WEATHER", "TEMP_CLOSED", "SLOW_MOVE", "LOW_ENERGY", "FULLY_BOOKED", "JUST_CHANGE",
        ).map { AiReasonVocabulary.toAi(it) }

        translated shouldBe listOf("weather", "closed", "delay", "fatigue", "fully_booked", "none")
    }

    /**
     * 예약 마감(`FULLY_BOOKED`)과 예약 취소(`canceled`)는 다른 사유다 — 정본 3곳이 한 항목으로
     * 묶어 놨던 것을 상대가 값을 열며 갈랐다. 여기서 묶으면 "마감이라 못 간다"가 "취소했다"로 읽힌다.
     */
    "예약 마감은 취소로 번역되지 않는다" {
        AiReasonVocabulary.toAi("FULLY_BOOKED") shouldBe "fully_booked"
        AiReasonVocabulary.AI_VOCABULARY shouldContainExactlyInAnyOrder
            listOf("weather", "closed", "delay", "fatigue", "fully_booked", "none")
    }

    "사유 없는 흐름(h12·h18 편집)은 null 이 와도 사유 없음으로 나간다" {
        AiReasonVocabulary.toAi(null) shouldBe AiReasonVocabulary.NONE
    }

    /**
     * 미지 어휘는 **버리지 않고 눕힌다**(INV-4). 400 으로 막지 않는 이유는 사유가 랭킹 힌트일 뿐이라
     * FE 카탈로그가 앞서 나갔다고 교체 기능 자체가 멈추면 손해가 더 크기 때문이다.
     */
    "모르는 어휘는 요청을 깨뜨리지 않고 사유 없음으로 눕는다" {
        AiReasonVocabulary.toAi("PANDEMIC") shouldBe AiReasonVocabulary.NONE
        AiReasonVocabulary.toAi("weather") shouldBe AiReasonVocabulary.NONE // 소문자 = FE 키가 아니다
    }

    /**
     * **불변식**: 무엇이 들어와도 상대 어휘 집합을 벗어나지 않는다. 이 성질이 깨지면 검증하지 않는
     * 상대에게 임의 문자열이 그대로 실려 나가 KB 질의를 오염시킨다.
     */
    "어떤 입력이 와도 와이어 값은 상대 어휘 안에 있다" {
        checkAll(Arb.string()) { raw ->
            AiReasonVocabulary.AI_VOCABULARY shouldContain AiReasonVocabulary.toAi(raw)
        }
    }
})
