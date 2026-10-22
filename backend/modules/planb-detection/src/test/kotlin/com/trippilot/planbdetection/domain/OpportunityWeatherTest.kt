package com.trippilot.planbdetection.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 날씨 위험 날의 행사 거르기(BR-SA-22 ④ · G-SA-17 — 2026-10-20 결정 '야외 축제만 뺀다, 실내형 행사는 남긴다').
 *
 * 서비스는 그 날짜의 행만 넘기지만 판정은 날짜를 스스로 본다 — 넘기는 쪽이 여행 전체 행을 줘도 내일 비로 오늘 축제를
 * 빼지 않게. 그 날짜 행만 넘기는 서비스 테스트로는 이 갈래가 안 보여서 여기 둔다(역검증에서 날짜 조건을 지워도 초록이었다).
 */
class OpportunityWeatherTest : StringSpec({

    val tripId = UUID.fromString("7a3c1e2b-0000-4000-8000-000000000003")
    val date = LocalDate.parse("2026-10-20")

    fun row(
        kind: TriggerKind = TriggerKind.WEATHER,
        severity: TriggerSeverity = TriggerSeverity.RISK,
        state: TriggerState = TriggerState.ACTIVE,
        on: LocalDate = date,
    ) = PlanBTrigger.active(
        tripId, UUID.randomUUID(), kind, on, null, emptyMap(), TriggerScope.FULL_DAY, "비 예보 70%", Instant.EPOCH, severity,
    ).copy(state = state)

    fun event(type: OpportunityEventType?) = Opportunity(
        "event:tourapi-1", OpportunityKind.EVENT_NEARBY, "제주 들불축제", date, date, UUID.randomUUID(), "새별오름", "$date#p1",
        "약 300m", type,
    )

    "그 날의 날씨 위험이 떠 있거나 소비됐으면 거른다 — 주의·해제·끈 알림·다른 종류·다른 날은 아니다" {
        OpportunityWeather.blocksOutdoor(listOf(row()), date) shouldBe true
        OpportunityWeather.blocksOutdoor(listOf(row(state = TriggerState.CONSUMED)), date) shouldBe true
        listOf(
            row(severity = TriggerSeverity.CAUTION), row(state = TriggerState.EXPIRED), row(state = TriggerState.SUPPRESSED),
            row(kind = TriggerKind.CLOSURE), row(on = date.plusDays(1)),
        ).forEach { OpportunityWeather.blocksOutdoor(listOf(it), date) shouldBe false }
    }

    "남는 것은 요즘 인기와 유형을 아는 축제 아닌 행사다 — 모르는 유형을 실내라고 단정하지 않는다" {
        val trending = Opportunity(
            "trending:p2", OpportunityKind.TRENDING, null, null, null, UUID.randomUUID(), "월정리 카페거리", "$date#p1", "약 400m",
        )

        OpportunityWeather.keeps(trending) shouldBe true
        OpportunityWeather.keeps(event(OpportunityEventType.FESTIVAL)) shouldBe false
        OpportunityWeather.keeps(event(null)) shouldBe false
        listOf(OpportunityEventType.PERFORMANCE, OpportunityEventType.EXHIBITION, OpportunityEventType.POPUP)
            .forEach { OpportunityWeather.keeps(event(it)) shouldBe true }
    }
})
