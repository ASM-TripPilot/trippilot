package com.trippilot.app

import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.ReminderCopyPort
import com.trippilot.notification.domain.ReminderCopyRequest
import com.trippilot.notification.domain.ReminderSlot
import com.trippilot.notification.adapter.out.external.ReminderCopyProperties
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.withClue
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotBeBlank
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource
import java.time.LocalDate

/**
 * **실 AI 리마인드 문구 경계와의 왕복** — TRIP-836 의 완료 기준을 코드로 박는다.
 *
 * 티켓의 완료 기준이 *"`AI_REMINDER_COPY_MODE=http` 로 켰을 때 실제 문구가 붙는다 · 그 문구가 그 날
 * 갈 곳의 이름을 담는다(실 왕복 1회로 확인)"* 인데, 그 확인을 **사람이 한 번 해보고 마는** 것으로
 * 두면 다음 사람이 같은 것을 다시 의심한다. 선례는 `LiveReflectionRoundTripIT` 다.
 *
 * 평소에는 **꺼져 있다** — CI 게이트 정책이 "외부 API 호출 0회"다.
 *
 * ```
 * docker compose --profile full up -d ai
 * LIVE_AI=1 ./gradlew :app:test --tests "*LiveReminderCopyRoundTripIT*"
 * docker compose stop ai
 * ```
 *
 * ## 실패했을 때 어디를 볼 것인가 — 이 테스트의 진짜 값어치
 *
 * 포트가 **예외를 던지지 않고 빈 맵을 준다**(못 받는 것이 정상 경로라서). 그래서 "빈 맵"은
 * 원인을 가리지 않는다. 아래 세 갈래를 **테스트가 대신 갈라 준다**:
 *
 * | 증상 | 원인 | 볼 곳 |
 * | --- | --- | --- |
 * | 첫 스펙이 실패 | AI 이미지가 낡아 경로가 없다 | `docker compose pull ai` |
 * | 둘째가 빈 맵 | 우리 요청이 거부됐거나(4xx/422) 상대가 degraded | 어댑터 `warn` 로그 |
 * | 둘째가 빈 맵 + 로그도 조용 | 상대 LLM 라우팅이 안 잡혔다 | AI 쪽 `AI_LLM_PROVIDER`·모델 배정 |
 *
 * 마지막 줄이 특히 중요하다 — `REMINDER_COPY` 는 `AI_LLM_FEATURE_MODELS` 목록에 없어 기본 tier 로
 * 가고, 파인튜닝 모델은 Bedrock 에 있다. **그 경우 빈 맵은 우리 결함이 아니다.**
 */
@SpringBootTest
@TestPropertySource(properties = ["trippilot.ai.reminder-copy.mode=http"])
@EnabledIfEnvironmentVariable(named = "LIVE_AI", matches = "1")
class LiveReminderCopyRoundTripIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var copies: ReminderCopyPort

    @Autowired private lateinit var properties: ReminderCopyProperties

    private val day = LocalDate.parse("2026-08-01")

    /** 그 날 갈 곳. 아래 단정이 **이 이름들이 문구에 담겼는지**를 본다. */
    private val slots = listOf(
        ReminderSlot("성산일출봉", "SIGHT"),
        ReminderSlot("올레시장", "FOOD"),
    )

    private fun ask(kind: NotificationKind, places: List<ReminderSlot> = slots) =
        copies.copiesFor(
            tripTitle = "제주 3일",
            items = listOf(ReminderCopyRequest("live-${kind.name.lowercase()}", kind, day, places)),
        )

    /**
     * **먼저 상대가 그 경로를 여는지 본다.** 없으면 아래 단정이 "빈 맵이 비면 안 된다"는 쓸모없는
     * 메시지로 깨져, 이미지가 낡은 것인지 계약이 틀린 것인지 구분되지 않는다
     * (회고 경계에서 실제로 겪은 혼동 — `LiveReflectionRoundTripIT` 주석).
     */
    @Test
    fun `상대가 리마인드 문구 경로를 연다 — 아니면 이미지가 낡은 것이다`() {
        val schema = java.net.URI.create(properties.baseUrl + "/openapi.json").toURL().readText()

        withClue(
            "실행 중인 AI 에 /ai/v1/notification/copies 가 없습니다 — 커밋된 ai/docs/openapi.json 에는 " +
                "있습니다. AI 이미지를 최신으로 올리세요(docker compose pull ai).",
        ) { schema.contains("/ai/v1/notification/copies") shouldBe true }
    }

    /**
     * **완료 기준 그 자체.** 문구가 오고, 그 문구가 그 날 갈 곳의 이름을 담는다.
     *
     * 이름을 담는지까지 보는 이유는 TRIP-883 때문이다 — 재료(`slots`)를 비우면 상대가 *"일정이
     * 없으니…"* 를 지어낸다는 것이 실측됐고, 그래서 재료를 채우는 것이 그 티켓의 본체였다.
     * **재료가 실제로 답에 반영되는지**는 여기서만 보인다(단위 테스트는 가짜 응답을 읽는다).
     */
    @Test
    fun `실 AI 가 문구를 주고 그 문구가 그 날 갈 곳을 말한다`() {
        val received = ask(NotificationKind.TRIP_DAY)

        withClue(
            "문구를 한 건도 못 받았습니다. 어댑터 warn 로그를 먼저 보세요 — 로그에 4xx/422 가 있으면 " +
                "우리 요청 문제이고, 조용한데 비어 있으면 상대 LLM 라우팅 문제입니다(클래스 주석의 표).",
        ) { received.keys shouldBe setOf("live-trip_day") }

        val copy = received.getValue("live-trip_day")
        copy.title.shouldNotBeBlank()
        copy.body.shouldNotBeBlank()

        withClue("문구가 '${copy.body}' 인데 그 날 갈 곳(${slots.map { it.name }})을 하나도 안 담았습니다.") {
            slots.any { copy.body.contains(it.name) } shouldBe true
        }
    }

    /**
     * **재료가 비면 묻지 않는다** — 어댑터가 요청 전에 거른다(TRIP-883).
     *
     * 단위 테스트도 이것을 보지만 거기서는 **가짜 상대**를 쓴다. 여기서 한 번 더 보는 이유는
     * 가드가 사라졌을 때의 결과가 실물에서만 드러나기 때문이다 — 그때는 빈 맵이 아니라
     * *"일정이 없으니 여유롭게…"* 라는 **참이 아닌 문구**가 돌아온다.
     */
    @Test
    fun `재료가 비면 아예 묻지 않는다 — 물으면 상대가 없는 일정을 지어낸다`() {
        val received = ask(NotificationKind.TRIP_DAY, places = emptyList())

        received shouldBe emptyMap()
    }
}
