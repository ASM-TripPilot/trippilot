package com.trippilot.security

import io.kotest.assertions.throwables.shouldNotThrowAny
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain

/**
 * 서비스 토큰 미설정을 **배포 시점에** 드러낸다(TRIP-856 후속).
 *
 * ## 왜 경고로는 부족했나
 *
 * 수신(`/internal` 하위 경로)은 토큰이 비면 닫혀서 **바로 드러난다**. 그런데 발신(백엔드→AI)은 비면
 * **헤더를 아예 안 붙이고 그냥 나간다.** 상대가 인바운드 검증을 켜는 순간 AI 호출이 전부 401 인데,
 * 그중 몇은 `degraded` 폴백으로 흡수돼 사용자에게는 "AI 가 좀 이상하다"로만 보인다 —
 * 원인이 **우리 설정 누락**이라는 사실이 어디에도 안 남는다.
 *
 * 기동 로그 한 줄로는 그 상태를 못 막는다. 경고는 배포 로그에 묻히고, 묻힌 사이에 무인증으로 뜬다.
 */
class ServiceAuthRequireTokenTest : StringSpec({

    "켜져 있는데 토큰이 비면 기동하지 않는다" {
        val e = shouldThrow<IllegalStateException> {
            ServiceTokenAuthFilter.announce(token = "", requireToken = true)
        }

        // 무엇을 넣어야 하는지가 메시지에 있어야 한다 — "기동 실패"만으로는 되짚을 수 없다.
        e.message!! shouldContain "SERVICE_AUTH_TOKEN"
    }

    /**
     * **기본은 꺼짐이어야 한다.** 켜 두면 토큰을 안 넣은 로컬·CI 가 통째로 안 뜬다 —
     * 이 리포의 CI 는 외부 호출 0회 정책이라 토큰이 없는 것이 정상이다.
     */
    "기본값으로는 토큰이 비어도 기동한다 — 경고만 남는다" {
        shouldNotThrowAny { ServiceTokenAuthFilter.announce(token = "") }
    }

    "켜져 있어도 토큰이 있으면 기동한다" {
        shouldNotThrowAny { ServiceTokenAuthFilter.announce(token = "실토큰", requireToken = true) }
    }

    /** 기본을 켜진 쪽으로 뒤집으면 토큰 없는 로컬·CI 가 통째로 안 뜬다. 값을 못 박는다. */
    "프로퍼티 기본값은 빈 토큰·꺼짐이다" {
        ServiceAuthProperties() shouldBe ServiceAuthProperties(token = "", requireToken = false)
    }
})
