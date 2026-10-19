package com.trippilot.planbdetection.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.api.TriggerLookupFacade
import com.trippilot.planbdetection.api.TriggerRef
import com.trippilot.planbdetection.domain.PlanBWatchRepository
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.WatchStatus
import org.springframework.beans.factory.ObjectProvider
import java.time.Duration
import com.trippilot.planbdetection.api.event.DateRisk
import com.trippilot.planbdetection.api.event.PlanBTriggered
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.SensitivityRepository
import com.trippilot.planbdetection.domain.SituationCopy
import com.trippilot.planbdetection.domain.Suppression
import com.trippilot.planbdetection.domain.SuppressionRepository
import com.trippilot.planbdetection.domain.SuppressionScope
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerLifecycle
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerSeverity
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.planbdetection.domain.TriggerVariant
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** 신호 한 건(BR-U4-03 — 판정은 서버가 한다). 날씨 확인·U10·스윕 감지기가 같은 모양으로 낸다. */
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
    /** 위험(푸시 대상)·주의(앱 안). 없으면 위험 — 날씨 확인·U10 은 지금처럼 위험이다. */
    val severity: TriggerSeverity = TriggerSeverity.RISK,
    /** 변형(CD6). kind 와 짝이 맞아야 한다 — 스윕은 어긋난 신호를 버린다. */
    val variant: TriggerVariant? = null,
    /** 원천(CD5 `payload.dataSource`) — 화면 출처 표기의 재료(예: `KMA_VILAGE`). */
    val dataSource: String? = null,
    /** 영향 POI — 선계산 재료(`PlanBTriggered.dateRisks[].poiIds`). */
    val poiIds: List<UUID> = emptyList(),
)

/** 스윕 회차 한 여행의 결과 — 요약 로그 재료(스윕이 센다). [dropped] = 가드에 걸려 버린 신호 수. */
data class ReconcileOutcome(val announced: Boolean, val pushed: Boolean, val quiet: Int, val expired: Int, val dropped: Int)

/** 트리거 하나의 화면용 사실(규칙 15). [state] 는 목록과 같은 말을 한다 — 숨는 ACTIVE 는 EXPIRED. */
data class TriggerDetail(val trigger: PlanBTrigger, val state: TriggerState, val currentTriggerId: UUID?)

/**
 * 감지·억제(C9) — 판정과 기록의 유일한 쓰기 경로.
 *
 * 규칙은 [TriggerLifecycle] 한 곳에 있다 — 대상 = (kind, 날짜, 슬롯), 같은 대상은 제자리 갱신(triggerId 유지),
 * 알린 최고 심각도 위로만 다시 알림, 여행·판정당 알림 사건 ≤ 1, 하루 상한은 푸시만 묶는다.
 * 발화하지 않은 판정도 행으로 남긴다(정본 §2.1) — 억제됐는지·영향이 없다고 봤는지는 서로 다른 사실이다.
 * 억제는 **감지 단계에서** 집행한다(INV-U4-02). 화면 단계에서 거르면 알림은 이미 나간 뒤다.
 */
