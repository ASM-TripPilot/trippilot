package com.trippilot.planbdetection.application

import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.PlanBWatch
import com.trippilot.planbdetection.domain.PlanBWatchRepository
import com.trippilot.planbdetection.domain.Sensitivity
import com.trippilot.planbdetection.domain.SensitivityRepository
import com.trippilot.planbdetection.domain.Suppression
import com.trippilot.planbdetection.domain.SuppressionRepository
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.trip.api.TripFacade
import org.springframework.beans.factory.ObjectProvider
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.OptimisticLockingFailureException
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** 발행만 삼키는 싱크(TRIP-550). 발행 내용은 사건 테스트가 따로 본다. */
internal object NoEvents : DomainEventPublisher {
    override fun publish(event: DomainEvent) = Unit
}

/** 발행한 사건을 모은다 — 사건 필드·건수를 본다. */
internal class RecordingEvents : DomainEventPublisher {
    val published = mutableListOf<DomainEvent>()
    override fun publish(event: DomainEvent) {
        published += event
    }
}

/**
 * 트리거 저장소 대역 — **실물처럼 실패한다**(거울에 방어 코드를 더하지 않는다).
 * 같은 대상(여행·종류·날짜·슬롯)에 ACTIVE 가 둘이 되면 [DataIntegrityViolationException](부분 유니크),
 * 낡은 판으로 덮으면 [OptimisticLockingFailureException](@Version) — 실 어댑터와 같은 예외다.
 * 행은 [save] 로만 넣는다(새 행은 version null).
 */
internal class InMemoryTriggers : PlanBTriggerRepository {
    val stored = mutableListOf<PlanBTrigger>()

    override fun save(trigger: PlanBTrigger): PlanBTrigger {
        val existing = stored.firstOrNull { it.triggerId == trigger.triggerId }
        val next = when {
            existing == null && trigger.version == null -> trigger.copy(version = 0)
            existing != null && trigger.version == existing.version -> trigger.copy(version = existing.version!! + 1)
            else -> throw OptimisticLockingFailureException("낡은 판입니다 — triggerId=${trigger.triggerId}")
        }
        val clash = next.state == TriggerState.ACTIVE && stored.any {
            it.triggerId != next.triggerId && it.state == TriggerState.ACTIVE && it.tripId == next.tripId &&
                it.kind == next.kind && it.affectedDate == next.affectedDate && it.slotKey == next.slotKey
        }
        if (clash) throw DataIntegrityViolationException("ux_plan_b_trigger_active")
        stored.removeAll { it.triggerId == next.triggerId }
        stored += next
        return next
    }

    override fun findById(triggerId: UUID) = stored.firstOrNull { it.triggerId == triggerId }

    override fun findActiveByTrip(tripId: UUID) =
        stored.filter { it.tripId == tripId && it.state == TriggerState.ACTIVE }.sortedByDescending { it.detectedAt }

    override fun findByTripOn(tripId: UUID, dates: Collection<LocalDate>) =
        stored.filter { it.tripId == tripId && it.affectedDate in dates }

    override fun countPushedOn(tripId: UUID, date: LocalDate) =
        stored.count { it.tripId == tripId && it.pushedAt?.let { p -> LocalDate.ofInstant(p, ZONE) } == date }

    private companion object {
        val ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}

internal class InMemorySuppressions : SuppressionRepository {
    val stored = mutableListOf<Suppression>()
    override fun save(suppression: Suppression) = suppression.also { stored += it }
    override fun findByTrip(tripId: UUID) = stored.filter { it.tripId == tripId }
}

/** 읽기만 흉내 낸다 — 쓰기는 이 테스트들의 관심이 아니다. */
internal class FixedSensitivity(private val value: Sensitivity = Sensitivity.NORMAL) : SensitivityRepository {
    override fun of(accountId: UUID) = value
    override fun set(accountId: UUID, sensitivity: Sensitivity) = error("쓰기를 쓰지 않는 대역입니다.")
}

/** 판정 서비스 조립 — 생성자 인자가 늘어도 테스트 파일마다 고치지 않게 한곳에서 만든다. */
internal class InMemoryWatches : PlanBWatchRepository {
    val stored = linkedMapOf<Pair<UUID, String>, PlanBWatch>()

    override fun upsert(watch: PlanBWatch) {
        stored[watch.tripId to watch.source] = watch
    }

    override fun findByTrip(tripId: UUID) = stored.values.filter { it.tripId == tripId }
}

/** 스윕(PR-A2)이 낼 빈의 대역. 출처를 안 주면 빈이 없는 것과 같다 — 아무것도 감시하지 않는다. */
internal fun watchingProvider(vararg sources: String): ObjectProvider<WatchingSources> =
    object : ObjectProvider<WatchingSources> {
        private val bean: WatchingSources? = if (sources.isEmpty()) null else WatchingSources { it in sources }
        override fun getObject(): WatchingSources = bean ?: error("WatchingSources 빈이 없습니다.")
        override fun getIfAvailable(): WatchingSources? = bean
    }

internal fun triggerService(
    trips: TripFacade,
    itineraries: ItineraryFacade,
    clock: Clock,
    triggers: InMemoryTriggers = InMemoryTriggers(),
    suppressions: InMemorySuppressions = InMemorySuppressions(),
    sensitivity: Sensitivity = Sensitivity.NORMAL,
    events: DomainEventPublisher = NoEvents,
    watches: InMemoryWatches = InMemoryWatches(),
    watching: ObjectProvider<WatchingSources> = watchingProvider(),
) = TriggerService(
    trips, itineraries, triggers, suppressions, FixedSensitivity(sensitivity), events, clock, watches, watching,
)
