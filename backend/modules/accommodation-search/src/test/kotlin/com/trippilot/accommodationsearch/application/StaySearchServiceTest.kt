package com.trippilot.accommodationsearch.application

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.ContentResult
import com.trippilot.accommodationsearch.domain.Money
import com.trippilot.accommodationsearch.domain.Stay
import com.trippilot.accommodationsearch.domain.StayKey
import com.trippilot.accommodationsearch.domain.StayPriceQueryPort
import com.trippilot.accommodationsearch.domain.StaySearchQuery
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

private class FakeContent(val stays: List<Stay>, val degraded: Boolean = false) : AccommodationContentPort {
    override fun search(region: String?) =
        ContentResult(if (region == null) stays else stays.filter { it.region == region }, degraded)
}

private class FakePrices(val map: Map<StayKey, Money>) : StayPriceQueryPort {
    override fun lowestPrices(keys: List<StayKey>) = map.filterKeys { it in keys.toSet() }
}

class StaySearchServiceTest : StringSpec({

    val a = Stay("S", "a", "A", 33.0, 126.0, "제주", setOf("주차", "조식"), "호텔")
    val b = Stay("S", "b", "B", 33.1, 126.1, "제주", setOf("와이파이"), "게스트하우스")
    val c = Stay("S", "c", "C", 33.2, 126.2, "제주", setOf("주차"), "펜션")

    "최저가순 정렬 · 가격 미확인은 맨 뒤(BR-U1-15·14)" {
        val svc = StaySearchService(
            FakeContent(listOf(a, b, c)),
            FakePrices(mapOf(a.key() to Money(90_000), c.key() to Money(70_000))),
        )
        val r = svc.search(StaySearchQuery())
        r.items.map { it.stay.externalId } shouldBe listOf("c", "a", "b") // 70k · 90k · 미확인
        r.items.last().lowestPrice shouldBe null
    }

    "amenity 필터는 AND 매칭" {
        val svc = StaySearchService(FakeContent(listOf(a, b, c)), FakePrices(emptyMap()))
        val r = svc.search(StaySearchQuery(amenities = setOf("주차", "조식")))
        r.items.map { it.stay.externalId } shouldBe listOf("a")
    }

    "필터로 0건이면 원인 필터 반환(BR-U1-16)" {
        val svc = StaySearchService(FakeContent(listOf(a, b, c)), FakePrices(emptyMap()))
        val r = svc.search(StaySearchQuery(amenities = setOf("수영장")))
        r.items shouldBe emptyList()
        r.filterZeroReasons shouldBe listOf("amenity:수영장")
    }

    "조합 필터로 0건이면 활성 필터 전부를 완화 후보로(BR-U1-16 조합)" {
        // 호텔 AND 와이파이 → a(호텔·와이파이 없음)·b(와이파이·게스트하우스) 각각 실패지만 개별론 매칭됨
        val svc = StaySearchService(FakeContent(listOf(a, b, c)), FakePrices(emptyMap()))
        val r = svc.search(StaySearchQuery(stayTypes = setOf("호텔"), amenities = setOf("와이파이")))
        r.items shouldBe emptyList()
        r.filterZeroReasons shouldBe listOf("stayType", "amenity:와이파이")
    }

    "필터 없이 0건이면 filter-zero 사유 없음" {
        val svc = StaySearchService(FakeContent(emptyList()), FakePrices(emptyMap()))
        svc.search(StaySearchQuery()).filterZeroReasons shouldBe emptyList()
    }

    "일부 공급자 실패 시 degraded=true(BR-U1-17)" {
        val svc = StaySearchService(FakeContent(listOf(a), degraded = true), FakePrices(emptyMap()))
        svc.search(StaySearchQuery()).degraded shouldBe true
    }
})