@Service
class TriggerService(
    private val trips: TripFacade,
    private val itineraries: ItineraryFacade,
    private val triggers: PlanBTriggerRepository,
    private val suppressions: SuppressionRepository,
    private val sensitivities: SensitivityRepository,
    private val events: DomainEventPublisher,
    private val clock: Clock,
    private val watches: PlanBWatchRepository,
    /** 스윕(PR-A2)이 내는 빈. 없으면 아무 출처도 감시하지 않는다 — 스윕 꺼짐과 같다. */
    private val watching: ObjectProvider<WatchingSources>,
) : TriggerLookupFacade {

    /**
     * 신호 한 건을 판정해 기록한다(날씨 확인·U10). 이 호출로 배너가 새로 섰거나(알림·조용한 발화) 격상돼 알렸으면
     * 그 트리거를, 아니면 **null** 이다 — 억제·무영향·이미 떠 있음은 실패가 아니라 정상 동작이다.
     *
     * 단건 경로라 만료·출처별 해제·문구 가드는 하지 않고(스윕 몫), 지평 스위치를 모르므로 **오늘만** 받는다(종전 BR-U4-02).
     * 범위는 호출자가 준 그대로다 — CD7 교정은 스윕 신호에만 건다(날씨 확인은 FULL_DAY 로 연다).
     */
    @Transactional
    fun evaluate(accountId: UUID, tripId: UUID, signal: DetectionSignal): PlanBTrigger? {
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val now = clock.instant()
        val today = LocalDate.ofInstant(now, TRAVEL_ZONE)
        // BR-U4-02: 허용 날짜 밖에서는 어떤 트리거도 만들지 않는다(행조차).
        if (signal.affectedDate !in TriggerLifecycle.allowedDates(today, period.startDate, period.endDate, includeTomorrow = false)) {
            log.debug("허용 날짜 밖 신호 — 판정하지 않습니다. tripId={} date={}", tripId, signal.affectedDate)
            return null
        }
        val itinerary = itineraries.findCurrent(accountId, tripId) ?: return null // 재계획할 일정이 없다

        // 범위가 NONE 인 신호는 "바꿀 게 없다"는 뜻이라 발화 대상이 아니다 — 판정 이전에 갈린다.
        if (signal.scope == TriggerScope.NONE) {
            triggers.save(
                PlanBTrigger.silent(
                    tripId, itinerary.itineraryId, signal.kind, signal.affectedDate, signal.slotKey,
                    payloadOf(signal, detector = null), signal.reason, TriggerState.EXPIRED, now, signal.severity,
                ),
            )
            return null
        }

        val plan = TriggerLifecycle.plan(
            TriggerLifecycle.Input(
                tripId = tripId,
                itineraryId = itinerary.itineraryId,
                now = now,
                allowedDates = setOf(signal.affectedDate),
                // 요약 일정이라 슬롯 시각을 모른다 — 그 날 슬롯은 남은 것으로 본다. 형식이 어긋난 키는 신호 날짜로(신호를 잃지 않게).
                slots = itinerary.slotKeys.map { TriggerLifecycle.SlotTime(it, dateOf(it) ?: signal.affectedDate, null, null, false) },
                actives = triggers.findActiveByTrip(tripId),
                history = triggers.findByTripOn(tripId, setOf(signal.affectedDate, signal.affectedDate.minusDays(1))),
                suppressions = suppressions.findByTrip(tripId),
                pushCap = sensitivities.of(accountId).dailyCap,
                pushedToday = triggers.countPushedOn(tripId, today),
                looks = emptyList(),
                sightings = listOf(sightingOf(signal, detector = null, scope = signal.scope)),
                sweep = false,
            ),
        )
        val saved = write(accountId, tripId, plan)
        val raised = plan.inserts.firstOrNull { it.state == TriggerState.ACTIVE } ?: plan.announcement?.representative
        return raised?.let { saved.getValue(it.triggerId) }
    }

    /**
     * 스윕 회차의 판정 — **여행 1개 = 트랜잭션 1개**(설계서 §3 [4]).
     *
     * 일정·슬롯·감지 결과는 호출자(스윕)가 트랜잭션 밖에서 읽고 불러 넘긴다 — 외부 HTTP 가 쓰기 트랜잭션을 붙잡지 않게.
     * [observations] 에 없는 (출처, 날짜)는 '미호출'이라 해제하지 않는다. 지평(내일·D-1)은 스윕이 넘기는 날짜로 정하고,
     * 여기서는 {오늘, 내일} ∩ 여행 구간 밖을 버린다(행 없음). 스윕이 닫고 여는 종류는 WEATHER·CLOSURE 뿐이다.
     * 감지기 계약·문구 가드를 어긴 신호는 그 신호만 버리고 WARN 한다(규칙 13).
     */
    @Transactional
    fun reconcile(
        accountId: UUID,
        tripId: UUID,
        period: TripPeriod,
        now: Instant,
        itinerary: ItineraryRef?,
        slots: List<PlannedSlotView>,
        observations: List<Observation>,
    ): ReconcileOutcome {
        val (plan, dropped) = planSweep(accountId, tripId, period, now, itinerary, slots, observations)
        write(accountId, tripId, plan)
        return outcomeOf(plan, dropped)
    }

    /**
     * dry-run 의 판정 — [reconcile] 과 같은 계획을 세우되 **쓰지 않는다**(행·사건·만료 0 · BR-SA-04).
     * 켰다면 낼 알림·푸시·조용한 발화·만료 수를 돌려준다 — 운영 dry-run 이 첫 켜기 몰림 규모를 이 수로 잰다(켜기 3단계).
     */
    @Transactional(readOnly = true)
    fun preview(
        accountId: UUID,
        tripId: UUID,
        period: TripPeriod,
        now: Instant,
        itinerary: ItineraryRef?,
        slots: List<PlannedSlotView>,
        observations: List<Observation>,
    ): ReconcileOutcome {
        val (plan, dropped) = planSweep(accountId, tripId, period, now, itinerary, slots, observations)
        return outcomeOf(plan, dropped)
    }

    /** 스윕 판정의 계획(쓰기 없음)과 가드에 걸려 버린 신호 수 — [reconcile]·[preview] 가 같이 쓴다. */
    private fun planSweep(
        accountId: UUID,
        tripId: UUID,
        period: TripPeriod,
        now: Instant,
        itinerary: ItineraryRef?,
        slots: List<PlannedSlotView>,
        observations: List<Observation>,
    ): Pair<TriggerLifecycle.Plan, Int> {
        val today = LocalDate.ofInstant(now, TRAVEL_ZONE)
        val allowed = TriggerLifecycle.allowedDates(today, period.startDate, period.endDate, includeTomorrow = true)
        val names = slots.mapNotNull { it.nameKo }
        val keysByDate = slots.groupBy({ it.date }, { it.slotKey })
        val looks = mutableListOf<TriggerLifecycle.Look>()
        val sightings = mutableListOf<TriggerLifecycle.Sighting>()
        var dropped = 0
        for (o in observations) {
            // 스윕이 다루지 않는 종류·날짜는 판정에서 뺀다 — 해제의 근거로도 쓰지 않는다.
            if (o.kind !in TriggerLifecycle.SWEPT_KINDS || o.date !in allowed) continue
            when (val d = o.detection) {
                is Detection.Unknown -> looks += TriggerLifecycle.Look(o.source, o.kind, o.date, null)
                is Detection.Checked -> {
                    looks += TriggerLifecycle.Look(o.source, o.kind, o.date, d.checked)
                    for (s in d.signals) {
                        val why = rejection(o, s, keysByDate[o.date].orEmpty(), names)
                        if (why != null) {
                            dropped++
                            log.warn(
                                "상황 신호를 버립니다 — source={} kind={} date={} slot={} 사유={}",
                                o.source, s.kind, s.affectedDate, s.slotKey, why,
                            )
                            continue
                        }
                        sightings += sightingOf(s, detector = o.source, scope = TriggerLifecycle.sweepScope(s.affectedDate, today))
                    }
                }
            }
        }
        val plan = TriggerLifecycle.plan(
            TriggerLifecycle.Input(
                tripId = tripId,
                itineraryId = itinerary?.itineraryId,
                now = now,
                allowedDates = allowed,
                slots = slots.map { TriggerLifecycle.SlotTime(it.slotKey, it.date, it.startAt, it.endAt, it.endsNextDay) },
                actives = triggers.findActiveByTrip(tripId),
                history = triggers.findByTripOn(tripId, allowed + allowed.map { it.minusDays(1) }),
                suppressions = suppressions.findByTrip(tripId),
                pushCap = sensitivities.of(accountId).dailyCap,
                pushedToday = triggers.countPushedOn(tripId, today),
                looks = looks,
                sightings = sightings,
                sweep = true,
            ),
        )
        return plan to dropped
    }

    private fun outcomeOf(plan: TriggerLifecycle.Plan, dropped: Int) = ReconcileOutcome(
        announced = plan.announcement != null,
        pushed = plan.announcement?.push == true,
        quiet = plan.quiet,
        expired = plan.expired,
        dropped = dropped,
    )

    /**
     * 화면에는 **발화 중이고 지금 유효한 것만** 나간다(INV-U4-01 · 규칙 14) — 지난 날·지금 일정에 없는 슬롯·꺼진 감시 출처는 숨긴다.
     * 상태 전이가 정본이고 이것은 스윕 사이 빈틈(꺼짐·수동 편집 직후)을 메우는 읽기 필터다 — 억제가 아니다.
     * 정렬은 서버 한 곳(CD14): 위험 → 영향 날짜 ↑ → 감지 ↓. 화면은 받은 순서 그대로 쓴다(알약 [0] 이 가장 중요한 것).
     */
    @Transactional(readOnly = true)
    fun listActive(accountId: UUID, tripId: UUID): List<PlanBTrigger> {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        val shown = visibility(accountId, tripId)
        return triggers.findActiveByTrip(tripId).filter(shown).sortedWith(LIST_ORDER)
    }

    /**
     * 감시 상태(규칙 14) — 출처 묶음별 확인됨·확인 불가·꺼짐. '꺼짐·모름'을 '정상'으로 말하지 않는 것이 이 값의 존재 이유다(K9).
     * 날씨 = 단기예보 감지기, 휴무 = 장소 감지기. 지연은 감지기가 아직 없어 늘 OFF 다(U10).
     */
    @Transactional(readOnly = true)
    fun watch(accountId: UUID, tripId: UUID): TriggerWatch {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        val now = clock.instant()
        val sources = watching.getIfAvailable { NOTHING_WATCHED }
        val rows = watches.findByTrip(tripId).associateBy { it.source }
        fun of(source: String, fresh: Duration): WatchView {
            if (!sources.isWatching(source, accountId)) return WatchView(WatchView.Status.OFF, null)
            val row = rows[source] ?: return WatchView(WatchView.Status.UNKNOWN, null)
            if (row.status != WatchStatus.CHECKED) return WatchView(WatchView.Status.UNKNOWN, null)
            val recent = !row.checkedAt.isBefore(now.minus(fresh))
            return WatchView(if (recent) WatchView.Status.CHECKED else WatchView.Status.UNKNOWN, row.checkedAt)
        }
        return TriggerWatch(
            weather = of(SweepSource.KMA_FORECAST, WEATHER_FRESH),
            closure = of(SweepSource.PLACE, PLACE_FRESH),
            delay = WatchView(WatchView.Status.OFF, null),
        )
    }

    /**
     * 트리거 하나(규칙 15) — 늦게 탭한 알림도 지금 상태와 같은 대상의 현재 트리거를 안다.
     * 목록에서 숨는 ACTIVE(지난 날·빠진 슬롯·꺼진 출처)는 EXPIRED 로 말한다 — 목록과 다른 말을 하면 화면이
     * 지난 날짜로 재계획을 열어 막다른 길(409)로 간다. `currentTriggerId` 도 보이는 ACTIVE 만이다.
     */
    @Transactional(readOnly = true)
    fun detail(accountId: UUID, tripId: UUID, triggerId: UUID): TriggerDetail {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        val trigger = triggers.findById(triggerId)?.takeIf { it.tripId == tripId }
            ?: throw ResourceNotFound("트리거를 찾을 수 없습니다.")
        val shown = visibility(accountId, tripId)
        val current = triggers.findActiveByTrip(tripId).firstOrNull { it.target == trigger.target && shown(it) }
        val state = if (trigger.state == TriggerState.ACTIVE && !shown(trigger)) TriggerState.EXPIRED else trigger.state
        return TriggerDetail(trigger, state, current?.triggerId)
    }

    /** C10 진입 강제용 — 저장된 사실 그대로다(가시성 필터 없음). 소유 확인은 호출측이 이미 했다. */
    @Transactional(readOnly = true)
    override fun find(tripId: UUID, triggerId: UUID): TriggerRef? {
        val t = triggers.findById(triggerId)?.takeIf { it.tripId == tripId } ?: return null
        val current = triggers.findActiveByTrip(tripId).firstOrNull { it.target == t.target }
        return TriggerRef(t.kind.name, t.state.name, t.affectedDate, t.scope?.name, current?.triggerId)
    }

    /**
     * 재계획 적용 → 그 트리거를 소비(CONSUMED)한다(규칙 16). 트리거 날짜와 적용한 날짜가 같고 ACTIVE·EXPIRED 일 때만이다.
     * - 날짜가 다르면 무시한다 — 내일 트리거로 연 재계획이 오늘을 다시 짠 경우다(검토 O2).
     * - EXPIRED 도 소비한다 — 해제된 뒤에 그 대안을 적용했을 수 있다. SUPPRESSED(끈 알림)는 그대로 둔다.
     * - 두 번째 배달은 이미 CONSUMED 라 무동작이다(at-least-once 멱등).
     * 같은 날의 다른 트리거는 닫지 않는다 — 바뀐 일정은 다음 스윕의 만료(빠진 슬롯)가 닫고, 여전히 위험이면 조용히 되살아난다.
     *
     * @return 바꿨으면 true
     */
    @Transactional
    fun consume(tripId: UUID, triggerId: UUID, targetDate: LocalDate): Boolean {
        val t = triggers.findById(triggerId)?.takeIf { it.tripId == tripId } ?: return false
        if (t.affectedDate != targetDate) return false
        if (t.state != TriggerState.ACTIVE && t.state != TriggerState.EXPIRED) return false
        triggers.save(t.consumed())
        return true
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
        val dayScoped = trigger.slotKey == null
        suppressions.save(
            Suppression.of(
                tripId, trigger.kind, trigger.slotKey,
                // 슬롯을 특정한 신호면 그 슬롯만, 날짜 전체 신호면 그 날 전체를 끈다.
                if (dayScoped) SuppressionScope.DAY else SuppressionScope.SLOT,
                now,
                // **날짜 범위 억제는 그 날로 끝난다.** 옛 파드(날짜를 모르는 covers)도 이 만료로 같은 범위를 지킨다.
                expiresAt = if (dayScoped) trigger.affectedDate.plusDays(1).atStartOfDay(TRAVEL_ZONE).toInstant() else null,
                // 끈 트리거의 날짜·심각도 — 주의를 끈 것이 같은 날 위험 격상을, 오늘을 끈 것이 내일을 막지 않게.
                affectedDate = trigger.affectedDate,
                maxSeverity = trigger.severity,
            ),
        )
        return triggers.save(trigger.copy(state = TriggerState.SUPPRESSED, shouldReplan = false))
    }

    /**
     * 계획을 저장하고 알림 사건을 낸다 — 같은 트랜잭션이라 롤백되면 트리거도 사건도 없다.
     * **기존 행 갱신이 먼저다** — 같은 대상의 UPDATE 와 INSERT 가 한 판정에 오면 부분 유니크가 순서를 본다.
     * 저장된 행(새 version)을 id 로 돌려준다.
     */
    private fun write(accountId: UUID, tripId: UUID, plan: TriggerLifecycle.Plan): Map<UUID, PlanBTrigger> {
        val saved = (plan.updates + plan.inserts).associate { it.triggerId to triggers.save(it) }
        plan.announcement?.let { events.publish(eventOf(accountId, tripId, it)) }
        return saved
    }

    private fun eventOf(accountId: UUID, tripId: UUID, a: TriggerLifecycle.Announcement): PlanBTriggered {
        val rep = a.representative
        return PlanBTriggered(
            aggregateId = rep.triggerId.toString(),
            accountId = accountId.toString(),
            tripId = tripId.toString(),
            kind = rep.kind.name,
            slotKey = rep.slotKey,
            reason = rep.reason,
            affectedDate = rep.affectedDate.toString(),
            scope = rep.scope?.name,
            severity = rep.severity.name,
            variant = rep.variant?.name,
            push = a.push,
            others = a.others,
            dateRisks = a.dateRisks.map { DateRisk(it.kind.name, it.variant?.name, it.poiIds) },
        )
    }

    /** 스윕 신호 가드(감지기 계약 + 규칙 13) — 걸리면 이유 이름, 통과면 null. */
    private fun rejection(o: Observation, s: DetectionSignal, keysOfDay: List<String>, names: List<String>): String? = when {
        s.kind != o.kind -> "kind"
        s.affectedDate != o.date -> "date"
        s.variant != null && s.variant.kind != s.kind -> "variant"
        s.slotKey != null && s.slotKey !in keysOfDay -> "slot"
        else -> SituationCopy.violation(s.reason, names)
    }

    private fun sightingOf(s: DetectionSignal, detector: String?, scope: TriggerScope) = TriggerLifecycle.Sighting(
        TriggerLifecycle.Target(s.kind, s.affectedDate, s.slotKey), s.severity, s.variant, scope, s.reason, payloadOf(s, detector),
    )

    /** payload 에 변형·해제 자격·원천·영향 POI 를 싣는다(CD5·CD6 — 열을 늘리지 않는다. 심각도만 열이다). */
    private fun payloadOf(s: DetectionSignal, detector: String?): Map<String, Any> = buildMap {
        putAll(s.payload)
        s.variant?.let { put(PlanBTrigger.PAYLOAD_VARIANT, it.name) }
        detector?.let { put(PlanBTrigger.PAYLOAD_DETECTOR, it) }
        s.dataSource?.let { put(PlanBTrigger.PAYLOAD_DATA_SOURCE, it) }
        if (s.poiIds.isNotEmpty()) put(PlanBTrigger.PAYLOAD_POI_IDS, s.poiIds.map(UUID::toString))
    }

    /** 화면에 보일 자격(규칙 14) — 영향 날짜 ≥ 오늘 ∧ (날짜 전체 ∨ 지금 일정에 있는 슬롯) ∧ (스윕 출처면 그 계정의 그 출처를 지금 감시 중). */
    private fun visibility(accountId: UUID, tripId: UUID): (PlanBTrigger) -> Boolean {
        val today = LocalDate.ofInstant(clock.instant(), TRAVEL_ZONE)
        val planned = itineraries.findCurrent(accountId, tripId)?.slotKeys.orEmpty().toSet()
        val sources = watching.getIfAvailable { NOTHING_WATCHED }
        return { t ->
            t.affectedDate >= today &&
                (t.slotKey == null || t.slotKey in planned) &&
                (t.detector?.let { sources.isWatching(it, accountId) } ?: true)
        }
    }

    /** slotKey("{date}#{poiId}") 의 날짜. 형식이 어긋나면 null. */
    private fun dateOf(slotKey: String): LocalDate? =
        runCatching { LocalDate.parse(slotKey.substringBefore('#')) }.getOrNull()

    private companion object {
        private val log = LoggerFactory.getLogger(TriggerService::class.java)

        /** 하루 상한·구간 판정은 **여행지 기준 날짜**로 한다 — 서버 UTC 로 세면 자정 무렵 어긋난다. */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

        /** 목록 정렬(CD14) — 위험 → 영향 날짜 ↑ → 감지 ↓. */
        private val LIST_ORDER: Comparator<PlanBTrigger> =
            compareByDescending<PlanBTrigger> { it.severity.rank }.thenBy { it.affectedDate }.thenByDescending { it.detectedAt }

        /**
         * 감시 상태 신선 창(규칙 14) — 날씨는 매시 회차라 2시간, 장소는 아침·저녁만 보므로 14시간.
         * 발명값이다 — 운영 관측 뒤 조정한다(설계서 R15).
         */
        private val WEATHER_FRESH: Duration = Duration.ofHours(2)
        private val PLACE_FRESH: Duration = Duration.ofHours(14)

        /** 스윕 빈이 없을 때 — 아무 출처도 감시하지 않는다. */
        private val NOTHING_WATCHED = WatchingSources { _, _ -> false }
    }
}
