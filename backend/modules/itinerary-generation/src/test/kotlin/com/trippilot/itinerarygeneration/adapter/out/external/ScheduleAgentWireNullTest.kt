package com.trippilot.itinerarygeneration.adapter.out.external

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import java.time.Instant

/**
 * **시한을 안 실을 때 바디가 어떤 모양인가.** AI 계약은 `deadline_ms` 를 선택 필드로 두고 null 도
 * 받지만(anyOf null), 우리가 무엇을 보내는지는 알고 있어야 한다 — 상대 로그·재현에 그대로 나타난다.
 */
class ScheduleAgentWireNullTest : StringSpec({
    val mapper = ScheduleAgentConfiguration.boundaryMapper()

    "시한이 없으면 deadline_ms 가 null 로 실린다" {
        val json = mapper.writeValueAsString(
            AiRequestMeta("req-1", Instant.parse("2026-08-21T00:00:00Z"), null),
        )
        json shouldContain "\"deadline_ms\":null"
    }

    "시한이 있으면 값이 실린다" {
        val json = mapper.writeValueAsString(
            AiRequestMeta("req-1", Instant.parse("2026-08-21T00:00:00Z"), 20_000L),
        )
        json shouldContain "\"deadline_ms\":20000"
        json shouldNotContain "null"
    }
})
