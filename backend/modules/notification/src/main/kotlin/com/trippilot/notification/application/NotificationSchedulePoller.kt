package com.trippilot.notification.application

import com.trippilot.notification.domain.NotificationScheduleRepository
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock

/**
 * 도래한 리마인드 예약을 알림으로 옮긴다(DEC-U6-10).
 *
 * 아웃박스가 "일어난 일"을 나르는 통로라면 이쪽은 **아무 일도 일어나지 않았는데 시각이 되어** 생기는 알림을
 * 담당한다. 선례는 [com.trippilot.itinerarygeneration.application.StalePartialSweeper] 와 아웃박스 릴레이다.
 *
 * **ShedLock 을 걸지 않는다.** 릴레이는 배달(외부 발송)이 두 번 나가는 것을 막으려고 락이 필요했지만,
 * 여기서 두 인스턴스가 같은 행을 집어도 `fired_at` 조건부 UPDATE 가 하나만 통과시킨다 — 락 없이 멱등이다.
 * 락을 걸면 한 인스턴스가 죽었을 때 `lockAtMostFor` 만큼 리마인드가 통째로 멈춘다.
 */
@Component
class NotificationSchedulePoller(
    private val schedules: NotificationScheduleRepository,
    private val firing: NotificationFiringService,
    private val clock: Clock,
) {
    @Scheduled(fixedDelayString = "\${trippilot.notification.schedule-poll-ms:60000}")
    fun poll() {
        val due = schedules.findDue(clock.instant(), BATCH_SIZE)
        if (due.isEmpty()) return

        var fired = 0
        var canceled = 0
        var muted = 0
        due.forEach { schedule ->
            // 한 건이 터져도 나머지 배치는 살린다 — 예약당 트랜잭션이 따로다.
            runCatching { firing.fire(schedule) }
                .onSuccess {
                    when (it) {
                        FireOutcome.FIRED -> fired++
                        FireOutcome.CANCELED_LATE -> canceled++
                        FireOutcome.MUTED -> muted++
                        FireOutcome.ALREADY_TAKEN -> Unit
                    }
                }
                .onFailure { log.warn("리마인드 발화 실패 — scheduleId={}", schedule.scheduleId, it) }
        }
        if (fired > 0) log.info("리마인드 {}건을 알림함에 적재했습니다.", fired)
        // 조용히 버리지 않는다 — 서버가 멈춰 있었다는 사실의 첫 단서가 이 줄이다(INV-4 · INV-U6-09).
        if (canceled > 0) log.warn("시각이 지나 발화하지 않고 닫은 리마인드 {}건.", canceled)
        // 껐다는 사실도 남긴다 — "왜 안 왔나"의 첫 단서다(INV-4).
        if (muted > 0) log.info("수신을 꺼 두어 적재하지 않은 리마인드 {}건.", muted)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(NotificationSchedulePoller::class.java)

        /** 한 번에 집는 양. 밀렸을 때 오래된 것부터 빠지므로(findDue 의 정렬) 나머지는 다음 주기가 가져간다. */
        private const val BATCH_SIZE = 200
    }
}
