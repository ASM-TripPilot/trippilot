package com.trippilot.reflection.adapter.out.external

import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionVisit
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import org.springframework.http.MediaType
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withServerError
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 실 경계 어댑터의 갈래들. **실왕복 IT 로는 못 잰다** — 그건 평소 꺼져 있고(CI 외부호출 0회 정책),
 * 상대가 어떤 실패를 주는지 우리가 고를 수도 없다.
 *
 * 여기서 잰다: 부르지 말아야 할 때 안 부르는가 · 실패가 값으로 낮아지는가 · 원문이 보존되는가.
 */
class HttpReflectionAgentAdapterTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-08-01T00:00:00Z"), ZoneOffset.UTC)
    val day = LocalDate.parse("2026-08-01")

    /**
     * 나간 요청 수를 **직접 센다.**
     *
     * 목 서버만으로는 부족했다(실측): 기대를 안 걸어 두면 예상 밖 요청이 예외가 되는데, 어댑터가
     * 그것을 `null` 로 낮춰서 **"안 불렀다"와 "부르고 실패했다"가 같은 결과로 보인다.**
     * 그 상태로는 "목적지를 모르면 부르지 않는다"는 가드를 지워도 테스트가 안 깨진다.
     */
    class CallCounter : org.springframework.http.client.ClientHttpRequestInterceptor {
        var calls = 0
        override fun intercept(
            request: org.springframework.http.HttpRequest,
            body: ByteArray,
            execution: org.springframework.http.client.ClientHttpRequestExecution,
        ): org.springframework.http.client.ClientHttpResponse {
            calls++
            return execution.execute(request, body)
        }
    }

    fun fixture(): Pair<HttpReflectionAgentAdapter, MockRestServiceServer> {
        // 프로덕션과 동일한 경계 매퍼·컨버터 구성 — 이름 규칙이 다르면 여기서 드러나야 한다.
        val builder = RestClient.builder()
            .baseUrl("http://ai.test")
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(ReflectionBoundaryMapper.create())) }
        val server = MockRestServiceServer.bindTo(builder).build()
        val properties = ReflectionAgentProperties(mode = "http", baseUrl = "http://ai.test")
        return HttpReflectionAgentAdapter(builder.build(), properties, clock) to server
    }

    fun input(region: String = "제주") = ReflectionAgentInput(
        kind = "DAILY", region = region, startDate = day, endDate = day,
        visits = listOf(ReflectionVisit(UUID.randomUUID(), day, "성산일출봉", "자연", 1, 2)),
        personaSummary = null, weatherSummary = null,
    )

    val okBody = """
        {"template_id":"ai.daily.v1","kind":"DAILY","format":"CARD",
         "generated_at":"2026-08-01T09:00:00Z","is_fallback":false,
         "cover":{"title":"제주 하루","subtitle":"성산일출봉을 다녀왔어요"},
         "scenes":[{"layout":"PHOTO","caption":"성산일출봉","source_event":"visit-1"}],
         "hashtags":["#제주"]}
    """.trimIndent()

    "정상 응답이면 카드가 나오고 원문이 그대로 실린다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/reflection/generate"))
            .andRespond(withSuccess(okBody, MediaType.APPLICATION_JSON))

        val card = adapter.generate(input())

        card shouldNotBe null
        card!!.title shouldBe "제주 하루"
        card.templateId shouldBe "ai.daily.v1"
        // 우리가 재조립하지 않는다(DEC-U5-14) — 모르는 필드도 남아야 한다.
        card.payload.contains("source_event") shouldBe true
        server.verify()
    }

    "요청은 snake_case 로 나간다 — 이름 규칙은 계약이지 취향이 아니다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/reflection/generate"))
            .andExpect(jsonPath("$.request_meta.request_id").exists())
            .andExpect(jsonPath("$.start_date").value("2026-08-01"))
            .andExpect(jsonPath("$.visits[0].poi_name").value("성산일출봉"))
            .andExpect(jsonPath("$.visits[0].ref.poi_id").exists())
            .andRespond(withSuccess(okBody, MediaType.APPLICATION_JSON))

        adapter.generate(input())

        server.verify()
    }

    /**
     * **목적지를 모르면 호출 자체를 안 한다.** 상대가 `region` 을 필수로 요구해 422 가 확정이라,
     * 빈 값을 보내 거절당하느니 아끼고 규칙 카드로 간다. 목 서버에 기대 요청을 걸지 않았으므로
     * 무언가 나가면 그 자리에서 깨진다.
     */
    "목적지를 모르면 부르지 않고 null 이다" {
        val counter = CallCounter()
        val builder = RestClient.builder().baseUrl("http://ai.test").requestInterceptor(counter)
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(ReflectionBoundaryMapper.create())) }
        MockRestServiceServer.bindTo(builder).build()
        val adapter = HttpReflectionAgentAdapter(
            builder.build(), ReflectionAgentProperties(mode = "http", baseUrl = "http://ai.test"), clock,
        )

        adapter.generate(input(region = "")) shouldBe null

        // 값이 아니라 **호출 수**를 본다 — null 만 보면 "부르고 실패했다"와 구분되지 않는다.
        counter.calls shouldBe 0
    }

    "상대가 5xx 면 null 이다 — 예외가 새면 폴백이 무력화된다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/reflection/generate")).andRespond(withServerError())

        adapter.generate(input()) shouldBe null
    }

    "제목 없는 카드는 받지 않는다 — 목록에 빈 줄이 그려진다(PBT-U5-F1)" {
        val (adapter, server) = fixture()
        val noTitle = """{"template_id":"ai.daily.v1","format":"CARD","cover":{"title":"  "},"scenes":[]}"""
        server.expect(requestTo("http://ai.test/ai/v1/reflection/generate"))
            .andRespond(withSuccess(noTitle, MediaType.APPLICATION_JSON))

        adapter.generate(input()) shouldBe null
    }

    "본문이 JSON 이 아니어도 null 이다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/reflection/generate"))
            .andRespond(withSuccess("이건 JSON 이 아니다", MediaType.APPLICATION_JSON))

        adapter.generate(input()) shouldBe null
    }
})
