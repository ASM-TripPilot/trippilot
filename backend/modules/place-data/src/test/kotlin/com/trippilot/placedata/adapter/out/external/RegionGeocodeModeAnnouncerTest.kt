package com.trippilot.placedata.adapter.out.external

import io.kotest.assertions.throwables.shouldNotThrowAny
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.string.shouldContain
import org.springframework.web.client.RestClient

/**
 * 기동 시 지오코딩 경계 점검.
 *
 * 여기서 지키는 것은 하나다 — **국내강제가 조용히 꺼진 채로 기동하지 않는 것.**
 * `mode=kakao` 인데 키가 없으면 카카오가 401 을 주고 모든 판정이 UNKNOWN 이 되는데,
 * `TripService` 는 UNKNOWN 을 통과시키므로 해외 목적지가 전부 허용된다.
 * 앱은 그 상태로 **정상 기동한다** — 그래서 기동을 막는 쪽을 골랐다.
 */
class RegionGeocodeModeAnnouncerTest : StringSpec({

    fun kakaoAdapter(key: String) = KakaoRegionGeocodeAdapter(key, RestClient.builder())

    "kakao 모드인데 키가 비면 기동을 거부한다" {
        val announcer = RegionGeocodeModeAnnouncer(kakaoAdapter(""), mode = "kakao", restApiKey = "")

        shouldThrow<IllegalStateException> { announcer.announce() }
            .message.orEmpty() shouldContain "KAKAO_CLIENT_ID"
    }

    // 공백만 있는 값도 키가 아니다 — env 를 `KAKAO_CLIENT_ID=" "` 로 채우면 401 이 나는 건 똑같다.
    "공백뿐인 키도 빈 키로 본다" {
        val announcer = RegionGeocodeModeAnnouncer(kakaoAdapter("   "), mode = "kakao", restApiKey = "   ")

        shouldThrow<IllegalStateException> { announcer.announce() }
    }

    "kakao 모드에 키가 있으면 기동한다" {
        val announcer = RegionGeocodeModeAnnouncer(kakaoAdapter("key"), mode = "kakao", restApiKey = "key")

        shouldNotThrowAny { announcer.announce() }
    }

    // 스텁은 외부를 부르지 않으므로 키가 없어도 정상이다 — 로컬·CI 의 기본 경로다.
    "스텁 모드는 키가 없어도 기동한다" {
        val announcer = RegionGeocodeModeAnnouncer(StubRegionGeocodeAdapter(), mode = "stub", restApiKey = "")

        shouldNotThrowAny { announcer.announce() }
    }

    // 오타로 조건부 빈이 안 걸리면 스텁으로 남는다. 그건 막지 않되(기동은 정상) 경고로 알린다 —
    // 막아 버리면 아는 값이 늘어날 때마다 기동이 깨진다.
    "아는 값이 아니어도 기동은 막지 않는다" {
        val announcer = RegionGeocodeModeAnnouncer(StubRegionGeocodeAdapter(), mode = "kakao-v2", restApiKey = "")

        shouldNotThrowAny { announcer.announce() }
    }
})
