package com.trippilot.app

import com.trippilot.itinerarygeneration.adapter.out.external.FakeScheduleAgent
import com.trippilot.itinerarygeneration.adapter.out.external.HttpScheduleAgentAdapter
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource

/**
 * **실 앱 컨텍스트**가 `mode=http` 로 뜨고, 그 포트가 HTTP 어댑터로 주입되는지.
 *
 * 슬라이스 테스트(ScheduleAgentSwitchTest)는 두 빈만 놓고 판정을 보므로, 전체 컨텍스트에서만 드러나는
 * 문제(설정 클래스 미스캔 → RestClient 빈 부재로 주입 실패, 다른 모듈 빈과의 충돌)를 못 잡는다.
 * 그 실패는 **통합테스트 당일 기동 불가**로 나타나므로 미리 여기서 깬다.
 *
 * baseUrl 은 잡히지 않는 주소여도 된다 — 부팅 시점에는 연결하지 않는다(호출 시점 lazy).
 */
@SpringBootTest
@TestPropertySource(
    properties = [
        "trippilot.ai.schedule.mode=http",
        "trippilot.ai.schedule.base-url=http://ai.invalid:8000",
    ],
)
class ScheduleAgentHttpModeIT : AbstractPostgresIntegrationTest() {

    @Autowired
    lateinit var port: ScheduleAgentPort

    @Test
    fun `http 모드에서 앱이 뜨고 실 HTTP 어댑터가 주입된다`() {
        assertThat(port).isInstanceOf(HttpScheduleAgentAdapter::class.java)
    }
}

/**
 * 기본(fake) 모드에서도 앱이 뜨는지. **http 전용 빈에 의존하는 것을 무조건 주입받으면 여기서 깨진다** —
 * `ScheduleAgentProperties` 는 http 조건부 설정 안에서만 등록되므로, 그걸 생성자로 받는 컴포넌트를
 * 조건 없이 두면 평상시 기동이 통째로 실패한다(실제로 한 번 그렇게 만들었다).
 */
@SpringBootTest
class ScheduleAgentFakeModeIT : AbstractPostgresIntegrationTest() {

    @Autowired
    lateinit var port: ScheduleAgentPort

    @Test
    fun `기본 모드에서 앱이 뜨고 Fake 가 주입된다`() {
        assertThat(port).isInstanceOf(FakeScheduleAgent::class.java)
    }
}
