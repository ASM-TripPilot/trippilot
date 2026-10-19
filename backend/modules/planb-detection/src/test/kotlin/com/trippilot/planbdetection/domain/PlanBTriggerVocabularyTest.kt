package com.trippilot.planbdetection.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** 변형 어휘(CD6)와 payload 한 키 한 뜻(CD5) — 해제 자격·원천·변형·영향 POI 를 행에서 읽는 법. */
class PlanBTriggerVocabularyTest : StringSpec({

    val at = Instant.parse("2026-10-20T03:00:00Z")
    val day = LocalDate.parse("2026-10-20")
    val poi = UUID.randomUUID()

    fun trigger(payload: Map<String, Any>, slotKey: String? = null) = PlanBTrigger.active(
        UUID.randomUUID(), UUID.randomUUID(), TriggerKind.WEATHER, day, slotKey, payload, TriggerScope.PARTIAL_SLOTS, "사유", at,
    )

    "변형은 닫힌 12종 — 종류와 짝이 정해져 있다(CD6)" {
        TriggerVariant.entries.size shouldBe 12
        TriggerVariant.entries.filter { it.kind == TriggerKind.WEATHER }.map { it.name } shouldBe
            listOf("RAIN", "SNOW", "WIND", "HEAT", "COLD", "CLOUD", "DUST")
        TriggerVariant.entries.filter { it.kind == TriggerKind.CLOSURE }.map { it.name } shouldBe
            listOf("CLOSED_DAY", "OUT_OF_HOURS", "HOURS_MISMATCH", "HOLIDAY", "PERMANENTLY_CLOSED")
    }

    "저장된 변형 문자열을 모르면 null — 지어내지 않는다(화면은 kind 라벨)" {
        TriggerVariant.of("HEAT") shouldBe TriggerVariant.HEAT
        TriggerVariant.of("WARNING") shouldBe null
        TriggerVariant.of(null) shouldBe null
        trigger(mapOf(PlanBTrigger.PAYLOAD_VARIANT to "SKY_HIDDEN")).variant shouldBe null
    }

    "payload 의 해제 자격·원천·변형을 읽는다 — 한 키 한 뜻(CD5)" {
        val t = trigger(
            mapOf(
                PlanBTrigger.PAYLOAD_VARIANT to "RAIN",
                PlanBTrigger.PAYLOAD_DETECTOR to "kma-forecast",
                PlanBTrigger.PAYLOAD_DATA_SOURCE to "KMA_VILAGE",
            ),
        )
        t.variant shouldBe TriggerVariant.RAIN
        t.detector shouldBe "kma-forecast"
        t.dataSource shouldBe "KMA_VILAGE"
        trigger(emptyMap()).detector shouldBe null
    }

    "영향 POI — payload 에 있으면 그것, 없으면 슬롯 키의 POI, 날짜 전체면 없음" {
        trigger(mapOf(PlanBTrigger.PAYLOAD_POI_IDS to listOf(poi.toString()))).poiIds shouldBe listOf(poi.toString())
        trigger(emptyMap(), slotKey = "$day#$poi").poiIds shouldBe listOf(poi.toString())
        trigger(emptyMap()).poiIds shouldBe emptyList()
    }
})
