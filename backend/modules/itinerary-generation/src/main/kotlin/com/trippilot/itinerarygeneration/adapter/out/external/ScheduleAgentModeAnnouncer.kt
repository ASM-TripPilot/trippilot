package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.application.ScheduleDeadlineProperties
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
 * 프로퍼티에서 직접 읽는다. [ScheduleDeadlineProperties] 는 반대로 조건 없이 등록되므로
 * ([com.trippilot.itinerarygeneration.application.GenerationConfiguration]) 그대로 주입받는다.
 */
@Component
class ScheduleAgentModeAnnouncer(
    private val port: ScheduleAgentPort,
    @param:Value("\${trippilot.ai.schedule.mode:fake}") private val mode: String,
    @param:Value("\${trippilot.ai.schedule.base-url:}") private val baseUrl: String,
    @param:Value("\${trippilot.ai.schedule.service-token:}") private val serviceToken: String,
    private val deadlines: ScheduleDeadlineProperties,
) {

    @PostConstruct
    fun announce() {
        val live = port.javaClass.simpleName
        if (port is HttpScheduleAgentAdapter) {
            log.info("일정 생성 경계 = 실 AI(http) · baseUrl={} · 구현={}", baseUrl, live)
            announceServiceToken()
        } else {
            log.info("일정 생성 경계 = 내장 Fake · 구현={} (AI 를 호출하지 않는다)", live)
        }
        announceDeadlines()
        // 아는 값이 아니면 조건부 빈이 안 걸려 fake 로 남는다 — 설정 의도와 결과가 다르다는 뜻이라 경고로 올린다.
        if (!mode.equals("fake", ignoreCase = true) && !mode.equals("http", ignoreCase = true)) {
            log.warn("trippilot.ai.schedule.mode='{}' 는 아는 값이 아닙니다(fake|http) — 내장 Fake 로 동작합니다.", mode)
        }
    }

    /**
     * **자격증명 유무를 기동 로그에 남긴다**(TRIP-856). 토큰이 없어도 호출은 나가므로(fail-open) 증상이 없다 —
     * 상대가 검증을 켜는 날 전부 401 이 되고 나서야 "안 싣고 있었다"를 알게 되는 것이 이 로그가 막으려는 것이다.
     * **값은 절대 찍지 않는다** — 로그는 컨테이너 밖으로 나가고 시크릿은 나가면 안 된다.
     */
    private fun announceServiceToken() {
        if (serviceToken.isBlank()) {
            log.warn(
                "AI 발신 서비스 토큰이 비어 있습니다(SERVICE_AUTH_TOKEN) — {} 헤더 없이 호출합니다. " +
                    "상대가 검증을 켜면 전부 거부됩니다(TRIP-856).",
                ScheduleAgentConfiguration.SERVICE_TOKEN_HEADER,
            )
        } else {
            log.info("AI 발신 서비스 토큰 = 설정됨 · 헤더 {}", ScheduleAgentConfiguration.SERVICE_TOKEN_HEADER)
        }
    }

    /**
     * **시한 상태도 같이 알린다.** "AI 를 붙였는데 전부 폴백"의 원인이 대개 이 값이다 —
     * 실측 지연이 시한을 넘으면 AI 가 규칙 폴백으로 내려간다. 로그에 없으면 그 사실을 알 길이 없다.
     */
    private fun announceDeadlines() {
        if (!deadlines.enforced) {
            log.info(
                "일정 생성 시한 = **걸지 않음**(TRIP-474) · 생성 대기 {}s · 편집 대기 {}s · 멈춘 생성 판정 {}s",
                deadlines.waitCeilingMs / 1000, deadlines.editWait.toSeconds(), deadlines.staleAfter.toSeconds(),
            )
            return
        }
        log.info(
            "일정 생성 시한(권고·SLO) = day1 {}ms · 전체 {}ms · 멈춘 생성 판정 {}s",
            deadlines.day1Ms, deadlines.totalMs, deadlines.staleAfter.toSeconds(),
        )
        // SLO 를 넘겨 설정한 것은 **과도기 값**이다(PR #104). 운영에 그대로 나가면 사용자 대기가 SLO 를
        // 넘으므로 눈에 띄게 남긴다 — 조용히 지나가면 임시가 영구가 된다.
        if (deadlines.day1Ms > SLO_DAY1_MS || deadlines.totalMs > SLO_TOTAL_MS) {
            log.warn(
                "시한이 SLO(day1 {}ms · 전체 {}ms)를 넘게 설정돼 있습니다 — 실 LLM 검증용 과도기 값인지 확인하세요.",
                SLO_DAY1_MS, SLO_TOTAL_MS,
            )
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ScheduleAgentModeAnnouncer::class.java)

        /** 문서·대시보드의 지향점(PR #104). 폐기된 값이 아니라 **넘으면 눈에 띄어야 하는** 값이다. */
        private const val SLO_DAY1_MS = 5_000L
        private const val SLO_TOTAL_MS = 20_000L
    }
}
