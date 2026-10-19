package com.trippilot.notification.application

import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * 리마인드 문구를 **하나도 못 받은** 여행을 잠시 뒤 **한 번만** 다시 적재한다.
 *
 * 왜: 학생 모델(Bedrock Custom Model Import)은 5분 무호출이면 0 으로 내려가고, 그 뒤 첫 호출은
 * `ModelNotReady` 로 곧바로 실패하면서 적재를 시작한다(약 2분, 2026-10-14 실측). 트래픽이 드문 환경에서는
 * 대부분의 적재가 바로 그 첫 호출이라, 재시도가 없으면 문구가 거의 늘 상수로 굳는다. 첫 호출이 이미 모델을
 * 깨웠으니 몇 분 뒤 다시 물으면 받는다. 모델을 늘 깨워 두는 길은 5분 창마다 과금이라 택하지 않았다.
 *
 * 재시도는 [NotificationScheduleService.reload] 를 한 번 더 부르는 것이다 — 적재가 원래 미발화분을
 * 통째로 다시 만드는 멱등 연산이라 고칠 행을 따로 고를 필요가 없고, 그 사이 일정이 바뀌었으면 최신
 * 일정으로 다시 만든다.
 *
 * ponytail: 대기열이 메모리에만 있다 — 그 사이 파드가 재시작되면 그 재시도는 사라지고 상수 문구로 남는다
 * (재시도가 없던 때와 같은 동작). 그게 문제가 되면 예약 행에 재시도 시각 칸을 두고 폴러가 읽게 바꾼다.
 */
@Component
class ReminderCopyRetries(
    @Value("\${trippilot.notification.copy-retry-delay-ms:180000}") private val delayMs: Long,
) {
    private val due = ConcurrentHashMap<UUID, Instant>()

    fun later(tripId: UUID, now: Instant) {
        due[tripId] = now.plusMillis(delayMs)
    }

    /** 때가 된 여행을 꺼낸다. 꺼낸 것은 대기열에서 빠진다 — 같은 재시도가 두 번 돌지 않는다. */
    fun takeDue(now: Instant): List<UUID> =
        due.entries
            .filter { !it.value.isAfter(now) }
            // 값까지 맞을 때만 뺀다 — 그 사이 같은 여행이 새로 걸렸으면(더 늦은 시각) 그건 남긴다.
            .mapNotNull { (tripId, at) -> tripId.takeIf { due.remove(tripId, at) } }
}

/**
 * [ReminderCopyRetries] 를 비운다. 리마인드 발화 폴러([NotificationSchedulePoller])와 같은 이유로
 * ShedLock 을 걸지 않는다 — 대기열이 파드마다 따로라 두 인스턴스가 같은 여행을 집을 일이 없다.
 */
@Component
class ReminderCopyRetryPoller(
    private val retries: ReminderCopyRetries,
    private val schedules: NotificationScheduleService,
    private val clock: Clock,
) {
    @Scheduled(fixedDelayString = "\${trippilot.notification.copy-retry-poll-ms:30000}",
        initialDelayString = "\${trippilot.notification.copy-retry-poll-initial-delay-ms:30000}")
    fun retryDue() {
        retries.takeDue(clock.instant()).forEach { tripId ->
            // 재시도의 재시도는 없다 — 또 못 받으면 상수 문구로 둔다. 상대가 아예 죽었을 때 계속 두드리지 않는다.
            runCatching { schedules.reload(tripId, retryIfNoCopy = false) }
                .onFailure { log.warn("리마인드 문구 재시도 적재 실패 — tripId={}", tripId, it) }
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ReminderCopyRetryPoller::class.java)
    }
}
