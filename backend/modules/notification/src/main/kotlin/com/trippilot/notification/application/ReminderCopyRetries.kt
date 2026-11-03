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
 * 리마인드 문구가 **아직 없는 예약이 남은** 여행을 점점 늘려 가며 **제자리에서** 다시 채운다.
 *
 * 왜: 학생 모델(Bedrock Custom Model Import)은 5분 무호출이면 0 으로 내려가고, 그 뒤 첫 호출은 `ModelNotReady` 로
 * 곧바로 실패하면서 적재를 시작한다(약 2~5분, 운영 실측). 트래픽이 드문 환경에서는 대부분의 적재가 바로 그 첫 호출이라
 * 재시도가 없으면 문구가 거의 늘 상수로 굳는다. 종전에는 "하나도 못 받은" 적재만 3분 뒤 **한 번** 적재를 통째로 다시 만들었다 —
 * 모델이 3분 안에 안 올라오거나(운영에서 4~5분 걸린 때가 있었다), 일부만 받았거나, 다일 여행이라 2일차 이후 일정이 아직
 * 안 만들어졌을 때(1차 저장 직후 적재가 돈다) 그 한 번이 헛돌고 문구가 상수로 굳었다. 이제는:
 * - **빠진 행만, 제자리에서** 채운다([NotificationScheduleService.fillMissing]) — 행을 다시 만들지 않으므로 앞서 받은 문구를
 *   잃지 않는다. 일부만 받은 적재도, 재료(일정)가 뒤늦게 생긴 날도 이 길로 메워진다.
 * - **간격을 늘려 여러 번** 묻는다([delaysMs]) — 모델을 깨운 첫 호출 뒤 올라오는 시간(분 단위)을 지나치지 않고, 상대가 아예
 *   죽었을 때 계속 두드리지도 않는다. 횟수를 다 쓰면 포기하고 한 줄 남긴다(INV-4: 조용한 실패 금지).
 *
 * 모델을 늘 깨워 두는 길은 5분 창마다 과금이라 택하지 않았다. 실패한 호출은 과금되지 않고(모델이 아직 안 떴다), 성공한 호출만
 * 5분 창을 연다 — 재시도를 늘려도 비용은 **문구를 실제로 만든 만큼**만 는다.
 *
 * ponytail: 대기열이 메모리에만 있다 — 그 사이 파드가 재시작되면 그 여행의 남은 재시도는 사라지고 상수 문구로 남는다
 * (다음 재적재가 오면 다시 시작한다). 그게 문제가 되면 DB 에서 "문구 없는 미발화 예약이 있는 여행"을 훑는 주기 작업을 둔다.
 */
@Component
class ReminderCopyRetries(
    /** 재시도 사이 간격(ms) — i 번째 값이 i 번째 재시도까지의 대기다. 개수가 곧 최대 재시도 횟수. */
    @Value("\${trippilot.notification.copy-retry-delays-ms:180000,300000,480000,780000,1260000}")
    private val delaysMs: List<Long>,
) {
    init {
        require(delaysMs.isNotEmpty() && delaysMs.all { it > 0 }) { "재시도 간격은 1개 이상, 모두 양수여야 합니다: $delaysMs" }
    }

    /** 때가 된 재시도 하나 — [attempt] 는 0 부터(0 = 첫 재시도). */
    data class Due(val tripId: UUID, val attempt: Int)

    private data class Entry(val at: Instant, val attempt: Int)

    private val due = ConcurrentHashMap<UUID, Entry>()

    /** 최대 재시도 횟수. */
    val maxAttempts: Int get() = delaysMs.size

    /**
     * [attempt] 번째(0 부터) 재시도를 [now] 로부터 정해진 간격 뒤에 건다. 같은 여행에 이미 걸린 것이 있으면 **덮는다** —
     * 새 적재(일정이 바뀜)가 오면 옛 재시도 사슬을 이어 가지 않고 처음부터 다시 시작한다. 횟수를 다 썼으면 걸지 않고 false.
     */
    fun later(tripId: UUID, now: Instant, attempt: Int): Boolean {
        if (attempt !in delaysMs.indices) return false
        due[tripId] = Entry(now.plusMillis(delaysMs[attempt]), attempt)
        return true
    }

    /** 때가 된 여행을 꺼낸다. 꺼낸 것은 대기열에서 빠진다 — 같은 재시도가 두 번 돌지 않는다. */
    fun takeDue(now: Instant): List<Due> =
        due.entries
            .filter { !it.value.at.isAfter(now) }
            // 값까지 맞을 때만 뺀다 — 그 사이 같은 여행이 새로 걸렸으면(더 늦은 시각·처음부터) 그건 남긴다.
            .mapNotNull { (tripId, entry) -> if (due.remove(tripId, entry)) Due(tripId, entry.attempt) else null }
}

/**
 * [ReminderCopyRetries] 를 비운다. 리마인드 발화 폴러([NotificationSchedulePoller])와 같은 이유로
 * ShedLock 을 걸지 않는다 — 대기열이 파드마다 따로라 두 인스턴스가 같은 여행을 집을 일이 없고, 설령 겹쳐도 채우기는
 * 조건부 쓰기(이미 문구가 붙은 행은 덮지 않는다)라 먼저 붙은 문구가 이긴다.
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
        val now = clock.instant()
        retries.takeDue(now).forEach { due ->
            val outcome = runCatching { schedules.fillMissing(due.tripId) }
                .onFailure { log.warn("리마인드 문구 채움 실패 — tripId={} 시도={}회째", due.tripId, due.attempt + 1, it) }
                // 터졌으면 다음 기회에 다시 — 못 채운 것으로 본다.
                .getOrDefault(FillOutcome.Retry(remaining = UNKNOWN_REMAINING, noMaterial = 0))
            if (outcome !is FillOutcome.Retry) return@forEach
            if (!retries.later(due.tripId, now, due.attempt + 1)) {
                // 횟수를 다 썼다 — 남은 행은 상수 문구로 간다. 한 줄은 남긴다(조용한 포기 금지).
                log.warn(
                    "리마인드 문구를 끝내 못 채웠습니다 — 남은 행은 상수 문구로 갑니다. tripId={} 남은 행={}건(재료 없음 {}건) 시도={}회",
                    due.tripId, outcome.remaining, outcome.noMaterial, due.attempt + 1,
                )
            }
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ReminderCopyRetryPoller::class.java)

        /** 채움이 예외로 끝나 남은 수를 모를 때. */
        private const val UNKNOWN_REMAINING = -1
    }
}
