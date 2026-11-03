package com.trippilot.notification.adapter.`in`.event

import com.trippilot.auth.api.AccountStatusFacade
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.notification.application.NotificationScheduleService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 계정 삭제 요청 → 리마인드 예약을 멈춘다(미발화 예약 취소).
 *
 * auth 는 삭제를 요청받으면 세션을 끊고 GPS 를 지우지만 **이 모듈의 것은 건드리지 않는다**(다른 모듈은 이 이벤트로 자기 것을 처리한다). 30일
 * 파기 배치도 아직 없어서, 이 구독이 없으면 탈퇴하겠다고 한 사람에게 유예 내내 아침 리마인드가 계속 간다.
 *
 * **이벤트가 아니라 처리 시점의 계정 상태를 따른다.** 릴레이는 at-least-once 이고 같은 타입의 다른 구독자(도우미 대화 파기)가 실패하면 이벤트가
 * 통째로 백오프 재배달된다 — 그 사이 사용자가 철회했다면 뒤늦은 요청 이벤트가 복원된 예약을 다시 지운다. 지금 삭제 유예가 아니면 건드리지 않는다.
 *
 * 푸시 토큰과 알림함은 지우지 않는다. 토큰을 지우면 철회해도 앱이 같은 토큰을 다시 올리지 않아(같은 서명이면 등록을 건너뛴다) 푸시가 조용히 끊기고,
 * 푸시가 안 나가는 것은 발송 지점이 계정 상태로 막는다([com.trippilot.notification.application.PushDispatchService]). 둘 다 파기 때 FK CASCADE 가 지운다.
 *
 * 멱등: 계정 id 로 조건부 쓰기라 같은 이벤트가 두 번 배달돼도(at-least-once) 두 번째는 0건이다.
 * **소급하지 않는다** — 이 구독이 생기기 전에 요청한 계정은 릴레이가 이미 흘려보냈다(그 계정의 예약은 [reload] 가드와 발송 가드가 막는다).
 */
@Component
class AccountDeletionRequestedSubscriber(
    private val accounts: AccountStatusFacade,
    private val schedules: NotificationScheduleService,
) : OutboxSubscriber {

    override val eventType: String = "auth.AccountDeletionRequested"

    override fun handle(envelope: EventEnvelope) {
        val accountId = accountOf(envelope)
        if (!accounts.isDeletionPending(accountId)) {
            log.info("삭제 요청이 이미 철회됐거나 끝나 예약을 건드리지 않습니다. eventId={}", envelope.eventId)
            return
        }
        val canceled = schedules.cancelAll(accountId)
        log.info("계정 삭제 요청으로 리마인드 {}건을 취소했습니다. eventId={}", canceled, envelope.eventId)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(AccountDeletionRequestedSubscriber::class.java)
    }
}

/**
 * 계정 삭제 철회(유예 내 복원) → 삭제 요청 때 취소한 리마인드를 다시 만든다.
 *
 * 취소만 하고 되살리지 않으면 **복원한 사람의 예정된 여행 알림이 말없이 사라진다.** 되살리는 범위는 **취소 흔적이 있는 여행**뿐이다
 * ([NotificationScheduleService.tripsCanceledByDeletion]) — 계정의 모든 여행을 다시 적재하면 일정이 아직 없어 리마인드가 만들어진 적 없는 여행에도
 * 예약이 새로 생긴다. 여행마다 [NotificationScheduleService.reload] 를 부르는 것이 일정 생성 때와 같은 길이라 새 규칙이 없다(지난 시각은 적지 않고,
 * 삭제된 여행은 비운다). 문구는 지금 묻지 않는다 — 릴레이 스레드가 AI 를 기다리지 않게, 문구 없는 행은 재시도 대기열이 곧 채운다.
 *
 * 요청 구독자와 같은 이유로 **처리 시점의 상태**를 따른다 — 철회 뒤 다시 삭제를 요청했다면(요청2) 이 이벤트가 뒤늦게 와도 되살리지 않는다.
 * 푸시 토큰은 건드리지 않았으므로 되살릴 것이 없다.
 *
 * 멱등: [NotificationScheduleService.reload] 가 미발화분 전체 교체라 두 번 배달돼도 결과가 같다.
 */
@Component
class AccountDeletionCancelledSubscriber(
    private val accounts: AccountStatusFacade,
    private val schedules: NotificationScheduleService,
) : OutboxSubscriber {

    override val eventType: String = "auth.AccountDeletionCancelled"

    override fun handle(envelope: EventEnvelope) {
        val accountId = accountOf(envelope)
        if (accounts.isDeletionPending(accountId)) {
            log.info("삭제 유예가 다시 시작돼 예약을 되살리지 않습니다. eventId={}", envelope.eventId)
            return
        }
        val tripIds = schedules.tripsCanceledByDeletion(accountId)
        tripIds.forEach { schedules.reload(it, fillCopies = false) }
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
