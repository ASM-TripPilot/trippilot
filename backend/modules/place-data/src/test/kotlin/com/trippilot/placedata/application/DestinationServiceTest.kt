package com.trippilot.placedata.application

import com.trippilot.placedata.FakeRegionCatalog
import com.trippilot.placedata.api.DestinationCheck
import com.trippilot.placedata.api.DomesticCheck
import com.trippilot.placedata.api.DomesticRegionFacade
import com.trippilot.placedata.domain.Region
import com.trippilot.placedata.domain.RegionCatalogPort
import com.trippilot.placedata.domain.RegionLevel
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * 목적지 수용 판정(TRIP-360).
 *
 * 여기서 지키는 것은 둘이다.
 * 1. **정상 경로에 외부 호출이 없다** — 카탈로그에 있으면 지오코딩을 부르지 않는다. 부르면
 *    카카오 장애가 곧 여행 생성 실패가 되고, 카탈로그를 둔 이유가 사라진다.
 * 2. **거절 사유가 갈린다** — 같은 문구로 뭉치면 사용자는 무엇을 고쳐야 할지 모른다.
 */
class DestinationServiceTest : StringSpec({

    /** 카탈로그 대역 — 이름·별칭 정확 일치만 흉내 낸다. */
    class Catalog(private val aliases: Map<String, String> = emptyMap()) : RegionCatalogPort {
        override fun find(query: String?, level: RegionLevel?) = FakeRegionCatalog.rows
        override fun findExact(name: String): List<Region> {
            val byName = FakeRegionCatalog.rows.filter { it.name == name }
            if (byName.isNotEmpty()) return byName
            val code = aliases[name] ?: return emptyList()
            return FakeRegionCatalog.rows.filter { it.regionCode == code }
        }
    }

    /** 지오코딩 대역 — **불렀는지 센다**. 정상 경로에서 0이어야 한다. */
    class Geo(private val verdict: DomesticCheck) : DomesticRegionFacade {
        var calls = 0
        override fun check(region: String): DomesticCheck {
            calls++
            return verdict
        }
    }

    "카탈로그에 있으면 통과하고 외부를 부르지 않는다" {
        val geo = Geo(DomesticCheck.OUTSIDE) // 불리면 결과가 뒤집히도록 일부러 반대값
        DestinationService(Catalog(), geo).check("양천구") shouldBe DestinationCheck.SUPPORTED
        geo.calls shouldBe 0
    }

    "별칭으로도 통과한다 — 프론트는 '부산' 처럼 짧은 이름을 보낸다" {
        val geo = Geo(DomesticCheck.OUTSIDE)
        DestinationService(Catalog(mapOf("부산" to "26")), geo).check("부산") shouldBe DestinationCheck.SUPPORTED
        geo.calls shouldBe 0
    }

    "앞뒤 공백은 무시한다" {
        DestinationService(Catalog(), Geo(DomesticCheck.OUTSIDE)).check("  양천구  ") shouldBe DestinationCheck.SUPPORTED
    }

    /** `홍천읍` 같은 값 — 국내인데 우리 단위가 아니다. "국내만 지원해요"는 거짓말이 된다. */
    "국내지만 카탈로그에 없으면 사유가 따로다" {
        DestinationService(Catalog(), Geo(DomesticCheck.INSIDE))
            .check("홍천읍") shouldBe DestinationCheck.DOMESTIC_UNSUPPORTED
    }

    "국외는 국외로 말한다" {
        DestinationService(Catalog(), Geo(DomesticCheck.OUTSIDE))
            .check("Paris") shouldBe DestinationCheck.OUTSIDE
    }

    /**
     * 예전 규칙은 "확인 못 한 것은 막지 않는다" 였다. 지오코딩이 유일한 기준이라 벤더 장애가
     * 곧 전면 차단이었기 때문이다. 이제 정상 목적지는 카탈로그에서 끝나므로 여기까지 온 값은
     * 어차피 지원하지 않는 이름이다 — 거절하되 확인 못 했다고 정직하게 말한다.
     */
    "확인 못 하면 거절하되 그렇게 말한다" {
        DestinationService(Catalog(), Geo(DomesticCheck.UNKNOWN))
            .check("어딘가") shouldBe DestinationCheck.UNVERIFIED
    }

    "빈 값은 외부를 부르지 않고 거절한다" {
        val geo = Geo(DomesticCheck.INSIDE)
        DestinationService(Catalog(), geo).check("   ") shouldBe DestinationCheck.UNVERIFIED
        geo.calls shouldBe 0
    }
})
