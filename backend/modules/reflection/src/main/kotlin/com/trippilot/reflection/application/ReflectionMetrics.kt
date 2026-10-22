package com.trippilot.reflection.application

import io.micrometer.core.instrument.MeterRegistry
import org.springframework.stereotype.Component

/**
 * 회고 품질 지표 — 지금은 **환각 강등 건수** 하나다(BR-U5-31).
 *
 * 이 수치가 없으면 두 가지를 못 한다: "AI 를 켰는데 왜 규칙 카드만 나오지"에 답하기,
 * 그리고 **AI 를 계속 켤지 판단하기**. 강등이 잦으면 상대 프롬프트나 대조 기준을 손봐야 하고,
 * 0 이면 대조가 실제로 돌고 있는지부터 의심해야 한다.
 */
@Component
class ReflectionMetrics(private val registry: MeterRegistry) {

    /**
     * 안 간 장소를 말해 규칙 카드(요약이면 규칙 요약)로 내려간 횟수. `kind` 로 하루 회고(`DAILY`)와 여행 요약 회고(`TRIP_SUMMARY`, TRIP-1488)를
     * 가른다 — 섞이면 한쪽 강등률이 다른 쪽 판단(그 경로의 AI 를 계속 켤지)을 오염시킨다.
     */
    fun hallucinationRejected(kind: String) {
        registry.counter(HALLUCINATION_REJECTED, "kind", kind).increment()
    }

    companion object {
        const val HALLUCINATION_REJECTED = "trippilot.reflection.hallucination.rejected"
    }
}
