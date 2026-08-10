package com.trippilot.planb.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.planb.domain.TriggerEvent
import com.trippilot.planb.domain.TriggerEventRepository
import com.trippilot.planb.domain.TriggerSettingRepository
import com.trippilot.planb.domain.TriggerStatus
import com.trippilot.planb.domain.TriggerSuppression
import com.trippilot.planb.domain.TriggerType
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * 트리거 목록·닫기·발생(US-PLANB-02).
 *
 * 발생([raise])은 사용자가 부르는 API 가 아니다 — 감지기(후속 티켓)가 부른다. 여기서는 **억제**만 책임진다:
 * 같은 사유·같은 방문지 중복, 사용자가 닫은 것, 하루 총량. 감지 로직과 나눠 둔 이유는 억제 규칙이
 * 외부 신호와 무관하게 결정되며 그 자체로 검증돼야 하기 때문이다.
 */
@Service
class TriggerService(
    private val trips: TripFacade,
    private val triggers: TriggerEventRepository,
    private val settings: TriggerSettingRepository,
    private val clock: Clock,
) {

    @Transactional(readOnly = true)
    fun list(accountId: UUID, tripId: UUID): List<TriggerEvent> {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        return triggers.findByTrip(tripId)
    }

    /** "그대로 둘게요". 지우지 않고 상태로 남긴다 — 다시 알리지 않을 근거가 이 행이다. */
    @Transactional
    fun dismiss(accountId: UUID, tripId: UUID, triggerEventId: UUID): TriggerEvent {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        // 트리거를 **여행 범위로 좁혀** 찾는다 — id 만으로 찾으면 남의 여행 트리거를 닫을 수 있다.
        val event = triggers.findById(triggerEventId)?.takeIf { it.tripId == tripId }
            ?: throw ResourceNotFound("트리거를 찾을 수 없습니다.")
        if (event.status != TriggerStatus.ACTIVE) {
            throw ConflictDetected(message = "이미 닫혔거나 해소된 알림입니다.")
        }
        return triggers.save(event.dismissed(clock.instant()))
    }

    /**
     * 감지 결과를 배너로 올린다. 억제되면 **아무것도 만들지 않고 null** 을 돌려준다 —
     * 억제는 실패가 아니라 정상 동작이라 예외로 다루지 않는다(사유는 로그로 남긴다).
     */
    @Transactional
    fun raise(tripId: UUID, type: TriggerType, targetSlotId: UUID?, value: String): TriggerEvent? {
        val today = LocalDate.ofInstant(clock.instant(), TRAVEL_ZONE)
        val verdict = TriggerSuppression.judge(
            existing = triggers.findHistory(tripId, type, targetSlotId),
            raisedToday = triggers.countRaisedOn(tripId, today),
            sensitivity = settings.sensitivityOf(tripId),
        )
        if (verdict != TriggerSuppression.Verdict.RAISE) {
            log.debug("트리거 억제 — tripId={} type={} slot={} 사유={}", tripId, type, targetSlotId, verdict)
            return null
        }
        return triggers.save(TriggerEvent.raise(tripId, type, targetSlotId, value, clock.instant()))
    }

    /** 상황이 해소됐다. 사용자가 닫은 것(DISMISSED)은 건드리지 않는다 — 그건 사용자의 뜻이다. */
    @Transactional
    fun resolve(tripId: UUID, type: TriggerType, targetSlotId: UUID?): TriggerEvent? {
        val active = triggers.findHistory(tripId, type, targetSlotId)
            .firstOrNull { it.status == TriggerStatus.ACTIVE } ?: return null
        return triggers.save(active.resolved(clock.instant()))
    }

    private companion object {
        private val log = LoggerFactory.getLogger(TriggerService::class.java)

        /** 하루 총량은 **여행지 기준 날짜**로 센다 — 서버 UTC 날짜로 세면 자정 무렵에 한도가 어긋난다. */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}
