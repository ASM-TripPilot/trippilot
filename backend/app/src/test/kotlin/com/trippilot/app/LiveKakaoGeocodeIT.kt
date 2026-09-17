package com.trippilot.app

import com.trippilot.placedata.api.DomesticCheck
import com.trippilot.placedata.api.DomesticRegionFacade
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource

/**
 * **실 카카오 로컬과의 왕복** — 우리 어댑터가 실물에 대해 동작하는지(INV-U1-12).
 *
 * 평소에는 꺼져 있다 — CI 게이트 정책이 "외부 API 호출 0회"다. 켜는 법:
 * ```
 * LIVE_KAKAO=1 ./gradlew :app:test --tests "*LiveKakaoGeocodeIT*"
 * ```
 * `application-local.yml` 의 `trippilot.social.kakao.client-id`(= REST API 키)를 쓰고,
 * 콘솔에서 카카오맵(OPEN_MAP_AND_LOCAL) 서비스가 켜져 있어야 한다 — 꺼져 있으면 403 이다.
 *
 * 여기서만 드러나는 것: 스텁은 우리가 넣은 시드만 안다. **실 벤더가 어떤 이름에 0건을 주는지**는
 * 실호출로만 알 수 있고, 그 0건이 곧 "국외" 판정이라 오판이 사용자 차단으로 이어진다.
 */
@SpringBootTest
@TestPropertySource(
    properties = [
        "trippilot.place.geocode.mode=kakao",
        // `application-local.yml` 은 local 프로필에서만 로드된다 — 테스트는 환경변수로 키를 받는다.
        //
        // **`KAKAO_CLIENT_ID` 로 떨어진다.** 같은 키를 이 리포가 세 이름으로 부른다 —
        // 운영 `application.yml` 은 `KAKAO_CLIENT_ID`, compose 는 `KAKAO_REST_API_KEY`(없으면
        // `KAKAO_CLIENT_ID` 로 폴백), 그리고 여기는 `KAKAO_REST_KEY` 였다. 앞의 둘에만 값을 넣은
        // 사람이 이 테스트를 켜면 **키가 비어 컨텍스트 기동이 막힌다**(RegionGeocodeModeAnnouncer 가
        // 키 없는 kakao 모드를 거부한다) — 증상이 "카카오가 안 된다"로 보여 원인이 안 보인다.
        // 실측(2026-09-18): 이름을 맞출 때까지 세 번 실패했고 전부 이 이유였다.
        "trippilot.social.kakao.client-id=\${KAKAO_REST_KEY:\${KAKAO_CLIENT_ID:}}",
    ],
)
@EnabledIfEnvironmentVariable(named = "LIVE_KAKAO", matches = "1")
class LiveKakaoGeocodeIT : AbstractPostgresIntegrationTest() {

    @Autowired lateinit var domestic: DomesticRegionFacade

    @Test
    fun `이전 구현이 막던 국내 지역들이 전부 통과한다`() {
        listOf("천안", "순천", "거제", "남해", "속초시", "제주특별자치도").forEach {
            println("[LIVE-KAKAO] $it → ${domestic.check(it)}")
            domestic.check(it) shouldBe DomesticCheck.INSIDE
        }
    }

    @Test
    fun `구 단위 지역도 통과한다`() {
        listOf("사하구", "수영구", "종로구", "서귀포시").forEach {
            println("[LIVE-KAKAO] $it → ${domestic.check(it)}")
            domestic.check(it) shouldBe DomesticCheck.INSIDE
        }
    }

    @Test
    fun `해외는 차단된다`() {
        listOf("도쿄", "파리", "오사카", "방콕", "다낭").forEach {
            println("[LIVE-KAKAO] $it → ${domestic.check(it)}")
            domestic.check(it) shouldBe DomesticCheck.OUTSIDE
        }
    }
}
