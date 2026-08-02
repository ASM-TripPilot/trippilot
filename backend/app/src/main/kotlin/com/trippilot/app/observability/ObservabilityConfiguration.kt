package com.trippilot.app.observability

import io.opentelemetry.api.GlobalOpenTelemetry
import io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Configuration
import org.springframework.context.event.ContextRefreshedEvent
import org.springframework.context.event.EventListener

/**
 * 관측성 배선(TRIP-218).
 *
 * 로그의 OTLP 전송은 `logback-spring.xml` 의 OTLP appender 가 맡는데, 그 appender 는
 * OpenTelemetry SDK 를 **주입받아야** 동작한다. SDK 는 OTel Java 에이전트가
 * GlobalOpenTelemetry 에 심어 준다.
 *
 * 에이전트가 없으면 no-op 이 반환되어 OTLP 로 아무것도 나가지 않는다 — 이때 조용히 넘어가면
 * "수집기는 떠 있는데 로그가 없다"는 진단하기 어려운 상황이 된다. 그래서 기동 시 상태를 명시적으로 남긴다
 * (침묵 실패 금지, ADR-0011).
 */
@Configuration(proxyBeanMethods = false)
class ObservabilityConfiguration {

    private val log = LoggerFactory.getLogger(javaClass)

    @EventListener(ContextRefreshedEvent::class)
    fun installOpenTelemetryLogAppender() {
        val openTelemetry = GlobalOpenTelemetry.get()
        OpenTelemetryAppender.install(openTelemetry)

        // no-op 구현은 클래스명에 "Noop" 이 들어간다 — 에이전트 부재를 이걸로 판별한다.
        val agentPresent = !openTelemetry.javaClass.name.contains("Noop", ignoreCase = true)
        if (agentPresent) {
            log.info("OTLP 로그 전송 활성 — OpenTelemetry SDK 주입 완료")
        } else {
            log.warn(
                "OTLP 로그 전송 비활성 — OpenTelemetry 에이전트가 없습니다. " +
                    "stdout JSON 로그만 남습니다. 트레이스·OTLP 로그가 필요하면 " +
                    "-javaagent:opentelemetry-javaagent.jar 로 실행하세요(application.yml 주석 참조).",
            )
        }
    }

    // service.name·deployment.environment 는 메터 태그가 아니라 **리소스 속성**이 맞는 자리다.
    // application.yml 의 management.otlp.metrics.export.resource-attributes 가 담당한다.
}
