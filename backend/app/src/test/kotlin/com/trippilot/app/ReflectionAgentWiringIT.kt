package com.trippilot.app

import com.trippilot.reflection.adapter.out.external.HttpReflectionAgentAdapter
import com.trippilot.reflection.domain.port.ReflectionAgentPort
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource

/**
 * 모드 스위치가 **실제로 갈리는가**(O-U5-6).
 *
 * 단위 테스트로는 못 본다 — `@ConditionalOnProperty` 는 스프링이 조립할 때만 평가된다. 배선이 틀리면
 * 증상이 "AI 를 켰는데 전부 규칙 카드"인데, 그건 폴백과 **구분되지 않아** 원인이 안 보인다.
 */
@SpringBootTest
@TestPropertySource(properties = ["trippilot.ai.reflection.mode=http"])
class ReflectionAgentHttpWiringIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var agent: ReflectionAgentPort

    @Test
    fun `mode=http 면 실 어댑터가 물린다`() {
        agent.shouldBeInstanceOf<HttpReflectionAgentAdapter>()
        agent.enabled shouldBe true
    }
}

/**
 * 기본값(`rule`)에서는 미배선 구현이 남는다 — **앱이 AI 설정 없이도 뜬다.**
 * 이게 깨지면 AI 를 안 켠 환경에서 기동이 실패한다.
 */
@SpringBootTest
class ReflectionAgentDefaultWiringIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var agent: ReflectionAgentPort

    @Test
    fun `기본 모드에서는 경계가 꺼져 있다 — 규칙 카드로 간다`() {
        agent.enabled shouldBe false
    }
}
