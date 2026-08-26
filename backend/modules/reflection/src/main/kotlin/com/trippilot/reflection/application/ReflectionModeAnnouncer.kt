package com.trippilot.reflection.application

import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.stereotype.Component

/**
 * 회고 생성 경로를 기동 때 드러낸다(BR-U5-38).
 *
 * **첫 사용자 요청에서 조용히 폴백하지 않는다.** `http` 로 켜 뒀는데 `ai/` 에 회고 경계가 없으면
 * 그 사실이 배포 직후 로그에 남아야 한다 — 안 그러면 "AI 회고를 켰다"고 믿는 채로 몇 주가 간다.
 *
 * 현재 열린 값은 `rule` 뿐이다(O-U5-6). `ai/` 경계 6종에 reflection 이 없고(2026-08-25 실측)
 * backend 에 LLM 게이트웨이도 없어, 규칙 문장으로 먼저 열고 `source` 로 품질을 관측한 뒤 붙인다.
 */
@Component
class ReflectionModeAnnouncer(
    @param:Value("\${trippilot.ai.reflection.mode:rule}") private val mode: String,
) {
    @EventListener(ApplicationReadyEvent::class)
    fun announce() {
        when (mode) {
            MODE_RULE -> log.info("회고 생성 = **규칙 문장**(TRIP-552) · AI 경로는 미개통(O-U5-6)")
            MODE_HTTP -> log.error(
                "trippilot.ai.reflection.mode='http' 인데 ai/ 에 회고 경계가 없습니다 — " +
                    "규칙 문장으로 동작합니다. 켠 줄 알고 두면 몇 주간 모른다(BR-U5-38).",
            )
            else -> log.warn("trippilot.ai.reflection.mode='{}' 는 아는 값이 아닙니다(rule|http) — 규칙 문장으로 동작합니다.", mode)
        }
    }

    private companion object {
        private const val MODE_RULE = "rule"
        private const val MODE_HTTP = "http"
        private val log = LoggerFactory.getLogger(ReflectionModeAnnouncer::class.java)
    }
}
