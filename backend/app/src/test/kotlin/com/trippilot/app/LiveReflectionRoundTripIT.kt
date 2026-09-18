package com.trippilot.app

import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionAgentPort
import com.trippilot.reflection.domain.port.ReflectionVisit
import com.trippilot.reflection.adapter.out.external.ReflectionAgentProperties
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.withClue
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldNotBeBlank
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource
import java.time.LocalDate
import java.util.UUID

/**
 * **실 AI 회고 경계와의 왕복** — 우리 어댑터가 상대 실물에 대해 동작하는지.
 *
 * 평소에는 **꺼져 있다**. CI 게이트 정책이 "외부 API 호출 0회"라 상시 켜면 그 정책이 깨지고,
 * AI 컨테이너가 없는 환경에서는 무조건 빨개진다.
 *
 * 켜는 법:
 * ```
 * docker compose --profile full up -d ai
 * LIVE_AI=1 ./gradlew :app:test --tests "*LiveReflectionRoundTripIT*"
 * docker compose stop ai
 * ```
 *
 * **이름 게이트로는 원리적으로 못 보는 것을 본다.** `ReflectionBoundaryOpenApiTest` 는 필드 **이름**을
 * 지키지 `minItems` 같은 **제약**이나 업무 규칙 위반은 못 본다 — 일정 경계에서 이름이 전부 맞는 상태로
 * 422·409 가 연달아 난 전례가 있다(backend-boundaries 스킬).
 */
@SpringBootTest
@TestPropertySource(properties = ["trippilot.ai.reflection.mode=http"])
@EnabledIfEnvironmentVariable(named = "LIVE_AI", matches = "1")
class LiveReflectionRoundTripIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var agent: ReflectionAgentPort

    @Autowired private lateinit var properties: ReflectionAgentProperties

    private val day = LocalDate.parse("2026-08-01")

    /**
     * **먼저 상대가 그 경로를 여는지 본다.**
     *
     * 없으면 어댑터는 실패를 값으로 낮춰 `null` 을 주고, 아래 단정은 "null 이 null 이 아니어야 한다"는
     * 쓸모없는 메시지로 깨진다 — 원인이 이미지 버전인지 계약 위반인지 구분되지 않는다.
     *
     * 실측(2026-09-01): 로컬 `develop` 이미지가 2026-08-22 자라 회고 경계가 없었다. 커밋된 계약은
     * 08-27 자다. **계약이 거짓인 게 아니라 이미지가 낡은 것**이고, 그 둘은 다른 문제다.
     */
    @Test
    fun `상대가 회고 경로를 연다 — 아니면 이미지가 낡은 것이다`() {
        val paths = java.net.URI.create(properties.baseUrl + "/openapi.json").toURL().readText()

        val opened = paths.contains("""/ai/v1/reflection/generate""")

        withClue(
            "실행 중인 AI 에 /ai/v1/reflection/generate 가 없습니다 — " +
                "커밋된 ai/docs/openapi.json 에는 있습니다. AI 이미지를 최신으로 올리세요(docker compose pull ai).",
        ) { opened shouldBe true }
    }

    @Test
    fun `실 AI 가 카드를 돌려준다 — 제목이 비지 않는다`() {
        val card = agent.generate(
            ReflectionAgentInput(
                kind = "DAILY", region = "제주", startDate = day, endDate = day,
                visits = listOf(
                    ReflectionVisit(UUID.randomUUID(), day, "성산일출봉", "자연", 1, 2),
                    ReflectionVisit(UUID.randomUUID(), day, "올레시장", "맛집", 2, 0),
                ),
                personaSummary = null, weatherSummary = null,
            ),
        )

        withClue("어댑터가 null 을 줬습니다 — 상대 응답이 실패했거나 제목이 비었습니다. 어댑터 warn 로그를 보세요.") {
            card shouldNotBe null
        }
        card!!.title.shouldNotBeBlank()
        card.payload.shouldNotBeBlank()
        card.templateId.shouldNotBeBlank()
    }

    /**
     * **방문 0곳도 거절이 아니어야 한다.** 회고는 "기록이 없는 하루"도 그려야 하므로(PBT-U5-1),
     * 상대가 빈 목록에 422 를 내면 우리는 그 날 AI 단을 못 쓴다 — 규칙 카드로 내려가는 것 자체는
     * 정상이지만, **그 사실을 여기서 알아야** 계약 협의로 갈 수 있다.
     */
    @Test
    fun `방문 0곳이면 카드가 없거나(거절) 있어도 제목이 있다 — 어느 쪽인지 기록한다`() {
        val card = agent.generate(
            ReflectionAgentInput(
                kind = "DAILY", region = "제주", startDate = day, endDate = day,
                visits = emptyList(), personaSummary = null, weatherSummary = null,
            ),
        )

        // null 이면 상대가 거절했다는 뜻이다(어댑터가 실패를 값으로 낮춘다). 둘 다 허용하되
        // 카드가 왔다면 제목은 있어야 한다 — 제목 없는 카드는 목록에 빈 줄을 그린다.
        (card == null || card.title.isNotBlank()) shouldBe true
    }
}
