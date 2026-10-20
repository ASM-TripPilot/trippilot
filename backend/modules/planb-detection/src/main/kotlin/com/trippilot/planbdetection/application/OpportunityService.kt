package com.trippilot.planbdetection.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.domain.Opportunity
import com.trippilot.planbdetection.domain.OpportunityGate
import com.trippilot.planbdetection.domain.OpportunityPort
import com.trippilot.planbdetection.domain.OpportunityQuery
import com.trippilot.planbdetection.domain.OpportunitySlot
import com.trippilot.planbdetection.domain.OpportunityWeather
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.TriggerLifecycle
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.ObjectProvider
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlin.math.abs

/**
 * 기회 조회(BR-SA-22 · DEC-SA-6) — 허브가 보는 날짜의 남은 동선 근처 행사·'요즘 인기' ≤ 3 을 AI 에 묻는다(LLM 0회).
 *
 * **조회형이다** — 트리거도 알림도 아니라 상태·쓰기·알림 경로가 없다(LEGAL-SA-01). 재료(남은 슬롯·계획 POI)는 서버가
 * 일정에서 채운다. 소유가 아니면 404(존재 은닉 — SEC-SA-02)이고, 그 밖의 꺼짐·범위 밖·재료 없음·AI 실패·계약 위반은
 * 전부 빈 목록이다(BR-SA-22 규칙 6 · RES-SA-09) — 카드는 선택 사항이라 허브 표시를 막지 않는다.
 * 그 날 날씨 위험이 떠 있거나 [적용]으로 소비됐으면 축제·유형 모름 행사를 뺀다([OpportunityWeather] · G-SA-17).
 */
@Service
class OpportunityService(
    private val trips: TripFacade,
    private val plans: ItineraryPlanFacade,
    /** 날씨 위험 날의 행사 거르기 재료 — 그 날짜의 트리거 행(읽기만). */
    private val triggers: PlanBTriggerRepository,
    /** 기회 경계 — `trippilot.ai.opportunity.mode=http` 일 때만 빈이 있다. 없으면 꺼짐이다(AI 0회 · 빈 목록). */
    private val ports: ObjectProvider<OpportunityPort>,
    private val clock: Clock,
) {

    fun list(accountId: UUID, tripId: UUID, date: LocalDate): List<Opportunity> {
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 꺼져 있어도 소유부터 본다
        val port = ports.getIfAvailable() ?: return emptyList()
        val now = clock.instant()
        val today = LocalDate.ofInstant(now, TriggerLifecycle.TRAVEL_ZONE)
        // 여행 중(오늘 ≥ 시작)이고 그 날짜 ∈ [오늘, 종료]일 때만 — 여행 전 카드는 막다른 CTA 다(트리거 없는 재계획은 전날 창에서도 409, BR-SA-20).
        if (today < period.startDate || date < today || date > period.endDate) return emptyList()
        val query = queryOf(date, plans.findPlanSlots(accountId, tripId), now) ?: return emptyList()
        val reply = try {
            port.find(query)
        } catch (e: Exception) {
            log.warn("기회 조회 실패 — 카드 없이 응답합니다(RES-SA-09). tripId={} date={} 원인={}", tripId, date, e.toString())
            return emptyList()
        }
        if (reply.notes.isNotEmpty()) log.info("기회 조회 notes — tripId={} date={} notes={}", tripId, date, reply.notes)
        val violation = OpportunityGate.violation(query, reply.items)
        if (violation != null) {
            log.warn("기회 답이 계약에 어긋나 통째로 버립니다(RES-SA-09). tripId={} date={} 사유={}", tripId, date, violation)
            return emptyList()
        }
        // 비 오는 날 야외 축제를 권하지 않는다 — 순서는 상대 순위 그대로 두고 빼기만 한다(앱이 남은 첫 장을 고른다).
        if (!OpportunityWeather.blocksOutdoor(triggers.findByTripOn(tripId, listOf(date)), date)) return reply.items
        return reply.items.filter(OpportunityWeather::keeps)
    }

    internal companion object {
        /** 보내는 남은 슬롯 상한 — 상대가 슬롯마다 반경 조회를 하며 8회에서 끊는다(PERF-SA-08). 계약 상한(30)보다 작다. */
        const val MAX_SLOTS = 8

        /** 계약 `planned_poi_ids.maxItems` — 넘기면 요청 전체가 422 다. */
        const val MAX_PLANNED = 300

        private val log = LoggerFactory.getLogger(OpportunityService::class.java)

        /**
         * 질의 재료. 그 날 **끝나지 않은**(스윕과 같은 정의 — 자정을 넘기는 칸은 오늘 안에 끝나지 않는다) 좌표 있는 슬롯을
         * 방문 순서대로 [MAX_SLOTS] 개까지. 없으면 null — 빈 재료로는 묻지 않는다(계약 `minItems: 1`).
         *
         * 계획 POI 는 일정 전체의 장소다(끝난 칸 포함 — 오늘 다녀온 곳이 카드로 되돌아오지 않게). 상한을 넘는 긴 여행은
         * 그 날에 가까운 날의 장소부터 남긴다.
         */
        fun queryOf(date: LocalDate, slots: List<PlannedSlotView>, now: Instant): OpportunityQuery? {
            val today = LocalDate.ofInstant(now, TriggerLifecycle.TRAVEL_ZONE)
            val time = LocalTime.ofInstant(now, TriggerLifecycle.TRAVEL_ZONE)
            val remaining = slots
                .filter { it.date == date && !TriggerLifecycle.SlotTime(it.slotKey, it.date, it.startAt, it.endAt, it.endsNextDay).endedAt(today, time) }
                .sortedBy { it.orderIndex }
                .mapNotNull { s ->
                    val (lat, lng) = s.lat to s.lng
                    if (lat == null || lng == null) null else OpportunitySlot(s.slotKey, s.poiId, lat, lng)
                }
                .take(MAX_SLOTS)
            if (remaining.isEmpty()) return null
            val planned = slots.sortedBy { abs(ChronoUnit.DAYS.between(date, it.date)) }.map { it.poiId }.distinct().take(MAX_PLANNED)
            return OpportunityQuery(date, remaining, planned)
        }
    }
}
