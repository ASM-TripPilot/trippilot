package com.trippilot.auth.application

import com.trippilot.auth.domain.port.LocationLegalLogRepository
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional

/**
 * 위치 확인자료 보존기간 스위프(TRIP-881) — 약관의 "기록 시점부터 6개월"(위치정보법 제16조②)을
 * 코드가 실제로 지키게 한다. 약관이 6개월이라 말하는데 테이블이 영구 보존이면 약관이 거짓말이 된다.
 *
 * 삭제는 앱 권한이 아니라 **동작이 고정된 DB 함수**(V2.49, SECURITY DEFINER) 경유다 — app_user 는
 * 여전히 location_legal_log 에 DELETE 가 없다(INV-LL1). 이 스위퍼가 할 수 있는 것은 "만료분 정리"
 * 하나뿐이고, 무엇이 만료인지는 함수가 정한다.
 *
 * ShedLock 없음 — 만료분 DELETE 는 멱등이라 다중 인스턴스가 겹쳐 돌아도 두 번 지워질 것이 없다
 * (notification 의 NotificationSchedulePoller 와 같은 판단). 주기는 하루 — 법정 기간 경계에서
 * 분 단위 정확도가 필요 없고, 하루 늦은 파기는 "최소 6개월 보존" 쪽으로 안전하다.
 */
@Component
class LocationLegalLogRetentionSweeper(
    private val legalLog: LocationLegalLogRepository,
) {
    @Scheduled(
        fixedDelayString = "\${trippilot.auth.legal-log-retention-sweep-ms:86400000}",
        initialDelayString = "\${trippilot.auth.legal-log-retention-initial-delay-ms:0}",
    )
    @Transactional
    fun sweep() {
        val purged = legalLog.purgeExpired()
        // 조용히 지우지 않는다 — 법정 자료의 파기는 로그로 답할 수 있어야 한다(INV-4).
        if (purged > 0) log.info("보존기간(6개월)이 지난 위치 확인자료 {}건을 파기했습니다.", purged)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(LocationLegalLogRetentionSweeper::class.java)
    }
}
