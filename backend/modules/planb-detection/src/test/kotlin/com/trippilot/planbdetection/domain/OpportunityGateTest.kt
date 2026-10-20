package com.trippilot.planbdetection.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import java.time.LocalDate
import java.util.UUID

/**
 * 기회 2차 게이트(BR-SA-22 · RES-SA-09) — AI 답이 **이 질의에 대한 답으로** 성립하는가.
 *
 * 상대 판정(PBT-SA-19)이 1차다. 여기는 서버만 아는 것(보낸 슬롯·일정에 있는 장소)과 계약 모양을 다시 본다 —
 * 어긋나면 사유를 돌려주고 서비스가 답을 통째로 버린다. 각 사유마다 한 건씩 둔다(하나라도 빠지면 그 갈래가 무방비다).
 */
class OpportunityGateTest : StringSpec({

    val date = LocalDate.parse("2026-10-20")
    val p1 = UUID.fromString("e0000000-0000-4000-8000-000000000001")
    val p2 = UUID.fromString("e0000000-0000-4000-8000-000000000002")
    val planned = UUID.fromString("e0000000-0000-4000-8000-000000000003")
    val fresh = UUID.fromString("e0000000-0000-4000-8000-000000000009")
    // 계획 POI 에 슬롯의 장소를 일부러 넣지 않는다 — 상대 계약처럼 슬롯의 장소도 그 자체로 '일정에 있는 곳'인지 따로 잰다.
    val query = OpportunityQuery(
        date,
        listOf(OpportunitySlot("$date#$p1", p1, 33.45, 126.94), OpportunitySlot("$date#$p2", p2, 33.51, 126.52)),
        listOf(planned),
    )

    fun trending(poi: UUID = fresh, near: String = "$date#$p1", key: String = "trending:$poi") =
        Opportunity(key, OpportunityKind.TRENDING, null, null, null, poi, "월정리 카페거리", near, "약 400m")

    fun venue(poi: UUID = fresh, start: LocalDate? = date.minusDays(2), end: LocalDate? = date.plusDays(5), name: String? = "제주 들불축제") =
        Opportunity("event:tourapi-1", OpportunityKind.EVENT_VENUE, name, start, end, poi, "새별오름", "$date#$p2", "약 1.0km")

    "보낸 슬롯 근처의 일정 밖 장소면 통과한다 — 행사 기간이 그 날을 덮는다" {
        val other = UUID.fromString("e0000000-0000-4000-8000-000000000010")
        OpportunityGate.violation(query, listOf(venue(), trending(poi = other))).shouldBeNull()
    }

    "빈 답은 통과한다 — 없음은 정상이다" {
        OpportunityGate.violation(query, emptyList()).shouldBeNull()
    }

    "행사 첫날·마지막 날도 그 날을 덮는다" {
        OpportunityGate.violation(query, listOf(venue(start = date, end = date))).shouldBeNull()
    }

    "3건을 넘으면 계약 위반이다" {
        val four = (10..13).map { trending(poi = UUID.fromString("e0000000-0000-4000-8000-0000000000$it")) }
        OpportunityGate.violation(query, four).shouldNotBeNull()
    }

    "보내지 않은 슬롯을 가리키면 위반이다 — 앱이 그 슬롯을 찾지 못한다" {
        OpportunityGate.violation(query, listOf(trending(near = "$date#${UUID.randomUUID()}"))).shouldNotBeNull()
    }

    "이미 일정에 있는 장소면 위반이다 — 보낸 계획 POI" {
        OpportunityGate.violation(query, listOf(trending(poi = planned))).shouldNotBeNull()
    }

    "이미 일정에 있는 장소면 위반이다 — 보낸 슬롯의 장소" {
        OpportunityGate.violation(query, listOf(trending(poi = p2))).shouldNotBeNull()
    }

    "같은 장소가 두 장이면 위반이다" {
        val twice = listOf(trending(key = "trending:a"), trending(key = "trending:b"))
        OpportunityGate.violation(query, twice).shouldNotBeNull()
    }

    "같은 key 가 두 장이면 위반이다 — 기기 숨김이 key 로 갈린다" {
        val other = UUID.fromString("e0000000-0000-4000-8000-000000000010")
        OpportunityGate.violation(query, listOf(trending(key = "k"), trending(poi = other, key = "k"))).shouldNotBeNull()
    }

    "행사 카드에 행사 이름이 없으면 위반이다" {
        OpportunityGate.violation(query, listOf(venue(name = null))).shouldNotBeNull()
        OpportunityGate.violation(query, listOf(venue(name = " "))).shouldNotBeNull()
    }

    "행사 카드에 기간이 없으면 위반이다 — 앱이 'M월 d일까지'를 그리지 못한다" {
        OpportunityGate.violation(query, listOf(venue(start = null))).shouldNotBeNull()
        OpportunityGate.violation(query, listOf(venue(end = null))).shouldNotBeNull()
    }

    "그 날 열리지 않는 행사면 위반이다 — 끝났거나 아직이거나 기간이 뒤집혔다" {
        OpportunityGate.violation(query, listOf(venue(start = date.minusDays(5), end = date.minusDays(1)))).shouldNotBeNull()
        OpportunityGate.violation(query, listOf(venue(start = date.plusDays(1), end = date.plusDays(3)))).shouldNotBeNull()
        OpportunityGate.violation(query, listOf(venue(start = date.plusDays(1), end = date.minusDays(1)))).shouldNotBeNull()
    }

    "빈 key·장소 이름·거리 표시는 위반이다" {
        OpportunityGate.violation(query, listOf(trending(key = ""))).shouldNotBeNull()
        OpportunityGate.violation(query, listOf(trending().copy(poiName = " "))).shouldNotBeNull()
        OpportunityGate.violation(query, listOf(trending().copy(distanceLabel = ""))).shouldNotBeNull()
    }
})
