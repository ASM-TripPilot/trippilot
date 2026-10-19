package com.trippilot.placedata.domain

import com.trippilot.placedata.FakeRegionCatalog
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * 주소 → 행정구역 표준코드(TRIP-359).
 *
 * 이 판정이 왜 필요한지가 첫 테스트에 있다 — 수집분이 주는 `region` 은 시군구 이름뿐이라
 * `동구` 하나가 6개 시도에 걸쳐 118건이었다(실측). 이름만 보면 어느 동구인지 정할 수 없다.
 */
class RegionResolverTest : StringSpec({

    val catalog = FakeRegionCatalog.rows
    fun resolve(address: String?) = RegionResolver.resolve(address, catalog)

    "같은 이름이 여러 시도에 있어도 주소가 하나로 정한다" {
        resolve("부산광역시 동구 초량동 1") shouldBe "26170"
        resolve("대구광역시 동구 신암동 1") shouldBe "27140"
    }

    "평범한 주소는 시군구까지 내려간다" {
        resolve("서울특별시 양천구 신정동 162-56") shouldBe "11470"
    }

    /**
     * 행정구는 목적지가 아니다(V2.24 `selectable=false`). 커버리지는 **고를 수 있는 단위**에 쌓여야
     * 화면이 "여기는 준비됐다"를 말할 수 있으므로 상위 시(市)로 접는다.
     */
    "일반시의 행정구는 상위 시로 접는다" {
        resolve("경기도 수원시 장안구 정자동 1") shouldBe "41110"
    }

    "시군구가 없는 단층제는 시도가 곧 목적지다" {
        resolve("세종특별자치시 한누리대로 2130") shouldBe "36"
    }

    "시도는 알아도 시군구를 모르면 시도까지만 내려간다" {
        resolve("제주특별자치도 없는시 어딘가로 1") shouldBe "50"
    }

    /**
     * TourAPI 원본이 시도 이름을 잘라 보낼 때가 있다(실측: #1427 병합본 60,266건 중 2건 —
     * `부산광역 사하구 …`, `제주특별자치 서귀포시 …`). 정확 일치만 보면 이 둘이 지역 미판정으로 빠지고,
     * 실 수집본 적재 테스트가 develop 에서 깨졌다(TRIP-1471).
     */
    "시도 이름이 잘려 와도 그 이름으로 시작하는 시도가 하나뿐이면 그 시도로 정한다" {
        resolve("부산광역 동구 초량동 1") shouldBe "26170"
        resolve("제주특별자치 제주시 한경면 청수리") shouldBe "50110"
    }

    /** 잘린 이름이 시도 둘에 걸리면 고르지 않는다 — 임의로 고르면 커버리지가 엉뚱한 시도에 쌓인다. */
    "잘린 이름이 시도 둘 이상에 걸리거나 한 글자뿐이면 정하지 않는다" {
        val withGyeongsang = catalog + listOf(
            Region("47", "경상북도", "47", "경상북도", RegionLevel.SIDO, true, 0),
            Region("48", "경상남도", "48", "경상남도", RegionLevel.SIDO, true, 0),
        )
        RegionResolver.resolve("경상 어딘가 1", withGyeongsang) shouldBe null
        resolve("부 동구 초량동 1") shouldBe null
    }

    /**
     * **못 정하면 null 이다.** 가까운 지역으로 밀어 넣으면 그 지역 커버리지가 부풀어
     * "POI 가 있다"고 말하게 되고, 사용자는 후보가 없는 곳을 고른다(INV-1·INV-4).
     */
    "시도조차 못 읽으면 코드를 붙이지 않는다" {
        resolve("Tokyo, Japan") shouldBe null
        resolve("") shouldBe null
        resolve("   ") shouldBe null
        resolve(null) shouldBe null
    }
})

/** 시도 코드는 그 안 시군구 코드의 접두사다 — 접두사 합이 곧 롤업이다. */
class RegionCoverageTest : StringSpec({

    val counts = mapOf("11470" to 3, "11680" to 2, "26170" to 5, "50" to 27)

    "시군구는 자기 것만 센다" {
        coverageOf("11470", counts) shouldBe 3
    }

    "시도는 하위 시군구를 모두 센다" {
        coverageOf("11", counts) shouldBe 5
    }

    "시도에 직접 붙은 POI 도 그 시도에 센다" {
        coverageOf("50", counts) shouldBe 27
    }

    "POI 가 없는 지역은 0 이다 — 화면이 '준비 중'을 그릴 근거다" {
        coverageOf("36", counts) shouldBe 0
    }
})
