package com.trippilot.weathercontext.adapter.out.external

import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.weathercontext.domain.WeatherPort
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.types.shouldBeInstanceOf

/**
 * **모드를 켜면 실제로 구현이 바뀌는가 · 키 없이 켜면 막히는가**.
 *
 * 이 리포의 규칙(anti-patterns): *"설정 스위치를 넣었으면 '값이 붙는가'와 '구현이 바뀌는가'를
 * 따로 검증할 것"*. 프로퍼티 바인딩이 맞아도 조건부 빈이 안 걸리면 여전히 기존 구현이 주입되고,
 * 앱은 **기본값으로 멀쩡히 기동한다** — 통합테스트에서 상대를 띄워 놓고 한 번도 호출하지 않은 채
 * "전부 정상"으로 보이는 가장 나쁜 실패 모드다.
 *
 * 여기서는 스프링 컨텍스트 없이 설정 클래스를 직접 불러 **조립 규칙**만 잰다.
 */
class KmaWeatherWiringTest : StringSpec({

    val regions = object : RegionLookupFacade {
        override fun codesOf(regionName: String) = emptyList<String>()
        override fun isSelectableCode(regionCode: String) = false
        override fun centerOf(regionName: String) = RegionCenter(33.4996, 126.5312)
        /** 코드 중심 — 이 대역은 이름 경로만 쓴다(TRIP-859 후속이 인터페이스에 더한 메서드). */
        override fun centerOfCode(regionCode: String) = null
    }

    "키가 있으면 실 어댑터가 조립된다" {
        val port: WeatherPort = KmaWeatherConfiguration()
            .kmaWeatherAdapter(regions, KmaWeatherProperties(mode = "kma", serviceKey = "키"))

        port.shouldBeInstanceOf<KmaWeatherAdapter>()
    }

    /**
     * **키 없이 kma 로 켜면 기동을 막는다.** 조용히 뜨면 모든 조회가 403 으로 실패해
     * Plan-B 우천 트리거가 **영영 무발화**가 되는데, 그 상태는 "날씨 기능이 없다"와 구분되지 않는다.
     */
    "키가 없으면 기동을 막는다 — 조용히 무발화로 도는 것보다 낫다" {
        shouldThrow<IllegalStateException> {
            KmaWeatherConfiguration().kmaWeatherAdapter(regions, KmaWeatherProperties(mode = "kma"))
        }.message!! shouldContain "WEATHER_API"
    }

    /**
     * 인코딩 키(`%` 포함)는 **막지는 않는다** — 403 이 날 뿐 기동 자체는 가능해야 하고,
     * 판단은 로그로 남긴다. 다만 조립은 되어야 하므로 그 사실을 여기서 못 박는다.
     */
    "인코딩 키여도 조립은 된다 — 경고로 알리되 기동을 막지는 않는다" {
        val port = KmaWeatherConfiguration()
            .kmaWeatherAdapter(regions, KmaWeatherProperties(mode = "kma", serviceKey = "aB%2Bcd"))

        port.shouldBeInstanceOf<KmaWeatherAdapter>()
    }

    /** 기본값이 fake 라는 사실 자체를 잠근다 — 조용히 실 호출로 바뀌면 CI 가 외부를 때린다. */
    "기본 모드는 fake 다" {
        KmaWeatherProperties().mode shouldBe "fake"
    }
})
