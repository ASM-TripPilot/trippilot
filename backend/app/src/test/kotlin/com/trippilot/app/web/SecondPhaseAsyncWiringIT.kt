package com.trippilot.app.web

import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.itinerarygeneration.application.SecondPhaseGenerator
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.aop.support.AopUtils
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.scheduling.annotation.Async
import org.springframework.util.ReflectionUtils

/**
 * 2차 생성이 **실제로 비동기로 배선됐는지** 구조로 고정한다(TRIP-267).
 *
 * 기능 테스트만으로는 못 잡는다 — `@Async` 를 떼거나 `@EnableAsync` 를 지워도 2차가 호출 스레드에서
 * 그대로 돌아 결과는 같고, 사용자가 겪는 것만 "즉시 201" 에서 "20초 대기" 로 조용히 되돌아간다.
 * day1 조기 노출의 유일한 사용자 가치가 그 배선이므로 여기서 못박는다.
 */
@SpringBootTest
class SecondPhaseAsyncWiringIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var secondPhase: SecondPhaseGenerator

    @Test
    fun `2차 생성 빈은 AOP 프록시이고 completeRemaining 은 @Async 다`() {
        // 프록시가 아니면 @Async 어드바이스가 걸리지 않는다(Kotlin 은 기본 final — allopen 플러그인 전제).
        AopUtils.isAopProxy(secondPhase) shouldBe true

        val target = AopUtils.getTargetClass(secondPhase)
        val method = ReflectionUtils.getAllDeclaredMethods(target).single { it.name == "completeRemaining" }
        (method.getAnnotation(Async::class.java) != null) shouldBe true
    }
}
