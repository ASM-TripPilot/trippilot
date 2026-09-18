package com.trippilot.weathercontext.adapter.out.external

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * 격자 변환을 **기상청 활용가이드 예시값으로 못 박는다**.
 *
 * 이 변환이 틀리면 엉뚱한 동네 날씨로 Plan-B 가 뜨는데, **호출은 200 으로 성공하고 값도 그럴듯해**
 * 아무 데서도 안 드러난다. 상수 하나만 바꿔도 전국이 통째로 밀리므로 외부 기준값이 필요하다.
 *
 * 값 출처: 가이드 문서의 예시 좌표와 그에 대응하는 격자.
 */
class KmaGridTest : StringSpec({

    "가이드 예시 좌표가 문서의 격자로 변환된다" {
        KmaGrid.of(37.5779, 126.9768) shouldBe (60 to 127) // 서울 종로구
        KmaGrid.of(35.1796, 129.0756) shouldBe (98 to 76) // 부산
        KmaGrid.of(37.4563, 126.7052) shouldBe (55 to 124) // 인천
    }

    /**
     * 제주는 우리 시드 여행지라 따로 본다 — 여기가 틀리면 대부분의 테스트 여행이 엉뚱한 날씨를 본다.
     *
     * 이 값은 산식에서 나온 것을 **실 API 로 확인했다**(2026-09-16): `nx=53,ny=38` 은 기온 22℃,
     * 대조군인 서울 종로 `nx=60,ny=127` 은 18℃ — 격자가 실제로 다른 지역을 가리킨다.
     * 계산값을 계산값으로 검증하면 산식이 통째로 틀려도 통과하므로 바깥 기준이 필요했다.
     */
    "제주 시청 좌표가 같은 격자로 고정된다" {
        KmaGrid.of(33.4996, 126.5312) shouldBe (53 to 38)
    }

    "격자는 결정론이다 — 같은 좌표는 늘 같은 값" {
        val a = KmaGrid.of(37.5779, 126.9768)
        val b = KmaGrid.of(37.5779, 126.9768)
        a shouldBe b
    }
})
