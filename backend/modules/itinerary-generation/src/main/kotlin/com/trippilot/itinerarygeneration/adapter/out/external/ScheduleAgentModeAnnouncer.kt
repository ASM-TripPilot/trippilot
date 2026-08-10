package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import jakarta.annotation.PostConstruct
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component

/**
 * 기동 시 **어느 일정 생성 경계가 살아 있는지**를 로그로 알린다.
 *
 * 왜 필요한가: 스위치가 안 걸려도 앱은 기본값(fake)으로 **정상 기동한다**. 그래서 공동 통합테스트에서
 * "AI 를 붙였는데 전부 폴백"이 나와도 컨테이너 로그만 봐서는 우리가 fake 로 돌고 있는 건지
 * AI 가 실패하는 건지 구분되지 않는다. 설정값에 오타가 있으면 조건부 빈이 안 걸려
 * **조용히 fake 로 남는다** — 그 침묵을 여기서 깬다.
 *
 * 판정은 설정값이 아니라 **실제 주입된 구현**으로 한다(설정과 결과가 어긋나는 경우가 문제라서).
 *
 * [ScheduleAgentProperties] 를 주입받지 않는다 — 그 빈은 [ScheduleAgentConfiguration] 안에서만 등록되고
 * 그 설정은 http 조건부라, 주입받으면 **fake 모드에서 기동이 깨진다**(실제로 겪었다). 설정값은 `@Value` 로
 * 프로퍼티에서 직접 읽는다.
 */
@Component
class ScheduleAgentModeAnnouncer(
    private val port: ScheduleAgentPort,
    @param:Value("\${trippilot.ai.schedule.mode:fake}") private val mode: String,
    @param:Value("\${trippilot.ai.schedule.base-url:}") private val baseUrl: String,
) {

    @PostConstruct
    fun announce() {
        val live = port.javaClass.simpleName
        if (port is HttpScheduleAgentAdapter) {
            log.info("일정 생성 경계 = 실 AI(http) · baseUrl={} · 구현={}", baseUrl, live)
        } else {
            log.info("일정 생성 경계 = 내장 Fake · 구현={} (AI 를 호출하지 않는다)", live)
        }
        // 아는 값이 아니면 조건부 빈이 안 걸려 fake 로 남는다 — 설정 의도와 결과가 다르다는 뜻이라 경고로 올린다.
        if (!mode.equals("fake", ignoreCase = true) && !mode.equals("http", ignoreCase = true)) {
            log.warn("trippilot.ai.schedule.mode='{}' 는 아는 값이 아닙니다(fake|http) — 내장 Fake 로 동작합니다.", mode)
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ScheduleAgentModeAnnouncer::class.java)
    }
}
