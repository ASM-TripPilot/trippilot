package com.trippilot.reflection.adapter.out.external

import com.trippilot.reflection.domain.ReflectionCard
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionAgentPort
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

/**
 * 기본 구현 — **아직 배선하지 않았다**를 값으로 말한다(`null` → 규칙 카드).
 *
 * "Fake"라 부르지 않는 이유: 일정 쪽 `FakeScheduleAgent` 는 그럴듯한 산출물을 만들어 로컬 개발을
 * 돌게 하는 물건이다. 여기서 그렇게 하면 **가짜 AI 카드가 `source=AI` 로 저장되어** 품질 관측
 * (BR-U5-33)이 거짓이 된다. 회고는 규칙 카드만으로도 화면이 돌기 때문에 지어낼 이유가 없다.
 *
 * 실 구현(HTTP)은 칸 3에서 이 자리를 대체한다.
 */
@Configuration
class ReflectionAgentConfiguration {

    @Bean
    @ConditionalOnMissingBean(ReflectionAgentPort::class)
    fun unwiredReflectionAgent(): ReflectionAgentPort = object : ReflectionAgentPort {
        override val enabled = false

        override fun generate(input: ReflectionAgentInput): ReflectionCard? {
            // 침묵하지 않는다(INV-4) — 다만 요청마다 찍으면 로그가 무의미해지므로 debug 다.
            log.debug("회고 AI 경계 미배선 — 규칙 카드로 갑니다. kind={} 방문={}곳", input.kind, input.visits.size)
            return null
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ReflectionAgentConfiguration::class.java)
    }
}
