package com.trippilot.app.web

import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.GenerationSessionRepository
import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ReplanInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import com.trippilot.itinerarygeneration.domain.SlotExplanations
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.ValidationOutcome
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import java.time.Clock
import java.time.Instant
import java.time.LocalTime
import java.util.UUID

/**
 * TRIP-1058 — 1차 AI 호출 중 세션이 취소되면 뒤늦은 1일차는 **409 로 거절되고 롤백된다**(QA #029·#046).
 *
 * 단위 테스트가 못 보는 두 가지를 실 DB 로 잠근다:
 * - **금지 AC(롤백)**: 일정 교체(`replaceForTrip`)와 day1 전이가 같은 트랜잭션이라, 도메인 예외가
 *   그 교체까지 되돌리는가 — 인메모리 Fake 에는 트랜잭션이 없어 원리적으로 검증 불가.
 * - **와이어 모양**: 500 이 아니라 409 + `error.code=GENERATION_SUPERSEDED` 로 나가는가
 *   (종전에는 IllegalArgumentException → GlobalExceptionHandler 500 INTERNAL).
 *
 * 재현은 결정론이다 — 기본 fake 는 즉답이라 실제 경합 창이 없으므로(티켓 주의), generate 도중
 * 세션을 닫는 대역을 꽂아 "취소 후 늦은 도착"(QA #046)을 그대로 만든다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(GenerationSupersededIT.CancelMidGenerate::class)
class GenerationSupersededIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-08-01T00:00:00Z")

    @TestConfiguration
    class CancelMidGenerate {
        /** 1차가 도는 사이 cancel API 가 세션을 닫은 상황(QA #046)을 그 자리에서 만든다. */
        @Bean
        @Primary
        fun cancelingAgent(sessions: GenerationSessionRepository, clock: Clock): ScheduleAgentPort =
            object : ScheduleAgentPort {
                override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
                    // AI 호출은 트랜잭션 밖이라(설계 주석) 이 쓰기는 즉시 커밋된다 — 실제 cancel API 와 같다.
                    sessions.findRunningByTrip(input.tripId)?.let { old ->
                        sessions.save(old.canceled(clock.instant()))
                        // 연타(QA #029)면 재생성이 이전 세션을 닫고 **새로 연다** — start() 와 같은 결과 상태.
                        if (superseding) {
                            sessions.save(
                                com.trippilot.itinerarygeneration.domain.GenerationSession
                                    .start(old.accountId, input.tripId, old.mode, clock.instant()),
                            )
                        }
                    }
                    return ScheduleAgentOutput(
                        days = input.timeWindows.map { tw ->
                            DaySchedule(
                                tw.date,
                                listOf(VisitSlotDisplay(slotPoi!!, LocalTime.of(10, 0), LocalTime.of(11, 0), false, null, isFixed = false)),
                            )
                        },
                        day1ReadyAt = null, explanations = emptyMap(),
                        solveMode = SolveMode.DETERMINISTIC, isFallback = false,
                        freshness = FreshnessMeta(clock.instant(), degraded = false),
                    )
                }

                override fun validate(solution: ScheduleAgentOutput): ValidationOutcome = ValidationOutcome()
                override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>): RepairResult =
                    RepairResult(solution, emptyList())
                override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?): SlotExplanations = SlotExplanations()
                override fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput =
                    error("이 테스트는 슬롯 후보를 쓰지 않는다")
                override fun replan(input: ReplanInput): ScheduleAgentOutput = error("이 테스트는 재계획을 쓰지 않는다")
            }

        companion object {
            /** 대역이 돌려줄 슬롯 POI — 테스트가 시드에서 골라 넣는다(FK 실존 필요). */
            @Volatile
            var slotPoi: UUID? = null

            /** true 면 취소 뒤 새 세션을 연다 — 연타(QA #029) 재현. false 면 취소만(QA #046). */
            @Volatile
            var superseding: Boolean = false
        }
    }

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build().method(method).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun newToken(): String {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun newFutureTrip(token: String): String {
        val start = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Seoul")).plusDays(30)
        val body = """{"startDate":"$start","endDate":"${start.plusDays(1)}","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":1}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    @Test
    fun `1일차 전에 취소된 세션 - 409 GENERATION_SUPERSEDED 이고 일정은 롤백된다`() {
        val token = newToken()
        val trip = newFutureTrip(token)
        CancelMidGenerate.superseding = false
        CancelMidGenerate.slotPoi = UUID.fromString(
            call(HttpMethod.GET, "/api/v1/places?region=제주", token).second["items"][0]["poiId"].asText(),
        )

        val (rc, body) = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token, """{"generationMode":"FULLY_AI"}""")

        rc shouldBe 409 // 종전 500 — GlobalExceptionHandler "미처리 예외" 갈래
        body["error"]["code"].asText() shouldBe "GENERATION_SUPERSEDED"
        body["error"].has("activeSessionId") shouldBe false // 취소만 됐고 새 요청은 없다(QA #046 경로)

        // 금지 AC — 낡은 1일차가 커밋되지 않았다(트랜잭션 롤백 실증. QA 실측: ecb406b1 은 일정 행 없음)
        jdbc.queryForObject(
            "SELECT count(*) FROM itinerary WHERE trip_id = ?", Int::class.java, UUID.fromString(trip),
        ) shouldBe 0
        // 세션은 CANCELED 그대로 — 실패로 덮이지 않는다(failed 는 진행 중일 때만)
        jdbc.queryForObject(
            "SELECT status FROM generation_session WHERE trip_id = ?", String::class.java, UUID.fromString(trip),
        ) shouldBe "CANCELED"
    }

    /**
     * 연타(QA #029) — 재생성이 이전 세션을 닫고 새로 연 경우. 앞 요청의 409 에
     * `error.activeSessionId` 로 **새 세션**이 실려, 화면이 실패를 그리는 대신 폴링을 갈아탄다.
     */
    @Test
    fun `대체된 요청 - 409 에 activeSessionId 로 진행 중인 새 세션이 실린다`() {
        val token = newToken()
        val trip = newFutureTrip(token)
        CancelMidGenerate.superseding = true
        CancelMidGenerate.slotPoi = UUID.fromString(
            call(HttpMethod.GET, "/api/v1/places?region=제주", token).second["items"][0]["poiId"].asText(),
        )

        val (rc, body) = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token, """{"generationMode":"FULLY_AI"}""")

        rc shouldBe 409
        body["error"]["code"].asText() shouldBe "GENERATION_SUPERSEDED"
        val newSession = jdbc.queryForObject(
            "SELECT session_id FROM generation_session WHERE trip_id = ? AND status = 'RUNNING'",
            String::class.java, UUID.fromString(trip),
        )
        body["error"]["activeSessionId"].asText() shouldBe newSession
        // 낡은 1일차는 여기서도 커밋되지 않는다 — B(새 요청)의 자리를 A 가 덮으면 위반(금지 AC)
        jdbc.queryForObject(
            "SELECT count(*) FROM itinerary WHERE trip_id = ?", Int::class.java, UUID.fromString(trip),
        ) shouldBe 0
    }
}
