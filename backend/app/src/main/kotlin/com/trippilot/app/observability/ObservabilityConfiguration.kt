package com.trippilot.app.observability

import io.opentelemetry.api.GlobalOpenTelemetry
import io.opentelemetry.api.OpenTelemetry
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

        if (isTelemetryRecording(openTelemetry)) {
            log.info("OTLP 로그 전송 활성 — OpenTelemetry SDK 주입 완료")
        } else {
            log.warn(
                "OTLP 로그 전송 비활성 — OpenTelemetry 에이전트가 없습니다. " +
                    "stdout JSON 로그만 남습니다. 트레이스·OTLP 로그가 필요하면 " +
                    "-javaagent:opentelemetry-javaagent.jar 로 실행하세요(application.yml 주석 참조).",
            )
        }
    }

    /**
     * 에이전트 유무를 **동작으로** 판별한다.
     *
     * 이전에는 반환된 객체의 클래스명에 "Noop" 이 들어가는지 보았는데, GlobalOpenTelemetry 는
     * no-op 이든 SDK 든 ObfuscatedOpenTelemetry 로 감싸 돌려준다. 그래서 에이전트가 없어도
     * 항상 "활성"으로 오판했다(실측) — 침묵 실패를 막으려던 코드가 스스로 침묵하고 있었다.
     *
     * no-op 트레이서가 만든 스팬은 SpanContext 가 유효하지 않다. 그 계약으로 가른다.
     * 기동당 스팬 하나를 남기지만, "텔레메트리가 실제로 살아 있다"는 표식이라 그대로 둔다.
     */
    private fun isTelemetryRecording(openTelemetry: OpenTelemetry): Boolean {
        val span = openTelemetry.getTracer(SELF_CHECK_SCOPE)
            .spanBuilder("otel-agent-presence-check")
            .startSpan()
        return try {
            span.spanContext.isValid
        } finally {
            span.end()
        }
    }

    // service.name·deployment.environment 는 메터 태그가 아니라 **리소스 속성**이 맞는 자리다.
    // 컨테이너에서는 OTEL_SERVICE_NAME·OTEL_RESOURCE_ATTRIBUTES 로 에이전트에 준다
    // (backend/Dockerfile · deploy/k8s/backend/{configmap,deployment}.yaml).

    private companion object {
        const val SELF_CHECK_SCOPE = "com.trippilot.observability.selfcheck"
    }
}
