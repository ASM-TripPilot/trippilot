package com.trippilot.reflection.application

import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.stereotype.Component

/**
 * 회고 생성 경로를 기동 때 드러낸다(BR-U5-38).
 *
 * **첫 사용자 요청에서 조용히 폴백하지 않는다.** 어느 단이 도는지가 배포 직후 로그에 남아야 한다 —
 * 안 그러면 "AI 회고를 켰다"고 믿는 채로 몇 주가 간다.
 *
 * **2026-09-01 — 전제가 바뀌었다.** 예전 판은 *"`ai/` 에 회고 경계가 없다(2026-08-25 실측)"* 를 근거로
 * `http` 를 오류로 취급했다. 지금은 `POST /ai/v1/reflection/generate` 가 실재하고(G-U5-4 해소)
 * O-U5-6 이 `http` 로 확정됐다. 낡은 단언을 그대로 뒀다면 **정상 설정에 error 로그가 찍혔을 것이다.**
 *
 * 기본값은 여전히 `rule` 이다 — 켜는 판단은 `source` 관측 뒤에 온다(BR-U5-33).
 */
@Component
class ReflectionModeAnnouncer(
    @param:Value("\${trippilot.ai.reflection.mode:rule}") private val mode: String,
) {
    @EventListener(ApplicationReadyEvent::class)
    fun announce() {
        when (mode) {
            MODE_RULE -> log.info("회고 생성 = 규칙 카드. AI 경계는 배선돼 있으나 꺼져 있습니다(mode=rule).")
            MODE_HTTP -> log.info("회고 생성 = AI 카드(POST /ai/v1/reflection/generate). 실패 시 규칙 카드로 내려갑니다.")
            // 오타를 조용히 rule 로 삼키지 않는다 — "켰는데 왜 안 되지"의 원인이 여기 남아야 한다(BR-U5-38).
            else -> log.error(
                "trippilot.ai.reflection.mode='{}' 는 아는 값이 아닙니다(rule|http) — 규칙 카드로 동작합니다.", mode,
            )
        }
    }

    private companion object {
        private const val MODE_RULE = "rule"
        private const val MODE_HTTP = "http"
        private val log = LoggerFactory.getLogger(ReflectionModeAnnouncer::class.java)
    }
}
