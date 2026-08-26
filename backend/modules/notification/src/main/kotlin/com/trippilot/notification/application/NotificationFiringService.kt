package com.trippilot.notification.application

import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.NotificationScheduleRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration

/** [NotificationFiringService.fire] 의 결과 — 로그·테스트가 "무엇이 일어났는지"를 구분해 볼 수 있게. */
enum class FireOutcome { FIRED, CANCELED_LATE, ALREADY_TAKEN }

/**
 * 예약 한 건을 알림으로 옮긴다. 예약당 트랜잭션 하나 — 한 건이 실패해도 나머지 배치는 산다.
 */
@Service
class NotificationFiringService(
    private val schedules: NotificationScheduleRepository,
    private val notifications: NotificationRepository,
    private val clock: Clock,
) {
    @Transactional
    fun fire(schedule: NotificationSchedule): FireOutcome {
        val now = clock.instant()
        // INV-U6-09 — 지나 버린 예약은 발화하지 않고 닫는다.
        if (schedule.isTooLate(now, LATE_GRACE)) {
            schedules.markCanceled(schedule.scheduleId, now)
            return FireOutcome.CANCELED_LATE
        }
        // 조건부 쓰기가 곧 멱등이다 — 다중 인스턴스가 같은 행을 집어도 UPDATE 는 하나만 성공한다.
        // 표시를 먼저 하고 적재가 실패하면 같은 트랜잭션이라 둘 다 없던 일이 된다(다음 폴링이 다시 집는다).
        if (!schedules.markFired(schedule.scheduleId, now)) return FireOutcome.ALREADY_TAKEN
        // 반환값을 버려도 되는 것은 [NotificationSchedule.toNotification] 이 `sourceEventId = null` 로
        // 만들기 때문이다 — UNIQUE 가 걸리지 않아 항상 삽입된다. 거기에 원천 이벤트를 싣게 되면
        // 여기서 false 를 받고도 FIRED 를 보고하게 되므로, 그때는 이 줄을 함께 고쳐야 한다.
        notifications.appendIfAbsent(schedule.toNotification(now))
        return FireOutcome.FIRED
    }

    private companion object {
        /**
         * 늦게 집힌 것을 얼마까지 봐줄 것인가.
         *
         * 폴링 주기(기본 1분)보다는 넉넉해야 정상 발화가 취소되지 않고, 너무 길면 INV-U6-09 가 막으려던
         * "이미 지난 일정 알림"이 그 길이만큼 새어 나간다. `SLOT_PRE` 기본 리드타임이 30분이라
         * 10분이면 아직 20분의 여유가 남는다.
         */
        private val LATE_GRACE: Duration = Duration.ofMinutes(10)
    }
}
