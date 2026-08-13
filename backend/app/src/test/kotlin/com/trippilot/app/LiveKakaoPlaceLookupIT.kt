package com.trippilot.app

import com.trippilot.placedata.api.PlaceLookupFacade
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldNotBeEmpty
import io.kotest.matchers.doubles.shouldBeGreaterThan
import io.kotest.matchers.doubles.shouldBeLessThan
import io.kotest.matchers.string.shouldNotBeBlank
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource

/**
 * **실 카카오 로컬과의 왕복** — 숙소 등록 지도검색(e05)이 실물에 대해 동작하는지.
 *
 * 평소에는 꺼져 있다 — CI 게이트 정책이 "외부 API 호출 0회"다. 켜는 법:
 * ```
 * LIVE_KAKAO=1 KAKAO_REST_KEY=... ./gradlew :app:test --tests "*LiveKakaoPlaceLookupIT*"
 * ```
 *
 * **여기서만 드러나는 것**: 벤더 응답의 필드명은 `place_name`·`road_address_name` 같은 snake_case 인데
 * 우리 DTO 는 camelCase 다. 매핑이 어긋나면 **200 을 받고도 이름이 전부 null 이 되어 후보가 사라진다** —
 * 스텁은 우리가 만든 값을 주므로 이 실패를 원리적으로 재현하지 못한다.
 */
@SpringBootTest
@TestPropertySource(
    properties = [
        "trippilot.place.geocode.mode=kakao",
        // `application-local.yml` 은 local 프로필에서만 로드된다 — 테스트는 환경변수로 키를 받는다.
        "trippilot.social.kakao.client-id=\${KAKAO_REST_KEY:}",
    ],
)
@EnabledIfEnvironmentVariable(named = "LIVE_KAKAO", matches = "1")
class LiveKakaoPlaceLookupIT : AbstractPostgresIntegrationTest() {

    @Autowired lateinit var lookup: PlaceLookupFacade

    @Test
    fun `상호로 숙소를 찾는다 — 키워드 경로`() {
        listOf("제주신라호텔", "부산 파라다이스호텔", "속초 롯데리조트").forEach { q ->
            val found = lookup.search(q)
            println("[LIVE-KAKAO] $q → ${found.size}건 ${found.firstOrNull()}")
            found.shouldNotBeEmpty()
            // 이름이 비면 snake_case 매핑이 끊긴 것이다 — 이 테스트의 존재 이유다.
            found.first().name.shouldNotBeBlank()
            found.first().lat shouldBeGreaterThan 32.9
            found.first().lat shouldBeLessThan 38.7
        }
    }

    /**
     * **지번 주소** — 키워드 검색이 0건이라 주소 폴백만이 구한다(실측). 도로명 주소는 근처 상호가 잡혀
     * 키워드로도 나오므로 이 경로를 증명하지 못한다. 시골 펜션·민박은 상호가 벤더에 없고 지번만 있다.
     */
    @Test
    fun `지번 주소는 주소 폴백이 구한다 — 키워드로는 0건`() {
        listOf("서귀포시 성산읍 고성리 300", "통영시 산양읍 연화리 470").forEach { q ->
            val found = lookup.search(q)
            println("[LIVE-KAKAO] 지번주소 $q → ${found.size}건 ${found.firstOrNull()}")
            found.shouldNotBeEmpty()
            found.first().address.shouldNotBeBlank()
        }
    }

    @Test
    fun `없는 이름은 빈 목록 — 예외가 아니다`() {
        val found = lookup.search("존재하지않는숙소이름zzqq99")
        println("[LIVE-KAKAO] 없는이름 → ${found.size}건")
        require(found.isEmpty()) { "빈 결과를 기대했는데 ${found.size}건: $found" }
    }
}
