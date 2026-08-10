package com.trippilot.planbdetection.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.SensitivityRepository
import com.trippilot.planbdetection.domain.Suppression
import com.trippilot.planbdetection.domain.SuppressionRepository
import com.trippilot.planbdetection.domain.SuppressionScope
import com.trippilot.planbdetection.domain.TriggerEvaluator
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** 클라이언트가 모아 보낸 신호(BR-U4-03 — 판정은 서버가 한다). */
data class DetectionSignal(
    val kind: TriggerKind,
    val affectedDate: LocalDate,
    /** 영향 슬롯의 경계 키. 날짜 전체 영향이면 null. */
    val slotKey: String?,
    /** 직렬화 가능 원시값만. 예: `{"pop":70}` · `{"delayMin":18}` */
    val payload: Map<String, Any>,
    /** 사용자 노출 문구의 근거(`비 예보 70%`). */
    val reason: String,
    /** 발화 시 재계획 범위. */
    val scope: TriggerScope,
)

/**
 * 감지·억제(C9).
 *
 * 핵심은 **판정 결과를 발화 여부와 무관하게 남긴다**는 것이다(정본 §2.1) — 억제됐는지, 영향이 없다고 봤는지는
 * 서로 다른 사실이라, 남기지 않으면 "왜 알림이 안 왔나"에 답할 수 없다.
 *
 * 억제는 **감지 단계에서** 집행한다(INV-U4-02). 화면 단계에서 거르면 알림은 이미 나간 뒤다.
 */
@Service
class TriggerService(
    private val trips: TripFacade,
    private val itineraries: ItineraryFacade,
    private val triggers: PlanBTriggerRepository,
    private val suppressions: SuppressionRepository,
    private val sensitivities: SensitivityRepository,
    private val clock: Clock,
) {

    /**
     * 신호를 판정해 기록한다. 발화한 경우에만 트리거를 돌려주고, 억제·무영향이면 **null** 이다
     * (억제는 실패가 아니라 정상 동작이라 예외로 다루지 않는다).
     */
    @Transactional
    fun evaluate(accountId: UUID, tripId: UUID, signal: DetectionSignal): PlanBTrigger? {
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val now = clock.instant()
        val today = LocalDate.ofInstant(now, TRAVEL_ZONE)
        // BR-U4-02: 감지는 여행 구간 안에서만 동작한다 — 구간 밖에서는 어떤 트리거도 만들지 않는다(행조차).
        if (today < period.startDate || today > period.endDate) {
            log.debug("여행 구간 밖 신호 — 판정하지 않습니다. tripId={}", tripId)
            return null
        }
        val itinerary = itineraries.findCurrent(accountId, tripId) ?: return null // 재계획할 일정이 없다

        // BR-U4-06: 남은 일정에 닿는 신호만 유효하다. 완료 슬롯 판정(visit_check)은 후속이라
        // 지금은 "일정에 존재하는 슬롯"까지만 본다 — 지난 슬롯을 거르는 축은 그때 더한다.
        val remaining = itinerary.slotKeys.toSet()
        val activeOfKind = triggers.findActiveByTrip(tripId).filter { it.kind == signal.kind }.map { it.slotKey }.toSet()

        val verdict = TriggerEvaluator.judge(
            kind = signal.kind,
            slotKey = signal.slotKey,
            remainingSlotKeys = remaining,
            suppressions = suppressions.findByTrip(tripId),
            activeSlotKeysOfKind = activeOfKind,
            activatedToday = triggers.countActivatedOn(tripId, today),
            sensitivity = sensitivities.of(accountId),
            at = now,
        )

        if (verdict != TriggerEvaluator.Verdict.RAISE) {
            // 발화하지 않아도 **행은 남긴다** — 무발화의 근거가 관측에 있어야 한다.
            log.debug("트리거 무발화 — tripId={} kind={} slot={} 판정={}", tripId, signal.kind, signal.slotKey, verdict)
            triggers.save(
                PlanBTrigger.silent(
                    tripId, itinerary.itineraryId, signal.kind, signal.affectedDate, signal.slotKey,
                    signal.payload, signal.reason, verdict.state, now,
                ),
            )
            return null
        }
        return triggers.save(
            PlanBTrigger.active(
                tripId, itinerary.itineraryId, signal.kind, signal.affectedDate, signal.slotKey,
                signal.payload, signal.scope, signal.reason, now,
            ),
        )
    }

    /** 화면에는 **발화 중인 것만** 나간다(INV-U4-01 — 발화하지 않기로 한 판정은 어떤 형태로도 노출되지 않는다). */
    @Transactional(readOnly = true)
    fun listActive(accountId: UUID, tripId: UUID): List<PlanBTrigger> {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        return triggers.findActiveByTrip(tripId)
    }

    /**
     * `[끄기]` — **억제 레코드를 만든다**(BR-U4-15). 화면에서 배너만 감추는 동작이 아니다.
     * 그래야 다음 감지 때 같은 조합이 다시 발화하지 않는다.
     */
    @Transactional
    fun dismiss(accountId: UUID, tripId: UUID, triggerId: UUID): PlanBTrigger {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        // 트리거를 **여행 범위로 좁혀** 찾는다 — id 만으로 찾으면 남의 여행 알림을 끌 수 있다.
        val trigger = triggers.findById(triggerId)?.takeIf { it.tripId == tripId }
            ?: throw ResourceNotFound("트리거를 찾을 수 없습니다.")
        if (trigger.state != TriggerState.ACTIVE) {
            throw ConflictDetected(message = "이미 닫혔거나 지난 알림입니다.")
        }
        val now = clock.instant()
        suppressions.save(
            Suppression.of(
                tripId, trigger.kind, trigger.slotKey,
                // 슬롯을 특정한 신호면 그 슬롯만, 날짜 전체 신호면 그 날 전체를 끈다.
                if (trigger.slotKey != null) SuppressionScope.SLOT else SuppressionScope.DAY,
                now,
            ),
        )
        return triggers.save(trigger.copy(state = TriggerState.SUPPRESSED, shouldReplan = false))
    }

    private companion object {
        private val log = LoggerFactory.getLogger(TriggerService::class.java)

        /** 하루 총량·구간 판정은 **여행지 기준 날짜**로 한다 — 서버 UTC 로 세면 자정 무렵 어긋난다. */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}
