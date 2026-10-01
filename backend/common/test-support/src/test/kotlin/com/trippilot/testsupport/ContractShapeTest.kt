package com.trippilot.testsupport

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.string.shouldContain
import tools.jackson.databind.json.JsonMapper

/**
 * 검사기의 **자기 시험**.
 *
 * ## 왜 있어야 하나
 *
 * [ContractShape] 는 세 경계 게이트가 공유하는 판정기다. **이것이 조용히 고장 나면 세 게이트가
 * 전부 엉뚱한 이유로 초록이 된다** — 어긋남이 없어서가 아니라 못 보게 돼서.
 *
 * 실제로 겪었다(2026-09-16): 검사기의 배열 재귀를 없애고 보고를 지우는 변이를 각각 넣었는데
 * **어느 게이트도 안 죽었다.** 그 시점의 경계들이 마침 다 성해서 잡을 어긋남이 없었기 때문이다.
 * 즉 "지금 초록"과 "볼 수 있음"이 구분되지 않았다. 이 파일이 그 구분을 만든다.
 *
 * 그래서 아래는 **일부러 어긋난 값**을 먹여 검사기가 잡는지 본다 — 계약이 성한지가 아니라
 * **검사기가 눈을 뜨고 있는지**를 재는 스펙이다.
 */
class ContractShapeTest : StringSpec({

    // 표본이 Map·List 라 Kotlin 모듈이 필요 없다 — 검사기가 보는 것은 직렬화 결과지 타입이 아니다.
    val mapper = JsonMapper.builder().build()

    /** 최소 계약 — `items` 가 객체를 요구하는 배열 하나. 오늘 두 경계가 틀린 바로 그 모양이다. */
    val schemas = mapper.readTree(
        """
        {"Req": {"properties": {
            "slots":  {"type":"array","items":{"${'$'}ref":"#/components/schemas/Slot"}},
            "title":  {"type":"string"},
            "count":  {"type":"integer"},
            "ratio":  {"type":"number"},
            "note":   {"anyOf":[{"type":"string"},{"type":"null"}]},
            "reason": {"anyOf":[{"${'$'}ref":"#/components/schemas/Reason"},{"type":"null"}]},
            "either": {"anyOf":[{"${'$'}ref":"#/components/schemas/Reason"},{"type":"string"}]}
         }},
         "Slot": {"properties": {"name": {"type":"string"}}},
         "Reason": {"properties": {"code": {"type":"string"}, "params": {"type":"object"}}}}
        """.trimIndent(),
    )

    fun check(value: Any) = ContractShape.mismatches(mapper, schemas, value, "Req")

    "성한 값은 어긋남이 없다" {
        check(mapOf("slots" to listOf(mapOf("name" to "성산일출봉")), "title" to "제주", "count" to 3)).shouldBeEmpty()
    }

    /** **이 리포에서 두 번 난 실제 버그다**(알림 `slots`, 회고 `events`). */
    "배열 원소가 객체여야 하는데 문자열이면 잡는다" {
        val found = check(mapOf("slots" to listOf("성산일출봉")))

        found.single() shouldContain "slots[0]"
        found.single() shouldContain "우리=string"
    }

    "중첩 객체 안쪽이 어긋나도 잡는다 — 겉은 멀쩡해 보인다" {
        check(mapOf("slots" to listOf(mapOf("name" to 1)))).single() shouldContain "slots[0].name"
    }

    "스칼라 종류가 다르면 잡는다" {
        check(mapOf("title" to 1)).single() shouldContain "title"
        check(mapOf("count" to "셋")).single() shouldContain "count"
    }

    /** 계약이 number 인데 정수를 보내는 것은 어긋남이 아니다 — 잡으면 헛경보만 는다. */
    "정수를 number 자리에 보내는 것은 어긋남이 아니다" {
        check(mapOf("ratio" to 3)).shouldBeEmpty()
    }

    /**
     * **null 은 판정하지 않는다.** 값이 없으면 우리가 의도한 타입을 알 수 없다 —
     * nullable 여부는 이 검사가 아니라 실호출이 답한다.
     */
    "null 은 건너뛴다" {
        check(mapOf("note" to null, "slots" to null)).shouldBeEmpty()
    }

    /** `anyOf`(= nullable 표기)의 갈래를 모두 펴야 한다 — 안 그러면 성한 값에 헛경보가 난다. */
    "anyOf 갈래 중 하나와 맞으면 통과한다" {
        check(mapOf("note" to "괜찮다")).shouldBeEmpty()
    }

    /**
     * **모양을 말하지 않는 스키마에는 주장하지 않는다.** 계약이 비워 둔 자리를 우리가 추측해
     * 빨갛게 만들면, 게이트가 "계약이 아직 안 정한 것"까지 막아 버린다.
     */
    "계약에 없는 필드는 판정하지 않는다" {
        check(mapOf("모르는필드" to listOf(1, 2))).shouldBeEmpty()
    }

    /** 어긋남이 여럿이면 여럿 다 보고한다 — 한 번 고치고 또 빨개지는 것을 줄인다. */
    "어긋남이 여럿이면 전부 보고한다" {
        check(mapOf("title" to 1, "count" to "셋")).map { it.substringBefore(":") }
            .shouldContainExactly(listOf("title", "count"))
    }

    /**
     * **nullable 객체 안쪽까지 내려간다.** `anyOf: [T, null]` 을 안 벗기면 `properties` 를 못 찾아
     * 그 아래가 통째로 무검사가 된다 — 실측(2026-09-20)으로 재계획 경계의 `empty_reason` 이
     * 그렇게 게이트 밖에 있었다. 계약을 흔들어 봤는데 아무 스펙도 안 깨져서 알았다.
     */
    "nullable 객체 안쪽이 어긋나도 잡는다" {
        check(mapOf("reason" to mapOf("code" to "NO_CANDIDATE", "params" to "문자열")))
            .map { it.substringBefore(":") }.shouldContainExactly(listOf("reason.params"))
    }

    "성한 nullable 객체에는 헛경보가 없다" {
        check(mapOf("reason" to mapOf("code" to "NO_CANDIDATE", "params" to mapOf("from" to "17:00")))).shouldBeEmpty()
    }

    /**
     * 갈래가 둘 이상이면 **어느 쪽인지 우리가 정할 수 없다** — 벗기지 않고 주장도 하지 않는다.
     * 여기서 한쪽을 골라 내려가면 다른 갈래를 쓴 성한 값이 빨개진다.
     */
    "진짜 갈래가 여럿인 anyOf 는 안쪽을 주장하지 않는다" {
        check(mapOf("either" to mapOf("code" to 1))).shouldBeEmpty()
    }
})
