package com.trippilot.notification.adapter.out.push

import com.trippilot.notification.domain.PushPort
import jakarta.annotation.PostConstruct
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component

/**
 * 기동 시 **어느 발송기가 살아 있는지** 알린다(`RegionGeocodeModeAnnouncer` 와 같은 목적).
 *
 * 스위치를 안 걸어도 앱은 [LoggingPushAdapter] 로 정상 기동하고, 그 어댑터는 성공을 보고한다 —
 * 즉 **아무 데도 안 보내면서 모든 알림이 "발송됨"으로 기록된다.** 그 침묵을 깨지 않으면
 * "푸시가 왜 안 오냐"는 물음에 로그로 답할 수 없다.
 *
 * 판정은 설정값이 아니라 **실제 주입된 구현**으로 한다 — 설정과 결과가 어긋나는 경우가 문제라서다.
 *
 * ## 켰는데 못 보내는 상태로는 기동하지 않는다
 *
 * `mode=expo` 인데 조건부 빈이 안 걸려 로깅 어댑터가 주입됐다면 **설정과 결과가 정반대**다.
 * 운영자는 푸시를 켰다고 믿고 사용자는 알림을 못 받는데 오류는 어디에도 없다 — 기동을 막는다.
 * 지오코딩 스위치에서 같은 판단을 했고(조용히 꺼진 불변식보다 시끄러운 기동 실패가 낫다),
 * 여기도 같은 이유다. 끄려면 `mode` 를 expo 로 두지 않으면 된다.
 */
@Component
class PushModeAnnouncer(
    private val port: PushPort,
    @param:Value("\${trippilot.push.mode:off}") private val mode: String,
) {

    @PostConstruct
    fun announce() {
        val live = port.javaClass.simpleName
        if (mode.equals(EXPO, ignoreCase = true)) {
            check(port !is LoggingPushAdapter) {
                "trippilot.push.mode=expo 인데 실 발송기가 주입되지 않았습니다(현재=$live). " +
                    "이대로 기동하면 아무 데도 보내지 않으면서 모든 알림이 '발송됨'으로 기록됩니다. " +
                    "설정을 확인하거나, 보내지 않으려면 mode 를 expo 가 아닌 값으로 두십시오."
            }
            log.info("푸시 발송 = 실 Expo Push Service · 구현={}", live)
            return
        }
        log.info("푸시 발송 = **미발송**(기록만) · 구현={} — 실제로 기기에 가지 않는다", live)
        if (!mode.equals(OFF, ignoreCase = true)) {
            log.warn("trippilot.push.mode='{}' 는 아는 값이 아닙니다(off|expo) — 미발송으로 동작합니다.", mode)
        }
    }

    private companion object {
        private const val EXPO = "expo"
        private const val OFF = "off"

        private val log = LoggerFactory.getLogger(PushModeAnnouncer::class.java)
    }
}
