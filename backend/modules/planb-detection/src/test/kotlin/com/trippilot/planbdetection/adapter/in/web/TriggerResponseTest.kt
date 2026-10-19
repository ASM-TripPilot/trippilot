package com.trippilot.planbdetection.adapter.`in`.web

import com.trippilot.planbdetection.application.TriggerDetail
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerState
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** 응답 모양 — 출처 표기(CD5 `attribution`)와 상세의 추가 필드. */
class TriggerResponseTest : StringSpec({

    fun withSource(source: String?) = PlanBTrigger.active(
        UUID.randomUUID(), UUID.randomUUID(), TriggerKind.WEATHER, LocalDate.parse("2026-10-20"), null,
        source?.let { mapOf(PlanBTrigger.PAYLOAD_DATA_SOURCE to it) } ?: emptyMap(),
        TriggerScope.PARTIAL_SLOTS, "사유", Instant.EPOCH,
    )

    "출처 표기는 공공누리 표시 의무가 있는 원천만 — 모르는 원천은 null(지어내지 않는다)" {
        TriggerResponse.from(withSource("KMA_VILAGE")).attribution shouldBe "기상청 단기예보"
        TriggerResponse.from(withSource("KMA_WARNING")).attribution shouldBe "기상청 기상특보"
        TriggerResponse.from(withSource("AIRKOREA")).attribution shouldBe "에어코리아"
        TriggerResponse.from(withSource("PLACE_STATUS")).attribution shouldBe null
        TriggerResponse.from(withSource(null)).attribution shouldBe null
    }

    "상세는 목록과 같은 필드에 지금 상태와 현재 트리거를 더한다" {
        val t = withSource("KMA_VILAGE")
        val current = UUID.randomUUID()
        val d = TriggerDetailResponse.from(TriggerDetail(t, TriggerState.EXPIRED, current))
        d.triggerId shouldBe t.triggerId
        d.attribution shouldBe "기상청 단기예보"
        d.state shouldBe TriggerState.EXPIRED
        d.currentTriggerId shouldBe current
    }
})
