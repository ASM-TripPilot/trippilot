package com.trippilot.app

import com.trippilot.placedata.adapter.out.external.KakaoPlaceLookupAdapter
import com.trippilot.placedata.adapter.out.external.KakaoRegionGeocodeAdapter
import com.trippilot.placedata.adapter.out.external.StubPlaceLookupAdapter
import com.trippilot.placedata.adapter.out.external.StubRegionGeocodeAdapter
import com.trippilot.placedata.domain.PlaceLookupPort
import com.trippilot.placedata.domain.RegionGeocodePort
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource

/**
 * **실 앱 컨텍스트**가 `mode=kakao` 로 뜨고, 그 포트가 카카오 어댑터로 주입되는지.
 *
 * 왜 슬라이스로 부족한가: kakao 모드에서는 `RegionGeocodePort` 빈이 **둘**이 된다
 * (스텁은 조건 없는 `@Component`, 카카오는 조건부). `@Primary` 하나로 갈리는데,
 * 그게 없거나 지워지면 `NoUniqueBeanDefinitionException` 으로 **기동이 통째로 실패한다**.
 * 이 실패는 배포 당일에만 드러나므로 여기서 미리 깬다.
 *
 * `LiveKakaoGeocodeIT` 는 실호출이라 `LIVE_KAKAO=1` 없이는 꺼져 있다 — 이 테스트가 없으면
 * **kakao 배선이 CI 에서 한 번도 부팅되지 않는다.**
 *
 * 키는 아무 값이나 된다 — 부팅 시점에는 카카오를 부르지 않는다(호출 시점 lazy).
 * 단 **비어 있으면 안 된다**: `RegionGeocodeModeAnnouncer` 가 기동을 막는다(그 판정은 단위 테스트에서 검증).
 */
@SpringBootTest
@TestPropertySource(
    properties = [
        "trippilot.place.geocode.mode=kakao",
        "trippilot.social.kakao.client-id=dummy-key-for-wiring-only",
    ],
)
class RegionGeocodeKakaoModeIT : AbstractPostgresIntegrationTest() {

    @Autowired
    lateinit var port: RegionGeocodePort

    @Autowired
    lateinit var lookup: PlaceLookupPort

    @Test
    fun `kakao 모드에서 앱이 뜨고 카카오 어댑터가 주입된다`() {
        assertThat(port).isInstanceOf(KakaoRegionGeocodeAdapter::class.java)
    }

    // 같은 스위치가 장소 검색도 가른다 — 여기도 스텁과 공존하므로 @Primary 로만 갈린다.
    @Test
    fun `kakao 모드에서 장소 검색도 카카오 어댑터가 주입된다`() {
        assertThat(lookup).isInstanceOf(KakaoPlaceLookupAdapter::class.java)
    }
}

/**
 * 기본(스텁) 모드에서도 앱이 뜨는지. 로컬·CI 의 평상시 경로이며,
 * 조건부 빈에 의존하는 것을 무조건 주입받으면 여기서 깨진다.
 */
@SpringBootTest
class RegionGeocodeStubModeIT : AbstractPostgresIntegrationTest() {

    @Autowired
    lateinit var port: RegionGeocodePort

    @Autowired
    lateinit var lookup: PlaceLookupPort

    @Test
    fun `기본 모드에서 앱이 뜨고 스텁이 주입된다`() {
        assertThat(port).isInstanceOf(StubRegionGeocodeAdapter::class.java)
    }

    @Test
    fun `기본 모드에서 장소 검색도 스텁이 주입된다`() {
        assertThat(lookup).isInstanceOf(StubPlaceLookupAdapter::class.java)
    }
}
