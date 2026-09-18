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
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.pair
import io.kotest.property.checkAll

/**
 * TRIP-202 게이트 PBT — 좌표 스코프의 **건전성(soundness)과 완전성(completeness)**.
 *
 * 예시 테스트는 "내가 고른 몇 개"만 본다. 속성 테스트(property-based test)는 임의 입력을
 * 수백 번 만들어 **모든 입력에 대해 참인 명제**를 검사한다 — 여기서 그 명제는 둘이다.
 *  (1) 남은 것은 전부 반경 이내다   ← 반경 밖이 새어 나오면 '내 주변'이 거짓말이 된다
 *  (2) 반경 이내인 것은 하나도 안 빠졌다 ← 한쪽만 검사하면 "전부 버리기"도 (1)을 통과한다
 *
 * PBT 는 리포 CI 의 차단 게이트다. 100% 통과하지 못하면 머지 불가.
 */
private class PbtContent(val stays: List<Stay>) : AccommodationContentPort {
    override fun search(region: String?) = ContentResult(stays, false)
}

private object PbtPrices : StayPriceQueryPort {
    override fun lowestPrices(keys: List<StayKey>): Map<StayKey, Money> = emptyMap()
}

class StaySearchNearbyPropertyTest : StringSpec({

    "임의의 중심·반경·숙소 목록에 대해 좌표 스코프는 반경 이내를 정확히 남긴다" {
        checkAll(
            Arb.int(-8900..8900),      // 위도 ×100 (±89 — 극점 근처는 제외)
            Arb.int(-17900..17900),    // 경도 ×100
            Arb.int(1..2000),          // 반경 ×10 → 0.1km ~ 200km
            Arb.list(Arb.pair(Arb.int(-8900..8900), Arb.int(-17900..17900)), 0..8),
        ) { latI, lngI, radiusI, rawStays ->
            val nearby = Nearby.of(latI / 100.0, lngI / 100.0, radiusI / 10.0)!!
            val stays = rawStays.mapIndexed { i, (a, b) ->
                Stay("S", "s$i", "숙소$i", a / 100.0, b / 100.0, "제주", emptySet(), "호텔")
            }

            val got = StaySearchService(PbtContent(stays), PbtPrices)
                .search(StaySearchQuery(nearby = nearby))
                .items.map { it.stay }

            // (1) 건전성 — 남은 것은 전부 반경 이내
            got.all { nearby.covers(it.lat, it.lng) } shouldBe true

            // (2) 완전성 — 반경 이내인 것은 하나도 빠지지 않았다
            got.map { it.externalId }.toSet() shouldBe
                stays.filter { nearby.covers(it.lat, it.lng) }.map { it.externalId }.toSet()
        }
    }

    "거리는 대칭이고 음수가 아니다" {
        checkAll(
            Arb.int(-8900..8900),
            Arb.int(-17900..17900),
            Arb.int(-8900..8900),
            Arb.int(-17900..17900),
        ) { aLat, aLng, bLat, bLng ->
            val ab = com.trippilot.accommodationsearch.domain
                .distanceKm(aLat / 100.0, aLng / 100.0, bLat / 100.0, bLng / 100.0)
            val ba = com.trippilot.accommodationsearch.domain
                .distanceKm(bLat / 100.0, bLng / 100.0, aLat / 100.0, aLng / 100.0)

            (ab >= 0.0) shouldBe true
            // 부동소수 연산이라 완전 일치 대신 오차 한계로 본다(지구 둘레 4만km 기준 1m)
            (kotlin.math.abs(ab - ba) < 0.001) shouldBe true
        }
    }
})
