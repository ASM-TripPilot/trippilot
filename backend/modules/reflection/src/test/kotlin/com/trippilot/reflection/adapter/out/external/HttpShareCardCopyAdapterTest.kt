package com.trippilot.reflection.adapter.out.external

import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionVisit
import com.trippilot.reflection.domain.port.ShareCardCopy
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.springframework.http.MediaType
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.test.web.client.ExpectedCount
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

/** 공유 문구 경계 어댑터(TRIP-1411) — 무엇을 보내는가 · 응답을 어떻게 읽는가 · 실패가 값으로 낮아지는가. */
class HttpShareCardCopyAdapterTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-08-01T00:00:00Z"), ZoneOffset.UTC)
    val start = LocalDate.parse("2026-08-01")

    fun fixture(): Pair<HttpShareCardCopyAdapter, MockRestServiceServer> {
        // 프로덕션과 같은 경계 매퍼·컨버터 — 이름 규칙이 다르면 여기서 드러나야 한다.
        val builder = RestClient.builder()
            .baseUrl("http://ai.test")
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(ReflectionBoundaryMapper.create())) }
        val server = MockRestServiceServer.bindTo(builder).build()
        return HttpShareCardCopyAdapter(builder.build(), ReflectionAgentProperties(mode = "http", baseUrl = "http://ai.test"), clock) to server
    }

    val poi = UUID.randomUUID()

    fun input(region: String = "부산", visits: List<ReflectionVisit> = listOf(ReflectionVisit(poi, start.plusDays(1), "해운대", "자연", 1, 2))) =
        ReflectionAgentInput(
            kind = "TRIP_SUMMARY", region = region, startDate = start, endDate = start.plusDays(2),
            visits = visits, personaSummary = "여행 스타일 사진", weatherSummary = null, events = emptyList(),
        )

    "회고와 같은 스키마를 share-card 로 보내고 캡션·해시태그·폴백 표시를 읽는다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/reflection/share-card"))
            .andExpect(jsonPath("$.kind").value("TRIP_SUMMARY"))
            .andExpect(jsonPath("$.region").value("부산"))
            .andExpect(jsonPath("$.start_date").value("2026-08-01"))
            .andExpect(jsonPath("$.end_date").value("2026-08-03"))
            .andExpect(jsonPath("$.visits[0].ref.date").value("2026-08-02")) // 방문 날짜다 — 여행 시작일이 아니다
            .andExpect(jsonPath("$.visits[0].ref.poi_id").value(poi.toString()))
            .andExpect(jsonPath("$.visits[0].poi_name").value("해운대"))
            .andExpect(jsonPath("$.visits[0].category").value("자연"))
            .andExpect(jsonPath("$.visits[0].order_in_day").value(1))
            .andExpect(jsonPath("$.visits[0].photo_count").value(2))
            .andExpect(jsonPath("$.events.length()").value(0))
            .andExpect(jsonPath("$.persona_summary").value("여행 스타일 사진"))
            .andExpect(jsonPath("$.weather_summary").value(""))
            .andExpect(jsonPath("$.request_meta.deadline_ms").value(15_000))
            .andRespond(withSuccess("""{"caption":"바다를 담은 사흘","hashtags":["#부산여행","#해운대"],"is_fallback":false}""", MediaType.APPLICATION_JSON))

        adapter.copy(input()) shouldBe ShareCardCopy("바다를 담은 사흘", listOf("#부산여행", "#해운대"), isFallback = false)
        server.verify()
    }

    "최대 대기는 연결 + 읽기 상한이다 — 동시 요청 거절의 Retry-After 가 이 값이다" {
        HttpShareCardCopyAdapter(RestClient.create(), ReflectionAgentProperties(mode = "http", connectTimeoutMs = 3_000, readTimeoutMs = 21_000), clock)
            .maxWaitMs shouldBe 24_000L
    }

    "해시태그가 없는 응답도 읽는다 — 계약상 선택 필드다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/reflection/share-card"))
            .andRespond(withSuccess("""{"caption":"부산 여행의 기록","is_fallback":true}""", MediaType.APPLICATION_JSON))

        adapter.copy(input()) shouldBe ShareCardCopy("부산 여행의 기록", emptyList(), isFallback = true)
    }

    "상대가 실패하면 null — 예외를 올리지 않는다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/reflection/share-card")).andRespond(withServerError())

        adapter.copy(input()) shouldBe null
        server.verify()
    }

    "상대가 거절할 입력(목적지 없음·방문 0건)은 보내지 않는다" {
        val (adapter, server) = fixture()
        server.expect(ExpectedCount.never(), requestTo("http://ai.test/ai/v1/reflection/share-card"))

        adapter.copy(input(region = " ")) shouldBe null
        adapter.copy(input(visits = emptyList())) shouldBe null
        server.verify()
    }
})
