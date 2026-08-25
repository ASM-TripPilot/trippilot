package com.trippilot.notification.adapter.out.push

import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushPort
import com.trippilot.notification.domain.PushReceipt
import com.trippilot.notification.domain.PushStatus
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

/**
 * 기본 발송기 — **실제로 아무 데도 보내지 않는다.** 로컬·CI 의 기본값이다.
 *
 * CI 게이트 정책이 "외부 API 호출 0회"라 실 발송기를 기본으로 둘 수 없다. 그렇다고 `PushPort` 를
 * 아예 비워 두면 [com.trippilot.notification.application.PushDispatchService] 가 주입 실패로
 * 기동을 막는다 — 푸시가 필수가 아닌 환경에서 앱 전체가 안 뜨는 것은 과하다.
 *
 * **성공으로 보고한다**(`SENT`). 실패로 보고하면 모든 알림에 `push_failed_reason` 이 쌓여
 * "진짜 실패"를 덮어 버린다. 대신 어느 발송기가 살아 있는지는 [PushModeAnnouncer] 가 기동 시
 * 한 줄로 알린다 — 조용히 안 보내는 상태가 되지 않게.
 */
@Component
class LoggingPushAdapter : PushPort {

    override fun send(tokens: List<String>, message: PushMessage): List<PushReceipt> {
        // 토큰 자체는 남기지 않는다 — 기기 식별자라 로그에 흘리지 않는다.
        log.info("푸시(미발송 모드): 기기 {}대 · 제목='{}'", tokens.size, message.title)
        return tokens.map { PushReceipt(it, PushStatus.SENT) }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(LoggingPushAdapter::class.java)
    }
}
