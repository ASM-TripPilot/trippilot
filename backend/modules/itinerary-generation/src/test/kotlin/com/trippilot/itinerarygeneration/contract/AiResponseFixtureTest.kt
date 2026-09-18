package com.trippilot.itinerarygeneration.contract

import com.trippilot.itinerarygeneration.adapter.out.external.AiErrorBody
import com.trippilot.itinerarygeneration.adapter.out.external.AiScheduleResponse
import com.trippilot.itinerarygeneration.adapter.out.external.ScheduleAgentConfiguration
import com.trippilot.itinerarygeneration.adapter.out.external.toDomain
import com.trippilot.itinerarygeneration.domain.SolveMode
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalTime

/**
 * **AI가 직접 만든 응답**을 저희 파서가 읽는지(TRIP-229).
 *
 * 픽스처는 손으로 쓴 것이 아니라 AI 쪽 Pydantic 모델(`ItineraryPayload`)이 직렬화한 실물이다 —
 * 필드명·날짜 형식·null 표현이 전부 상대 것이라, 우리 추측이 아니라 **상대 산출물**을 검증한다.
 * 상대 스키마가 바뀌어 이 파일을 갱신하면 그 순간 여기서 깨진다.
 */
class AiResponseFixtureTest : StringSpec({

    val adapter = ScheduleAgentConfiguration.boundaryMapper()

    fun parse(name: String) = adapter.readValue(
        requireNotNull(this::class.java.getResourceAsStream("/contract/$name")) { "픽스처 없음: $name" },
        AiScheduleResponse::class.java,
    )

    "OR_TOOLS 응답 — 슬롯·설명·신선도·후보요약이 전부 읽힌다" {
        val r = parse("response-or-tools.json")
        r.solveMode shouldBe "OR_TOOLS"
        r.isFallback shouldBe false

        val slots = r.days.single().slots
        slots.size shouldBe 3
        slots[0].isFixed shouldBe true
        slots[1].distanceRange shouldBe "약 1.2km · 도보 추정"
        // 자정 넘김 — 끝 시각이 시작보다 앞서지만 플래그로 구분된다(HC4)
        slots[2].endsNextDay shouldBe true
        slots[2].startAt shouldBe LocalTime.parse("23:00")
        slots[2].endAt shouldBe LocalTime.parse("01:00")

        // explanations 키 규약 "{date}#{poi_id}" — 어긋나면 근거가 전부 비어 나간다
        r.explanations.keys.single() shouldBe "2026-08-01#55555555-5555-4555-8555-555555555555"
        r.freshness.shouldNotBeNull().stale shouldBe false
        r.candidatesSummary.shouldNotBeNull()
    }

    "RULE_FALLBACK · MINIMAL · LLM 도 모두 파싱된다(미지 값으로 실패하지 않는다)" {
        parse("response-rule-fallback.json").isFallback shouldBe true
        parse("response-minimal.json").days shouldBe emptyList()
        parse("response-llm.json").solveMode shouldBe "LLM"
    }

    "AI 4값이 백엔드 3값으로 축약된다 — 축약은 어댑터 소유(계약 합의)" {
        mapOf(
            "response-or-tools.json" to SolveMode.FULL_AI,
            "response-llm.json" to SolveMode.FULL_AI,
            "response-rule-fallback.json" to SolveMode.DETERMINISTIC,
            "response-minimal.json" to SolveMode.MINIMAL,
        ).forEach { (fixture, expected) ->
            parse(fixture).toDomain(Instant.parse("2026-08-01T00:00:00Z")).solveMode shouldBe expected
        }
    }

    "도메인 변환에서 신선도·후보요약이 사영된다" {
        val out = parse("response-or-tools.json").toDomain(Instant.parse("2026-08-01T00:00:00Z"))
        out.freshness.degraded shouldBe false            // stale → degraded
        out.candidatesSummary.shouldNotBeNull().level shouldBe "LOW"
        out.candidatesSummary!!.poolSize shouldBe 7
    }

    "AI 오류 본문이 그대로 파싱된다 — 실제 기동한 서비스가 낸 503 응답" {
        // 손으로 쓴 게 아니라 로컬에 띄운 AI 서비스에서 받아온 실물이다.
        val body = requireNotNull(this::class.java.getResourceAsStream("/contract/response-error-503.json")).readBytes()
        val parsed = adapter.readValue(body, AiErrorBody::class.java)

        parsed.errorCode shouldBe "ORCHESTRATOR_NOT_WIRED"
        parsed.retryable shouldBe false   // 재시도해도 같다 — 폴백으로 가야 한다(INV-4)
        parsed.message.shouldNotBeNull()
    }
})
