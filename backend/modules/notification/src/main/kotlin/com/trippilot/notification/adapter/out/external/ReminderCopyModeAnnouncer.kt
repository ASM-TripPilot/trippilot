package com.trippilot.notification.adapter.out.external

import com.trippilot.notification.domain.ReminderCopyPort
import jakarta.annotation.PostConstruct
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component

/**
 * 기동 시 **리마인드 문구를 AI 가 채우는지**를 알린다(`RegionGeocodeModeAnnouncer` 선례).
 *
 * 꺼져 있어도 리마인드는 상수 문구로 정상 발화한다 — 그게 설계다(INV-4). 그래서 **꺼진 것과
 * 켰는데 안 붙는 것이 화면에서 구별되지 않는다.** 둘 다 밋밋한 상수 문구로 보인다.
 * 그 침묵을 여기서 깬다.
 *
 * 판정은 설정값이 아니라 **실제 주입된 구현**으로 한다 — `unwiredReminderCopy` 폴백 빈이
 * `@ConditionalOnMissingBean` 으로 걸리므로, 모드를 켰는데 http 빈이 안 만들어진 경우
 * (오타·프로퍼티 경로 불일치)에도 설정값만 보면 "켰다"로 읽힌다.
 */
@Component
class ReminderCopyModeAnnouncer(
    private val port: ReminderCopyPort,
    @param:Value("\${trippilot.ai.reminder-copy.mode:off}") private val mode: String,
) {

    @PostConstruct
    fun announce() {
        val live = port.javaClass.simpleName
        if (port.enabled) {
            log.info("리마인드 문구 = 실 AI(POST /ai/v1/notification/copies) · 구현={} — 못 받으면 상수 문구로 간다", live)
        } else {
            log.info("리마인드 문구 = 상수 문구 고정 · 구현={} — AI 경계는 배선돼 있으나 꺼져 있다", live)
        }
        // 아는 값이 아니면 조건부 빈이 안 걸려 폴백으로 남는다 — 설정 의도와 결과가 다르다는 뜻이라 경고로 올린다.
        if (!mode.equals("off", ignoreCase = true) && !mode.equals("http", ignoreCase = true)) {
            log.warn("trippilot.ai.reminder-copy.mode='{}' 는 아는 값이 아닙니다(off|http) — 상수 문구로 동작합니다.", mode)
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ReminderCopyModeAnnouncer::class.java)
    }
}
