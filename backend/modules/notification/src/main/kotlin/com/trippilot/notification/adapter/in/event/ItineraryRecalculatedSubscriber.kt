package com.trippilot.notification.adapter.`in`.event

import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.notification.application.NotificationScheduleService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 재계획이 일정에 반영되면 리마인드 예약을 다시 적재한다(INV-U6-08 의 "U4 재계획" 절반).
 *
 * ## 없으면 무엇이 잘못되나
 *
 * `recalculation.ItineraryRecalculated` 는 **발행되고 있었는데 아무도 듣지 않았다**(실측 구독자 0).
 * 그래서 여행 중 재계획으로 하루가 통째로 바뀌어도 리마인드 예약은 **옛 일정 그대로 남아** 울렸다.
 * 생성 경로만 구독돼 있던 탓에 "알림이 오긴 온다"로 보여 더 안 드러난다.
 *
 * ## 생성 구독자와 따로 두는 이유
 *
 * 뼈대는 같지만 **tripId 를 꺼내는 자리가 다르다** — 생성 이벤트는 payload 에 담고, 이쪽은
 * 집계 식별자가 곧 여행이다(`aggregateId // tripId`). 공통 베이스로 묶으면 그 차이를 추상 메서드로
 * 다시 벌려야 해서, 묶어서 줄어드는 줄보다 읽는 비용이 커진다.
 *
 * 멱등: [NotificationScheduleService.reload] 가 미발화분을 통째로 갈아끼우므로 두 번 배달돼도
 * (at-least-once) 결과가 같다. 소프트 삭제된 여행이면 그쪽이 예약을 비운다.
 */
@Component
class ItineraryRecalculatedSubscriber(
    private val schedules: NotificationScheduleService,
) : OutboxSubscriber {

    override val eventType: String = "recalculation.ItineraryRecalculated"

    override fun handle(envelope: EventEnvelope) {
        // 못 읽으면 예외로 올린다 — 릴레이가 재시도하고 상한에서 error 로 남긴다. 조용히 건너뛰면
        // "재계획했는데 옛 알림이 온다"의 원인을 영영 못 찾는다(INV-4).
        val tripId = runCatching { UUID.fromString(envelope.aggregateId) }.getOrNull()
            ?: error("ItineraryRecalculated 의 aggregateId 를 여행으로 읽지 못했습니다. eventId=${envelope.eventId}")

        schedules.reload(tripId)
        log.debug("재계획 반영으로 리마인드 예약을 재적재했습니다. tripId={} eventId={}", tripId, envelope.eventId)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ItineraryRecalculatedSubscriber::class.java)
    }
}
