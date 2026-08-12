package com.trippilot.placedata.application

import com.trippilot.placedata.api.DomesticCheck
import com.trippilot.placedata.domain.GeoPoint
import com.trippilot.placedata.domain.RegionGeocodePort
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * 국내강제 판정(INV-U1-12 · BR-U1-35).
 *
 * 이전 구현은 지역명 28개와 문자열 일치를 봤고, `천안`·`순천`·`속초시`·`제주특별자치도` 가 전부 막혔다.
 * 여기서 지키는 것은 두 가지다 — **정상 국내 이름이 막히지 않는 것**, 그리고
 * **확인하지 못한 것을 국외로 접지 않는 것**(벤더 장애가 곧 생성 불가가 되면 안 된다).
 */
class DomesticRegionServiceTest : StringSpec({

    class Geo(
        val address: Map<String, GeoPoint> = emptyMap(),
        val fail: Boolean = false,
    ) : RegionGeocodePort {
        var addressCalls = 0
        override fun searchAddress(query: String): List<GeoPoint> {
            addressCalls++
            if (fail) throw IllegalStateException("vendor down")
            return address[query]?.let { listOf(it) }.orEmpty()
        }
    }

    val cheonan = GeoPoint(36.8151, 127.1139)

    "행정구역은 주소검색으로 국내 판정" {
        DomesticRegionService(Geo(address = mapOf("천안" to cheonan))).check("천안") shouldBe DomesticCheck.INSIDE
    }

    // 키워드 검색을 폴백으로 붙였다가 실호출에서 뚫렸다 — 해외 도시명이 국내 상호에 흔하다
    // (`도쿄`→도쿄쿠루미/서울 · `파리`→파리문화공원/서울 · `오사카`→오사카/부산).
    // 주소검색 0건이면 국외다. 시·군·구 10종이 전부 1건, 해외 5종이 전부 0건으로 갈렸다.
    "주소검색이 0건이면 국외 — 키워드로 내려가지 않는다" {
        val geo = Geo()
        DomesticRegionService(geo).check("도쿄") shouldBe DomesticCheck.OUTSIDE
        geo.addressCalls shouldBe 1
    }

    "구 단위 지역도 국내로 판정" {
        DomesticRegionService(Geo(address = mapOf("사하구" to GeoPoint(35.1046, 128.9746))))
            .check("사하구") shouldBe DomesticCheck.INSIDE
    }

    // 벤더 DB 가 넓어져도 불변식은 지켜야 한다 — 2차 방어.
    "좌표가 대한민국 영역 밖이면 국외" {
        val tokyo = GeoPoint(35.6762, 139.6503)
        DomesticRegionService(Geo(address = mapOf("도쿄" to tokyo))).check("도쿄") shouldBe DomesticCheck.OUTSIDE
    }

    "호출이 실패하면 국외가 아니라 확인 불가" {
        DomesticRegionService(Geo(fail = true)).check("천안") shouldBe DomesticCheck.UNKNOWN
    }

    // 여행지는 반복되는 값이다. 캐시가 없으면 생성마다 외부를 부르고 쿼터·장애가 곧 실패율이 된다.
    "확정 판정은 캐시되어 외부를 다시 부르지 않는다" {
        val geo = Geo(address = mapOf("제주" to GeoPoint(33.4996, 126.5312)))
        val svc = DomesticRegionService(geo)
        repeat(3) { svc.check("제주") shouldBe DomesticCheck.INSIDE }
        geo.addressCalls shouldBe 1
    }

    // "지금 못 물어봤다"는 지역의 성질이 아니다 — 캐시하면 벤더가 살아나도 계속 모른다고 답한다.
    "확인 불가는 캐시하지 않는다" {
        val geo = Geo(fail = true)
        val svc = DomesticRegionService(geo)
        repeat(3) { svc.check("천안") shouldBe DomesticCheck.UNKNOWN }
        geo.addressCalls shouldBe 3
    }

    "빈 지역명은 확인 불가" {
        val geo = Geo()
        DomesticRegionService(geo).check("  ") shouldBe DomesticCheck.UNKNOWN
        geo.addressCalls shouldBe 0
    }
})
