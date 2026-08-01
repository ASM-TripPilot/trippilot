package com.trippilot.accommodationsearch.application

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.ContentResult
import com.trippilot.accommodationsearch.domain.Money
import com.trippilot.accommodationsearch.domain.Nearby
import com.trippilot.accommodationsearch.domain.Stay
import com.trippilot.accommodationsearch.domain.StayKey
import com.trippilot.accommodationsearch.domain.StayPriceQueryPort
import com.trippilot.accommodationsearch.domain.StaySearchQuery
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe

private class NearbyFakeContent(val stays: List<Stay>) : AccommodationContentPort {
    override fun search(region: String?) =
        ContentResult(if (region == null) stays else stays.filter { it.region == region }, false)
}

private class NearbyFakePrices(val map: Map<StayKey, Money>) : StayPriceQueryPort {
    override fun lowestPrices(keys: List<StayKey>) = map.filterKeys { it in keys.toSet() }
}

/**
 * TRIP-202 — 좌표 스코프가 붙은 뒤의 탐색 동작.
 *
 * 좌표는 **필터(filter)가 아니라 스코프(scope)** 다. 이 구분이 두 군데에서 드러난다.
 *  - `filterZeroReasons` 는 amenity·stayType 만 센다 — 좌표는 "완화해 보세요" 제안 대상이 아니다.
 *    (사용자가 '내 주변'을 골랐는데 "위치를 빼보라"고 권하는 건 요청을 무르라는 말이다.)
 *  - filter-zero 원인은 **좌표 스코프 안에서** 센다 — 반경 밖 숙소가 갖고 있는 편의시설을
 *    근거로 "이 필터 때문에 0건"이라고 말하면 거짓말이 된다.
 */
class StaySearchNearbyTest : StringSpec({

    // 제주시청 · 중문(약 29.6km) · 성산(약 38km) — 반경으로 갈라지는 실측 좌표
    val jejuCity = Stay("S", "a", "제주시 호텔", 33.4996, 126.5312, "제주", setOf("주차", "조식"), "호텔")
    val jungmun = Stay("S", "b", "중문 리조트", 33.2440, 126.4120, "제주", setOf("오션뷰"), "리조트")
    val seongsan = Stay("S", "c", "성산 게하", 33.4580, 126.9420, "제주", setOf("와이파이"), "게스트하우스")
    val all = listOf(jejuCity, jungmun, seongsan)

    fun svc(prices: Map<StayKey, Money> = emptyMap()) =
        StaySearchService(NearbyFakeContent(all), NearbyFakePrices(prices))

    fun near(radiusKm: Double) = Nearby.of(33.4996, 126.5312, radiusKm)

    "반경 밖 숙소는 제외된다" {
        val r = svc().search(StaySearchQuery(nearby = near(10.0)))
        r.items.map { it.stay.externalId } shouldContainExactly listOf("a")
    }

    "반경을 넓히면 들어온다 — 31km 면 중문(30.5km)까지" {
        val r = svc().search(StaySearchQuery(nearby = near(31.0)))
        r.items.map { it.stay.externalId }.toSet() shouldBe setOf("a", "b")
    }

    "좌표가 없으면 기존 동작 그대로 — 전건 반환" {
        svc().search(StaySearchQuery()).items.size shouldBe 3
    }

    "좌표와 region 은 AND — region 이 안 맞으면 좌표가 맞아도 0건" {
        val r = svc().search(StaySearchQuery(region = "부산", nearby = near(50.0)))
        r.items shouldBe emptyList()
    }

    "좌표와 amenity 는 AND" {
        // 반경 40km 안에 a·b 둘 다 들어오지만 오션뷰는 b 뿐이다
        val r = svc().search(StaySearchQuery(nearby = near(40.0), amenities = setOf("오션뷰")))
        r.items.map { it.stay.externalId } shouldContainExactly listOf("b")
    }

    "정렬은 최저가순을 유지한다 — 거리순이 아니다(BR-U1-15)" {
        // 중심에서 가까운 순은 a·b·c 인데 가격순은 b·c·a 다. 가격순이 이겨야 한다.
        val prices = mapOf(
            jejuCity.key() to Money(200_000),
            jungmun.key() to Money(50_000),
            seongsan.key() to Money(100_000),
        )
        val r = svc(prices).search(StaySearchQuery(nearby = near(50.0)))
        r.items.map { it.stay.externalId } shouldContainExactly listOf("b", "c", "a")
    }

    "filter-zero 원인은 좌표 스코프 안에서만 센다" {
        // 오션뷰를 가진 것은 중문(b)뿐인데 반경 10km 안에는 a 만 있다.
        // 반경 밖 b 를 근거로 "오션뷰가 원인이 아니다"라고 판단하면 안 된다.
        val r = svc().search(StaySearchQuery(nearby = near(10.0), amenities = setOf("오션뷰")))
        r.items shouldBe emptyList()
        r.filterZeroReasons shouldContainExactly listOf("amenity:오션뷰")
    }

    "좌표만으로 0건이면 filterZeroReasons 는 비어 있다 — 좌표는 완화 대상이 아니다" {
        val far = Nearby.of(37.5665, 126.9780, 1.0) // 서울시청 반경 1km — 제주 숙소는 하나도 없다
        val r = svc().search(StaySearchQuery(nearby = far, amenities = setOf("주차")))
        r.items shouldBe emptyList()
        r.filterZeroReasons shouldBe emptyList()
    }
})
