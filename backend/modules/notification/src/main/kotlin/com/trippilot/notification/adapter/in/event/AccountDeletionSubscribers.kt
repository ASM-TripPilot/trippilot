package com.trippilot.notification.adapter.`in`.event

import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.notification.application.NotificationScheduleService
import com.trippilot.notification.application.PushTokenService
import com.trippilot.trip.api.TripPurgeScopeFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 계정 삭제 요청 → 알림을 멈춘다(리마인드 예약 취소 + 푸시 토큰 제거).
 *
 * auth 는 삭제를 요청받으면 세션을 끊고 GPS 를 지우지만 **이 모듈의 것은 건드리지 않는다**(다른 모듈은 이 이벤트로 자기 것을
 * 지운다). 30일 파기 배치도 아직 없어서, 이 구독이 없으면 탈퇴하겠다고 한 사람에게 **유예 내내**(파기 배치가 생기기 전엔
 * 영영) 아침 리마인드가 계속 간다.
 *
 * 알림함(`notification`)은 지우지 않는다 — 철회하면 그대로 돌아와야 하고, 파기 때 계정 FK CASCADE 가 지운다
 * (`CascadeSummary` 의 NOTIFICATION).
 *
 * 멱등: 계정 id 로 조건부 쓰기라 같은 이벤트가 두 번 배달돼도(at-least-once) 두 번째는 0건이다.
 * **소급하지 않는다** — 이 구독이 생기기 전에 요청한 계정은 릴레이가 이미 흘려보냈다(운영에서 삭제 요청 계정이 있는지는
 * 배포 뒤 `account.status = 'DELETION_PENDING'` 로 센다).
 */
@Component
class AccountDeletionRequestedSubscriber(
    private val tokens: PushTokenService,
    private val schedules: NotificationScheduleService,
) : OutboxSubscriber {

    override val eventType: String = "auth.AccountDeletionRequested"

    override fun handle(envelope: EventEnvelope) {
        val accountId = accountOf(envelope)
        val canceled = schedules.cancelAll(accountId)
        val removed = tokens.removeAll(accountId)
        log.info("계정 삭제 요청으로 리마인드 {}건을 취소하고 푸시 토큰 {}개를 지웠습니다. eventId={}", canceled, removed, envelope.eventId)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(AccountDeletionRequestedSubscriber::class.java)
    }
}

/**
 * 계정 삭제 철회(유예 내 복원) → 삭제 요청 때 취소한 리마인드를 다시 만든다.
 *
 * 취소만 하고 되살리지 않으면 **복원한 사람의 예정된 여행 알림이 말없이 사라진다.** 여행마다 [NotificationScheduleService.reload] 를
 * 부르는 것이 일정 생성 때와 같은 길이라 새 규칙이 없다 — 지난 시각은 적지 않고, 삭제된 여행은 비운다.
 *
 * 푸시 토큰은 되살리지 않는다 — 삭제 요청으로 세션이 끊겼으므로 복원한 앱이 다시 로그인하면서 토큰을 다시 등록한다.
 *
 * 멱등: [NotificationScheduleService.reload] 가 미발화분 전체 교체라 두 번 배달돼도 결과가 같다.
 */
@Component
class AccountDeletionCancelledSubscriber(
    private val trips: TripPurgeScopeFacade,
    private val schedules: NotificationScheduleService,
) : OutboxSubscriber {

    override val eventType: String = "auth.AccountDeletionCancelled"

    override fun handle(envelope: EventEnvelope) {
        val accountId = accountOf(envelope)
        // 삭제된 여행까지 받는다(상한 없음) — reload 가 그런 여행은 비운다.
        val tripIds = trips.findAllTripIdsOf(accountId)
        tripIds.forEach(schedules::reload)
        log.info("계정 삭제 철회로 여행 {}건의 리마인드를 다시 적재했습니다. eventId={}", tripIds.size, envelope.eventId)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(AccountDeletionCancelledSubscriber::class.java)
    }
}

// 못 읽으면 예외로 올린다 — 릴레이가 재시도하고 상한에서 error 로 남긴다(INV-4).
private fun accountOf(envelope: EventEnvelope): UUID =
    runCatching { UUID.fromString(envelope.aggregateId) }.getOrNull()
        ?: error("${envelope.eventType} 의 aggregateId 를 계정으로 읽지 못했습니다. eventId=${envelope.eventId}")
